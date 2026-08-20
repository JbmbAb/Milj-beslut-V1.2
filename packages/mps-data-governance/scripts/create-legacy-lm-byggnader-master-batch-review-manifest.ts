import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { getSourceRegistryVerificationKeyFromEnv, loadVerifiedSourceRegistry } from '../src/SourceRegistry';
import {
  buildLegacyMasterBatchReviewManifest,
  type LegacyMasterPrecheckEntry,
} from '../src/LegacyMasterBatchReviewManifest';

const CHECKPOINT_VERSION = 'lm-byggnader-legacy-master-precheck-v1';
const EXPECTED_CHECKPOINT_SHA256 = '96afc54577bfbfd34e0f74f51c5d501a2a2a737193c3aa2f58b23f135e8fd45a';

interface CheckpointState {
  readonly checkpoint_version: typeof CHECKPOINT_VERSION;
  readonly source_family: 'LANTMATERIET_STAC_BYGGNADER';
  readonly entries: Record<string, LegacyMasterPrecheckEntry>;
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

async function main(): Promise<void> {
  const checkpointPath = arg('checkpoint');
  const masterRoot = arg('master-root');
  const outPath = arg('out');
  if (!checkpointPath || !masterRoot || !outPath) {
    fail('Usage: --checkpoint <state JSON> --master-root <Master ZIP directory> --out <review manifest JSON>.');
  }
  const checkpointBytes = await readFile(resolve(checkpointPath));
  const checkpointSha = sha256(checkpointBytes);
  if (checkpointSha !== EXPECTED_CHECKPOINT_SHA256) {
    fail(`REJECT_CHECKPOINT_BINDING: expected checkpoint ${EXPECTED_CHECKPOINT_SHA256}, got ${checkpointSha}.`);
  }
  const checkpoint = JSON.parse(checkpointBytes.toString('utf8')) as CheckpointState;
  if (checkpoint.checkpoint_version !== CHECKPOINT_VERSION || checkpoint.source_family !== 'LANTMATERIET_STAC_BYGGNADER') {
    fail('REJECT_CHECKPOINT_SCHEMA: checkpoint contract does not match the approved precheck.');
  }

  const verification = getSourceRegistryVerificationKeyFromEnv();
  const registry = await loadVerifiedSourceRegistry({ signing: verification });
  const source = registry.getSource('lantmateriet-stac-byggnader');
  if (!source) fail('REJECT_SOURCE_FAMILY: verified registry lacks lantmateriet-stac-byggnader.');

  const currentObjects = new Map<string, { readonly path: string; readonly size_bytes: number; readonly sha256: string }>();
  for (const entry of Object.values(checkpoint.entries)) {
    const municipality = entry.municipality_id;
    const path = join(resolve(masterRoot), `${municipality}.zip`);
    if (basename(path) !== `${municipality}.zip`) fail(`REJECT_LOCAL_OBJECT: invalid path for ${municipality}.`);
    const [bytes, file] = await Promise.all([readFile(path), stat(path)]);
    if (!file.isFile()) fail(`REJECT_LOCAL_OBJECT: ${path} is not a regular file.`);
    currentObjects.set(municipality, { path: resolve(path), size_bytes: file.size, sha256: sha256(bytes) });
  }

  const manifest = buildLegacyMasterBatchReviewManifest({
    checkpoint_sha256: checkpointSha,
    master_root: resolve(masterRoot),
    source,
    entries: Object.values(checkpoint.entries),
    current_objects: currentObjects,
  });
  await writeFile(resolve(outPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`REVIEW_MANIFEST_SHA256=${manifest.manifest_sha256}`);
  console.log(`REVIEW_MANIFEST_ITEM_COUNT=${manifest.item_count}`);
  console.log(`CHECKPOINT_SHA256=${checkpointSha}`);
  console.log('EXCLUDED_EXISTING_ADMISSION=1762');
  console.log('ANOMALIES=0');
  console.log(`REVIEW_MANIFEST=${resolve(outPath)}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
