/**
 * Re-download corrupt STAC kommun-ZIP files listed in merge-failures.json.
 *
 * Usage:
 *   npx tsx scripts/import/reharvest-stac-failures.ts --stac-folder fastighetsindelning --version 2026-06-18
 *   npx tsx scripts/import/reharvest-stac-failures.ts --stac-folder fastighetsindelning --version 2026-06-18 --execute
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import { resolveStacMergeEntryByDataset, resolveStacMergeEntry } from './config/importRegistry';
import { canOpenOgrSource, vsizipPath } from './lastkajenImportEngine';

dotenv.config();

const STAC_BASE = process.env.LANTMATERIET_BASE_URL || 'https://api.lantmateriet.se/stac-vektor/v1';
const TOKEN_URL = 'https://api.lantmateriet.se/token';
const STAC_ARCHIVE_ROOT = path.join(MASTER_ARCHIVE_ROOT, 'Data', 'LM', 'STAC_Archive');

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  dry: (msg: string) => void;
};

const logger: Logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err ?? ''),
  dry: (msg) => console.log(`[DRY-RUN] ${msg}`),
};

function parseArgs(argv: string[]): {
  stacFolder: string;
  version: string;
  execute: boolean;
  failuresPath: string;
} {
  let stacFolder = '';
  let dataset = '';
  let version = '';
  let execute = false;
  let failuresPath = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stac-folder') stacFolder = argv[++i] ?? '';
    else if (arg === '--dataset') dataset = argv[++i] ?? '';
    else if (arg === '--version') version = argv[++i] ?? '';
    else if (arg === '--failures') failuresPath = argv[++i] ?? '';
    else if (arg === '--execute') execute = true;
  }

  if (dataset && !stacFolder) {
    const match = resolveStacMergeEntryByDataset(dataset);
    if (!match) throw new Error(`No STAC merge profile for dataset "${dataset}"`);
    stacFolder = match.profile.stac_archive_folder;
    if (!version) version = dataset.includes('/') ? '' : '';
  }

  if (!stacFolder) throw new Error('Provide --stac-folder or --dataset');
  if (!version) throw new Error('Provide --version (merge output version, e.g. 2026-06-18)');

  if (!failuresPath) {
    const resolved = resolveStacMergeEntry(stacFolder);
    if (!resolved) throw new Error(`Unknown STAC folder "${stacFolder}"`);
    failuresPath = path.join(
      MASTER_ARCHIVE_ROOT,
      'Data',
      resolved.provider,
      resolved.dataset,
      version,
      'merge-failures.json',
    );
  }

  return { stacFolder, version, execute, failuresPath };
}

function lmCredentials(): { key: string; secret: string } {
  const key =
    process.env.LANTMATERIET_CONSUMER_KEY ||
    process.env.LANTMATERIET_CLIENT_ID ||
    process.env.LM_CONSUMER_KEY ||
    '';
  const secret =
    process.env.LANTMATERIET_CONSUMER_SECRET ||
    process.env.LANTMATERIET_CLIENT_SECRET ||
    process.env.LM_CONSUMER_SECRET ||
    '';
  if (!key || !secret) {
    throw new Error(
      'Missing LM credentials. Set LANTMATERIET_CONSUMER_KEY/SECRET or LANTMATERIET_CLIENT_ID/SECRET in .env',
    );
  }
  return { key, secret };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const { key, secret } = lmCredentials();
  const credentials = Buffer.from(`${key}:${secret}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) {
    throw new Error(`Token fetch failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

function isZipArchiveComplete(zipPath: string): boolean {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) return false;
    const tailSize = Math.min(size, 65536);
    const buf = Buffer.alloc(tailSize);
    fs.readSync(fd, buf, 0, tailSize, size - tailSize);
    return buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  } finally {
    fs.closeSync(fd);
  }
}

function validateStacZip(zipPath: string, stacFolder: string): { ok: true } | { ok: false; error: string } {
  if (!isZipArchiveComplete(zipPath)) {
    return { ok: false, error: 'ZIP missing end-of-central-directory' };
  }
  const kn = path.basename(zipPath, '.zip');
  const inner =
    stacFolder === 'fastighetsindelning'
      ? `fastighetsindelning_kn${kn}.gpkg`
      : stacFolder === 'byggnader'
        ? `byggnader_kn${kn}.gpkg`
        : stacFolder === 'marktacke'
          ? `marktacke_kn${kn}.gpkg`
          : `${stacFolder}_kn${kn}.gpkg`;
  const vsi = vsizipPath(zipPath, inner);
  if (!canOpenOgrSource(vsi) && !canOpenOgrSource(vsizipPath(zipPath))) {
    return { ok: false, error: 'GDAL cannot open zip via /vsizip/' };
  }
  return { ok: true };
}

async function fetchStacItem(collection: string, itemId: string): Promise<{ href: string }> {
  const token = await getAccessToken();
  const url = `${STAC_BASE}/collections/${collection}/items/${itemId}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`STAC item ${itemId} fetch failed (${response.status})`);
  }
  const item = (await response.json()) as { assets?: { data?: { href?: string } } };
  const href = item.assets?.data?.href;
  if (!href) throw new Error(`STAC item ${itemId} has no assets.data.href`);
  return { href };
}

async function downloadZip(href: string, destPath: string): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(href, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const tmpPath = `${destPath}.downloading`;
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tmpPath, buffer);
  if (fs.existsSync(destPath)) {
    fs.renameSync(destPath, `${destPath}.corrupt-${Date.now()}.bak`);
  }
  fs.renameSync(tmpPath, destPath);
}

function loadFailureZips(failuresPath: string): string[] {
  if (!fs.existsSync(failuresPath)) {
    throw new Error(`Failures file not found: ${failuresPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(failuresPath, 'utf8')) as {
    failures?: Array<{ zip: string }>;
  };
  return (parsed.failures ?? []).map((f) => f.zip).sort((a, b) => a.localeCompare(b, 'sv'));
}

function removeResolvedFailures(failuresPath: string, resolved: string[]): void {
  if (resolved.length === 0) return;
  const parsed = JSON.parse(fs.readFileSync(failuresPath, 'utf8')) as {
    failures?: Array<{ zip: string; error: string }>;
  };
  const resolvedSet = new Set(resolved);
  const remaining = (parsed.failures ?? []).filter((f) => !resolvedSet.has(f.zip));
  fs.writeFileSync(
    failuresPath,
    JSON.stringify({ failures: remaining, updated_at: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

export async function reharvestStacFailures(options: {
  stacFolder: string;
  version: string;
  failuresPath?: string;
  execute?: boolean;
  log?: Logger;
}): Promise<{ planned: number; fixed: string[]; stillBroken: string[] }> {
  const log = options.log ?? logger;
  const failuresPath =
    options.failuresPath ??
    (() => {
      const resolved = resolveStacMergeEntry(options.stacFolder);
      if (!resolved) throw new Error(`Unknown STAC folder "${options.stacFolder}"`);
      return path.join(
        MASTER_ARCHIVE_ROOT,
        'Data',
        resolved.provider,
        resolved.dataset,
        options.version,
        'merge-failures.json',
      );
    })();

  const zipNames = loadFailureZips(failuresPath);
  const archiveDir = path.join(STAC_ARCHIVE_ROOT, options.stacFolder);
  const collection = options.stacFolder;

  log.info(`Reharvest ${zipNames.length} failed STAC zip(s) from ${collection}`);
  log.info(`  Archive dir: ${archiveDir}`);
  log.info(`  Failures:    ${failuresPath}`);

  const fixed: string[] = [];
  const stillBroken: string[] = [];

  for (const zipName of zipNames) {
    const itemId = path.basename(zipName, '.zip');
    const destPath = path.join(archiveDir, zipName);

    if (!options.execute) {
      log.dry(`Would re-download ${zipName} (STAC item ${itemId}) → ${destPath}`);
      continue;
    }

    log.info(`  ↓ ${zipName} (item ${itemId})`);
    try {
      const { href } = await fetchStacItem(collection, itemId);
      await downloadZip(href, destPath);
      const validation = validateStacZip(destPath, options.stacFolder);
      if (!validation.ok) {
        throw new Error((validation as { ok: false; error: string }).error);
      }
      fixed.push(zipName);
      log.info(`  ✅ ${zipName} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      stillBroken.push(zipName);
      log.warn(`  ❌ ${zipName}: ${msg}`);
    }
  }

  if (options.execute && fixed.length > 0) {
    removeResolvedFailures(failuresPath, fixed);
    log.info(`Removed ${fixed.length} resolved zip(s) from merge-failures.json`);
  }

  if (!options.execute) {
    log.info(`Plan: ${zipNames.length} zip(s). Run with --execute to download.`);
  } else {
    log.info(`Done: ${fixed.length} fixed, ${stillBroken.length} still broken`);
    if (fixed.length > 0) {
      log.info('Next: npm run import:merge-stac-national -- --stac-folder fastighetsindelning --version <ver> --execute --resume');
    }
  }

  return { planned: zipNames.length, fixed, stillBroken };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await reharvestStacFailures({
    stacFolder: args.stacFolder,
    version: args.version,
    failuresPath: args.failuresPath,
    execute: args.execute,
    log: logger,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error('Fatal', err);
    process.exit(1);
  });
}
