import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const OGRINFO = 'C:\\Program Files\\QGIS 4.0.2\\bin\\ogrinfo.exe';
const CHECKPOINT_VERSION = 'lm-byggnader-legacy-master-precheck-v1';

type CheckpointStatus = 'PROVEN' | 'FAILED_CLOSED';

interface CheckpointEntry {
  readonly municipality_id: string;
  readonly status: CheckpointStatus;
  readonly sha256?: string;
  readonly size_bytes?: number;
  readonly schema_check?: {
    readonly layer: 'byggnad';
    readonly geometry: 'MULTIPOLYGON';
    readonly crs: 'EPSG:3006';
    readonly required_fields: readonly ['objektidentitet', 'geometri'];
  };
  readonly failure_code?: string;
  readonly failure_reason?: string;
  readonly checked_at: string;
}

interface CheckpointState {
  readonly checkpoint_version: typeof CHECKPOINT_VERSION;
  readonly source_family: 'LANTMATERIET_STAC_BYGGNADER';
  readonly entries: Record<string, CheckpointEntry>;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function municipalityFromFilename(filename: string): string {
  const match = /^(\d{4})\.zip$/i.exec(filename);
  if (!match) throw new Error(`REJECT_FILENAME: ${filename} must be NNNN.zip.`);
  return match[1];
}

function inspect(zipPath: string, municipality: string): CheckpointEntry['schema_check'] {
  const gpkg = `/vsizip/${zipPath.replace(/\\/g, '/')}/byggnad_kn${municipality}.gpkg`;
  const output = execFileSync(OGRINFO, ['-ro', '-so', gpkg, 'byggnad'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const checks: readonly [RegExp, string][] = [
    [/Layer name:\s*byggnad/i, 'layer byggnad'],
    [/Geometry:\s*Multi Polygon/i, 'Multi Polygon'],
    [/EPSG",3006/i, 'EPSG:3006'],
    [/Geometry Column\s*=\s*geometri/i, 'geometry column geometri'],
    [/objektidentitet\s*:/i, 'objektidentitet'],
  ];
  const missing = checks.filter(([pattern]) => !pattern.test(output)).map(([, label]) => label);
  if (missing.length) throw new Error(`REJECT_GPKG_CONTRACT: missing ${missing.join(', ')}.`);
  return {
    layer: 'byggnad',
    geometry: 'MULTIPOLYGON',
    crs: 'EPSG:3006',
    required_fields: ['objektidentitet', 'geometri'],
  };
}

async function loadCheckpoint(path: string): Promise<CheckpointState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CheckpointState;
    if (parsed.checkpoint_version !== CHECKPOINT_VERSION || parsed.source_family !== 'LANTMATERIET_STAC_BYGGNADER') {
      fail('REJECT_CHECKPOINT_SCHEMA: checkpoint belongs to another contract.');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { checkpoint_version: CHECKPOINT_VERSION, source_family: 'LANTMATERIET_STAC_BYGGNADER', entries: {} };
    }
    throw error;
  }
}

async function persistCheckpoint(path: string, state: CheckpointState): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function main(): Promise<void> {
  const root = arg('root');
  const checkpointPath = arg('checkpoint');
  const retryFailed = process.argv.includes('--retry-failed');
  if (!root || !checkpointPath) {
    fail('Usage: --root <Master directory> --checkpoint <state JSON> [--retry-failed].');
  }
  const checkpoint = await loadCheckpoint(resolve(checkpointPath));
  const files = (await readdir(resolve(root), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{4}\.zip$/i.test(entry.name) && entry.name !== '1762.zip')
    .map((entry) => entry.name)
    .sort();
  if (files.length !== 289) fail(`REJECT_BATCH_SCOPE: expected 289 unadmitted ZIPs, got ${files.length}.`);

  let proven = 0;
  let failed = 0;
  let skipped = 0;
  for (const filename of files) {
    const municipality_id = municipalityFromFilename(filename);
    const prior = checkpoint.entries[municipality_id];
    if (prior?.status === 'PROVEN' || (prior?.status === 'FAILED_CLOSED' && !retryFailed)) {
      skipped += 1;
      continue;
    }

    const checked_at = new Date().toISOString();
    try {
      const path = join(resolve(root), filename);
      const [bytes, fileStat] = await Promise.all([readFile(path), stat(path)]);
      const schema_check = inspect(path, municipality_id);
      checkpoint.entries[municipality_id] = {
        municipality_id,
        status: 'PROVEN',
        sha256: sha256(bytes),
        size_bytes: fileStat.size,
        schema_check,
        checked_at,
      };
      proven += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const [failure_code = 'REJECT_PRECHECK', failure_reason = message] = message.split(': ', 2);
      checkpoint.entries[municipality_id] = {
        municipality_id,
        status: 'FAILED_CLOSED',
        failure_code,
        failure_reason,
        checked_at,
      };
      failed += 1;
    }
    await persistCheckpoint(resolve(checkpointPath), checkpoint);
  }

  const totalProven = Object.values(checkpoint.entries).filter((entry) => entry.status === 'PROVEN').length;
  const totalFailed = Object.values(checkpoint.entries).filter((entry) => entry.status === 'FAILED_CLOSED').length;
  console.log(`BATCH_PRECHECK_PROVEN_THIS_RUN=${proven}`);
  console.log(`BATCH_PRECHECK_FAILED_THIS_RUN=${failed}`);
  console.log(`BATCH_PRECHECK_SKIPPED=${skipped}`);
  console.log(`BATCH_PRECHECK_TOTAL_PROVEN=${totalProven}`);
  console.log(`BATCH_PRECHECK_TOTAL_FAILED=${totalFailed}`);
  console.log(`CHECKPOINT=${resolve(checkpointPath)}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
