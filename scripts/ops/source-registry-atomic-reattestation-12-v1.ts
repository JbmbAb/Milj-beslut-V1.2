/**
 * SOURCE-REGISTRY-ATOMIC-REATTESTATION-12-V1.
 *
 * The owner-approved, all-or-nothing successor transition for the twelve active
 * entries signed by the unavailable 2026-08-14 governor. Historical bytes are
 * retained as a raw snapshot; they are deliberately not made an approved
 * historical store because their signer cannot currently be verified.
 *
 * Usage:
 *   npx tsx scripts/ops/source-registry-atomic-reattestation-12-v1.ts --execute
 *   npx tsx scripts/ops/source-registry-atomic-reattestation-12-v1.ts --verify-only
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

import { approveSourceRegistryEntry } from '../../packages/mps-data-governance/src/SourceApproval';
import {
  createSourceRegistryTrustedKeyring,
  loadVerifiedSourceRegistry,
  type SourceRegistryArtifact,
} from '../../packages/mps-data-governance/src/SourceRegistry';

const OWNER_APPROVER = 'bjb@miljöbeslut.se';
const SUCCESSOR_KEY_ID = 'ed25519:source-registry-governor-2026-08-25';
const HISTORICAL_KEY_ID = 'ed25519:source-registry-governor-2026-08-14';
const EXPECTED_BASE_SHA256 = '67bfed97478ef98d87aab19c48d45445effdf51ff0cb101949f8074db153ff05';
const BOVERKET_SUCCESSOR_ENDPOINT =
  'https://api.boverket.se/planbestammelsekatalogen/release/full/aktuell';
const ROOT = process.cwd();
const REGISTRY_PATH = path.join(ROOT, 'source-registry', 'national-registry.json');
const LEGACY_DIR = path.join(ROOT, 'source-registry', 'legacy');
const RAW_SNAPSHOT_PATH = path.join(LEGACY_DIR, 'active-registry-2026-08-14-unverifiable.json');
const MANIFEST_PATH = path.join(LEGACY_DIR, 'active-registry-2026-08-14-unverifiable.manifest.json');
const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets/source-registry-governor-signing-key-v1';
const PRIVATE_KEY_PATH = path.join(SECRETS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(SECRETS_DIR, 'public.pem');
const TRUSTED_KEYS_PATH = 'C:/Users/jimmy/.mimers/governance/source-registry-trusted-keys.json';

const EXPECTED_SOURCE_IDS = [
  'domstolsverket-puh-mmod',
  'regeringskansliet-sfs-1998-808',
  'regeringskansliet-sfs-2013-251',
  'regeringskansliet-sfs-2020-614',
  'regeringskansliet-sfs-2010-900',
  'regeringskansliet-sfs-2011-338',
  'regeringskansliet-sfs-1998-899',
  'hav-hvmfs-2016-17',
  'sgu-groundwater-influence-analytical-models',
  'sgu-well-drilling-guidance',
  'boverket-planbestammelser',
  'lantmateriet-stac-byggnader',
] as const;

function sha256(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function successorArtifactId(artifactId: string): string {
  if (artifactId === 'reg-dv-puh-mmod-003') return 'reg-dv-puh-mmod-004';
  if (artifactId.endsWith('-001')) return `${artifactId.slice(0, -3)}002`;
  throw new Error(`REJECT_UNEXPECTED_ARTIFACT_ID: '${artifactId}' is outside the approved 12-entry transition.`);
}

function assertApprovedBase(entries: readonly SourceRegistryArtifact[], raw: string): void {
  if (sha256(raw) !== EXPECTED_BASE_SHA256) {
    throw new Error('REJECT_BASELINE_DRIFT: active registry bytes differ from the owner-reviewed 4583b402 base.');
  }
  if (entries.length !== EXPECTED_SOURCE_IDS.length) {
    throw new Error(`REJECT_ENTRY_COUNT: expected ${EXPECTED_SOURCE_IDS.length}, got ${entries.length}.`);
  }
  const actual = entries.map((entry) => entry.source_id).sort();
  const expected = [...EXPECTED_SOURCE_IDS].sort();
  if (actual.join('\n') !== expected.join('\n')) {
    throw new Error('REJECT_SOURCE_SET_DRIFT: active source IDs differ from the approved 12-entry set.');
  }
  for (const entry of entries) {
    if (entry.lifecycle_state !== 'APPROVED' || entry.approval_attestation.signer !== HISTORICAL_KEY_ID) {
      throw new Error(`REJECT_NON_HISTORICAL_ACTIVE_ENTRY: '${entry.artifact_id}' is not an approved ${HISTORICAL_KEY_ID} entry.`);
    }
  }
}

function createDraft(entry: SourceRegistryArtifact): Omit<SourceRegistryArtifact, 'approval_attestation'> {
  const { approval_attestation: _historicalAttestation, ...draft } = entry;
  const channel = entry.source_id === 'boverket-planbestammelser'
    ? { ...draft.channel, endpoint_url: BOVERKET_SUCCESSOR_ENDPOINT }
    : draft.channel;
  return {
    ...draft,
    artifact_id: successorArtifactId(entry.artifact_id),
    lifecycle_state: 'REGISTERED',
    channel,
  };
}

function writeAtomically(destination: string, content: string): void {
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  try {
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

function buildManifest(successors: readonly SourceRegistryArtifact[], rawSnapshotSha256: string) {
  return {
    classification: 'HISTORICAL_SOURCE_REGISTRY_SNAPSHOT_METADATA',
    status: 'SUPERSEDED_BY_SOURCE_REGISTRY_ATOMIC_REATTESTATION_12_V1',
    verification_status: 'UNVERIFIABLE_UNTIL_REAL_HISTORICAL_PUBLIC_KEY_IS_RECOVERED',
    raw_snapshot_file: path.basename(RAW_SNAPSHOT_PATH),
    raw_snapshot_sha256: rawSnapshotSha256,
    historical_signer_key_id: HISTORICAL_KEY_ID,
    successor_signer_key_id: SUCCESSOR_KEY_ID,
    successor_entries: successors.map((entry) => ({
      source_id: entry.source_id,
      artifact_id: entry.artifact_id,
    })),
    invariants: [
      'The raw snapshot is not an approved historical authority store.',
      'No historical artifact_id is relinked to a successor artifact.',
      'No historical signature is re-signed or treated as verified.',
    ],
  };
}

async function verifyOnly(): Promise<void> {
  if (!existsSync(TRUSTED_KEYS_PATH)) throw new Error(`REJECT_TRUSTED_KEYS_MISSING: '${TRUSTED_KEYS_PATH}' is required.`);
  const registry = await loadVerifiedSourceRegistry({
    registryPath: REGISTRY_PATH,
    trustedKeyring: createSourceRegistryTrustedKeyring(
      new Map(Object.entries(JSON.parse(readFileSync(TRUSTED_KEYS_PATH, 'utf8')) as Record<string, string>)),
    ),
  });
  if (registry.sources.length !== EXPECTED_SOURCE_IDS.length) throw new Error('REJECT_SUCCESSOR_ENTRY_COUNT');
  console.log(`VERIFY_ONLY_PASS: ${registry.sources.length}/12 successor entries verified with persisted public-key trust.`);
}

async function execute(): Promise<void> {
  for (const required of [PRIVATE_KEY_PATH, PUBLIC_KEY_PATH]) {
    if (!existsSync(required)) throw new Error(`REJECT_SIGNING_MATERIAL_MISSING: '${required}'.`);
  }
  const raw = readFileSync(REGISTRY_PATH, 'utf8');
  const historical = JSON.parse(raw) as SourceRegistryArtifact[];
  assertApprovedBase(historical, raw);

  const privateKeyPem = readFileSync(PRIVATE_KEY_PATH, 'utf8');
  const publicKeyPem = readFileSync(PUBLIC_KEY_PATH, 'utf8');
  const signing = new LocalPemSigningKeyProvider(SUCCESSOR_KEY_ID, privateKeyPem, publicKeyPem);
  const successors = await Promise.all(historical.map((entry) => approveSourceRegistryEntry({
    entry: createDraft(entry),
    approver_actor_id: OWNER_APPROVER,
    signing,
  })));

  const keyring = createSourceRegistryTrustedKeyring(new Map([[SUCCESSOR_KEY_ID, publicKeyPem]]));
  const candidatePath = path.join(LEGACY_DIR, `candidate-${process.pid}.json`);
  writeFileSync(candidatePath, JSON.stringify(successors, null, 2) + '\n', 'utf8');
  try {
    const verified = await loadVerifiedSourceRegistry({ registryPath: candidatePath, trustedKeyring: keyring });
    if (verified.sources.length !== EXPECTED_SOURCE_IDS.length) throw new Error('REJECT_CANDIDATE_ENTRY_COUNT');
  } finally {
    rmSync(candidatePath, { force: true });
  }

  mkdirSync(LEGACY_DIR, { recursive: true });
  if (existsSync(RAW_SNAPSHOT_PATH) || existsSync(MANIFEST_PATH)) {
    throw new Error('REJECT_HISTORICAL_DESTINATION_EXISTS: refusing to overwrite a preserved snapshot or manifest.');
  }
  mkdirSync(path.dirname(TRUSTED_KEYS_PATH), { recursive: true });
  if (existsSync(TRUSTED_KEYS_PATH)) {
    throw new Error(`REJECT_TRUSTED_KEYS_EXISTS: refusing to overwrite '${TRUSTED_KEYS_PATH}'.`);
  }
  // Establish verify-only trust before making the successor registry active.
  writeFileSync(TRUSTED_KEYS_PATH, JSON.stringify({ [SUCCESSOR_KEY_ID]: publicKeyPem }, null, 2) + '\n', 'utf8');
  // Archive first: it is non-runtime history. Replacing the active registry is the only runtime switch.
  writeFileSync(RAW_SNAPSHOT_PATH, raw, 'utf8');
  writeFileSync(MANIFEST_PATH, JSON.stringify(buildManifest(successors, sha256(raw)), null, 2) + '\n', 'utf8');
  writeAtomically(REGISTRY_PATH, JSON.stringify(successors, null, 2) + '\n');
  console.log('EXECUTE_PASS: successor registry and verify-only public-key trust material persisted.');
}

async function main(): Promise<void> {
  const verify = process.argv.includes('--verify-only');
  const run = process.argv.includes('--execute');
  if (verify === run) throw new Error('Use exactly one of --execute or --verify-only.');
  if (verify) await verifyOnly();
  else await execute();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
