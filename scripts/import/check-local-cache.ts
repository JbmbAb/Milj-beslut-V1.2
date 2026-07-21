import fs from 'fs';
import path from 'path';
import { PLATFORM_COLLECTIONS } from './platform-datasources';

const DOWNLOAD_DIR = path.resolve('storage/ingest/platform-downloads');
const MIN_VALID_GPKG_BYTES = 128 * 1024;

const ONLY_PREFIXES_ARG = process.argv.find((arg) => arg.startsWith('--only-prefixes='));
const ONLY_PREFIXES = ONLY_PREFIXES_ARG
  ? ONLY_PREFIXES_ARG.split('=')[1]
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
  : [];

const INCLUDE_DISABLED = process.argv.includes('--include-disabled');

function isDisabledSource(item: (typeof PLATFORM_COLLECTIONS)[number]): boolean {
  return 'disabled' in item && item.disabled === true;
}

function isIncludedByPrefix(item: (typeof PLATFORM_COLLECTIONS)[number]): boolean {
  if (ONLY_PREFIXES.length === 0) {
    return true;
  }
  const id = String(item.id).toLowerCase();
  return ONLY_PREFIXES.some((prefix) => id.startsWith(`${prefix}_`) || id === prefix);
}

function listLocalCandidates(sourceId: string): Array<{ filePath: string; size: number; mtimeMs: number }> {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    return [];
  }

  return fs
    .readdirSync(DOWNLOAD_DIR, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.startsWith(sourceId) && name.endsWith('.gpkg'))
    .map((name) => {
      const filePath = path.join(DOWNLOAD_DIR, name);
      const stat = fs.statSync(filePath);
      return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.size - a.size || b.mtimeMs - a.mtimeMs);
}

function fmtMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const selected = PLATFORM_COLLECTIONS.filter((item) => isIncludedByPrefix(item));
const active = selected.filter((item) => INCLUDE_DISABLED || !isDisabledSource(item));

const ok: string[] = [];
const missingOrInvalid: string[] = [];

console.log('\nLOCAL CACHE PREFLIGHT');
console.log('=====================');
console.log(`Selected sources: ${active.length}`);
console.log(`Download dir: ${DOWNLOAD_DIR}`);

for (const item of active) {
  if ('filePath' in item && item.filePath) {
    const exists = fs.existsSync(item.filePath);
    if (exists) {
      const stat = fs.statSync(item.filePath);
      ok.push(item.id);
      console.log(`OK    ${item.id} -> ${item.filePath} (${fmtMb(stat.size)})`);
    } else {
      missingOrInvalid.push(item.id);
      console.log(`MISS  ${item.id} -> missing filePath: ${item.filePath}`);
    }
    continue;
  }

  const candidates = listLocalCandidates(String(item.id));
  const usable = candidates.find((c) => c.size >= MIN_VALID_GPKG_BYTES);

  if (usable) {
    ok.push(item.id);
    console.log(
      `OK    ${item.id} -> ${path.relative(process.cwd(), usable.filePath)} (${fmtMb(usable.size)})`,
    );
  } else {
    missingOrInvalid.push(item.id);
    if (candidates.length === 0) {
      console.log(`MISS  ${item.id} -> no local .gpkg candidates`);
    } else {
      const top = candidates[0];
      console.log(
        `MISS  ${item.id} -> only tiny/invalid candidates (best: ${path.basename(top.filePath)} ${fmtMb(top.size)})`,
      );
    }
  }
}

console.log('\nSUMMARY');
console.log('-------');
console.log(`OK: ${ok.length}`);
console.log(`MISSING_OR_INVALID: ${missingOrInvalid.length}`);
if (missingOrInvalid.length > 0) {
  console.log(`IDs: ${missingOrInvalid.join(', ')}`);
  process.exitCode = 1;
}
