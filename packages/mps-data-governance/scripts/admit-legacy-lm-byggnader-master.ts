import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { FileCASRepository } from '@miljobeslut/mimers-brunn-core';

import {
  attestLegacyMasterAdmission,
  createLegacyMasterAdmissionDraft,
  persistLegacyMasterAdmission,
} from '../src/LegacyMasterAdmission';
import { getSourceRegistrySigningKeyFromEnv, loadVerifiedSourceRegistry } from '../src/SourceRegistry';

/**
 * Owner-only provisioning command for P2-LM-BYGGNADER-LEGACY-MASTER-RECONCILIATION-ADMISSION-01.
 *
 * It intentionally does not download, enumerate STAC, write quarantine records, or import a
 * database. It records a current byte observation and its non-retroactive admission only.
 *
 * Required environment:
 *   SOURCE_REGISTRY_SIGNING_KEY_ID
 *   SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM
 *   SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM
 *   MIMERS_ROOT
 *
 * Example (owner terminal only):
 *   npx tsx packages/mps-data-governance/scripts/admit-legacy-lm-byggnader-master.ts \
 *     --file "H:\\...\\1762.zip" --municipality 1762 --approver "JbmbAb"
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  for (const forbidden of ['private-key', 'privateKey', 'key', 'pem']) {
    if (process.argv.includes(`--${forbidden}`)) {
      fail(`--${forbidden} is not accepted. The owner signing key is read only from the environment.`);
    }
  }

  const file = arg('file');
  const municipality = arg('municipality');
  const approver = arg('approver');
  const admittedAt = arg('admitted-at') ?? new Date().toISOString();
  const mimersRoot = process.env.MIMERS_ROOT?.trim();
  if (!file || !municipality || !approver || !mimersRoot) {
    fail('Usage: --file <Master ZIP> --municipality <NNNN> --approver <actor>; MIMERS_ROOT is required.');
  }

  const filePath = resolve(file);
  const bytes = readFileSync(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stats = statSync(filePath);
  if (!stats.isFile()) fail(`Not a regular file: ${filePath}`);

  const signing = getSourceRegistrySigningKeyFromEnv();
  const registry = await loadVerifiedSourceRegistry({ signing });
  const source = registry.getSource('lantmateriet-stac-byggnader');
  if (!source) fail('Verified registry does not contain lantmateriet-stac-byggnader.');

  const draft = createLegacyMasterAdmissionDraft({
    source,
    local_object_ref: {
      path: filePath,
      filename: basename(filePath),
      size_bytes: bytes.byteLength,
      sha256,
    },
    municipality_id: municipality,
    internal_asset_name: `byggnad_kn${municipality}.gpkg`,
    admitted_at: admittedAt,
  });
  const artifact = await attestLegacyMasterAdmission({
    draft,
    approver_actor_id: approver,
    signing,
  });

  const cas = new FileCASRepository(join(resolve(mimersRoot), 'cas'), { durabilityMode: 'best-effort' });
  await cas.initialize();
  const reference = await persistLegacyMasterAdmission({ artifact, verification: signing, cas });

  console.log('\nLegacy Master admission persisted.');
  console.log(`artifact_id: ${reference.artifact_id}`);
  console.log(`artifact_content_ref: ${reference.artifact_content_ref}`);
  console.log(`current_byte_observation_ref: ${reference.current_byte_observation_ref}`);
  console.log(
    'historical_acquisition: UNKNOWN (no manifest, quarantine, URL, timestamp, or item.updated asserted)',
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
