/**
 * DOCUMENT-SOURCE-TO-TEXT-PROJECTION-V1.
 *
 * Unit A+B of DOCUMENT-EVIDENCE-VERTICAL-SLICE-V1. Promotes ONE real quarantined Domstolsverket
 * MMOD (Mark- och miljööverdomstolen) court decision to governed CAS via the real, unmodified
 * QuarantinePromoter (ADR-042 Level 2 -- 7 cryptographic binding checks, server/routes/
 * governance.routes.ts's own real code path, not a shortcut), then runs the real, previously-
 * unwired createGovernedTextIngestion pipeline against the CAS-verified bytes, proving
 * deterministic text projection (run twice, identical content_hash).
 *
 * Idempotent: if the chosen quarantine item is already promoted, skips straight to text
 * projection using the CAS-retrieved bytes -- promotion is a genuine one-time governance event
 * (QuarantinePromoter.promote() refuses to re-promote an already-promoted item by design).
 *
 * Governance signing key: generated once via LocalPemSigningKeyProvider.generate() and persisted
 * to ~/.mimers/secrets/governance-signing-key-v1/{private,public}.pem on first run, reused on
 * subsequent runs -- same pattern as every other issuer key this session
 * (bootstrap-viewer-authority-persistent.ts et al). Never committed.
 *
 * Deliberately does NOT touch DocumentEvidenceArtifact/VerifiedDocumentFact/LU rule wiring --
 * those are later units (C onward) in DOCUMENT-EVIDENCE-VERTICAL-SLICE-V1.
 *
 * Usage:
 *   MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-document-source-to-text-projection-01.ts --execute
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  FileCASRepository,
  DiskQuarantineStorage,
  QuarantinePromoter,
  createArtifactAttestation,
  PROMOTION_ACTION,
  PROMOTION_ATTESTATION_PREDICATE_TYPE,
  PROMOTION_ATTESTATION_SCHEMA_VERSION,
  LocalPemSigningKeyProvider,
  type PromotionAttestationPredicate,
} from '@miljobeslut/mimers-brunn-core';
import { ingestDocumentToTextProjection } from '../../server/text-projection/createGovernedTextIngestion';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const GOVERNANCE_KEY_ID = 'ed25519:governance-promotion-v1';
const GOVERNANCE_RELEASE = 'v1';
// Real, identifiable operator identity -- this is a genuine governance admission event
// (admitting a document into CAS custody), not a fabricated/anonymous actor.
const APPROVER_ACTOR_ID = 'bjb@miljöbeslut.se';
const APPROVER_ROLE = 'ADMIN';

function loadOrGenerateGovernanceSigningKey(): { keyId: string; privatePem: string; publicPem: string } {
  const dir = `${SECRETS_DIR}/governance-signing-key-v1`;
  const privatePath = `${dir}/private.pem`;
  const publicPath = `${dir}/public.pem`;
  if (existsSync(privatePath) && existsSync(publicPath)) {
    return { keyId: GOVERNANCE_KEY_ID, privatePem: readFileSync(privatePath, 'utf8'), publicPem: readFileSync(publicPath, 'utf8') };
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate(GOVERNANCE_KEY_ID);
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey);
  console.log(`Generated new governance signing key -> ${dir}`);
  return { keyId: GOVERNANCE_KEY_ID, privatePem: privateKey, publicPem: publicKey };
}

function pickOneRealMmodQuarantineItem(quarantineRoot: string): string {
  const files = readdirSync(quarantineRoot).filter((f) => f.endsWith('.metadata.json'));
  for (const f of files) {
    const meta = JSON.parse(readFileSync(path.join(quarantineRoot, f), 'utf8'));
    if (meta.source_id === 'domstolsverket-puh-mmod') {
      return meta.quarantine_id as string;
    }
  }
  throw new Error('No domstolsverket-puh-mmod quarantine item found under ' + quarantineRoot);
}

async function main() {
  console.log('########## PROVE-DOCUMENT-SOURCE-TO-TEXT-PROJECTION-01 ##########\n');
  if (!process.argv.includes('--execute')) {
    throw new Error('Refusing to write without --execute (this promotes real state -- run deliberately, not accidentally).');
  }

  const quarantineRoot = process.env.QUARANTINE_ROOT || path.resolve('.quarantine');
  const mimersRoot = process.env.MIMERS_ROOT || path.resolve('.data/mimers');
  const results: Record<string, unknown> = {};

  const key = loadOrGenerateGovernanceSigningKey();
  const signing = new LocalPemSigningKeyProvider(key.keyId, key.privatePem, key.publicPem);

  // Windows has no equivalent to POSIX directory fsync -- 'strict' (the FileCASRepository
  // default) fails closed there by design. Matches server/routes/governance.routes.ts's own
  // MIMERS_DURABILITY_MODE default ('best-effort') for exactly this reason.
  const durabilityMode = (process.env.MIMERS_DURABILITY_MODE || 'best-effort') as 'strict' | 'best-effort' | 'none';
  const cas = new FileCASRepository(path.join(mimersRoot, 'cas'), { durabilityMode });
  await cas.initialize();
  const quarantine = new DiskQuarantineStorage(quarantineRoot);
  const promoter = new QuarantinePromoter(quarantine, cas, signing);

  console.log('=== STEP 1: select one real quarantined MMOD court decision ===\n');
  const quarantineId = pickOneRealMmodQuarantineItem(quarantineRoot);
  let meta = await quarantine.getMetadata(quarantineId);
  if (!meta) throw new Error(`metadata not found for ${quarantineId}`);
  console.log(`  quarantine_id: ${quarantineId}`);
  console.log(`  file_name: ${meta.file_name}`);
  console.log(`  source_url: ${meta.source_url}`);
  console.log(`  content_hash: ${meta.content_hash}`);
  console.log(`  status: ${meta.status}\n`);
  results.quarantine_id = quarantineId;
  results.source_file_name = meta.file_name;
  results.source_content_hash = meta.content_hash;

  console.log('=== STEP 2: real governed promotion (ADR-042 Level 2 -- 7 cryptographic checks) ===\n');
  if (meta.status === 'promoted') {
    console.log('  Already promoted in an earlier run -- skipping promotion, proceeding to CAS retrieval.\n');
    results.promotion = 'already_promoted';
  } else {
    const predicate: PromotionAttestationPredicate = {
      action: PROMOTION_ACTION,
      quarantine_artifact_id: quarantineId,
      quarantine_content_hash: meta.content_hash,
      approver_actor_id: APPROVER_ACTOR_ID,
      approver_role: APPROVER_ROLE,
      governance_release: GOVERNANCE_RELEASE,
      attestation_schema_version: PROMOTION_ATTESTATION_SCHEMA_VERSION,
      signer_key_id: signing.keyId,
    };
    const attestation = await createArtifactAttestation({
      subjectDigest: `sha256:${meta.content_hash}`,
      predicateType: PROMOTION_ATTESTATION_PREDICATE_TYPE,
      predicate: predicate as unknown as Record<string, unknown>,
      signing,
    });
    const promotion = await promoter.promote(quarantineId, attestation, GOVERNANCE_RELEASE);
    console.log(`  approval_hash: ${promotion.approval_hash}`);
    console.log(`  cas content_hash: ${promotion.content_hash}`);
    console.log(`  is_duplicate: ${promotion.is_duplicate}\n`);
    results.promotion = { approval_hash: promotion.approval_hash, cas_content_hash: promotion.content_hash };
  }

  meta = await quarantine.getMetadata(quarantineId);
  results.quarantine_status_after = meta!.status;

  console.log('=== STEP 3: retrieve bytes FROM CAS (not from the quarantine copy), hash-verified ===\n');
  const bytes = await cas.getBytes(`sha256:${meta!.content_hash}`, { verifyHash: true });
  if (!bytes) throw new Error('CAS retrieval failed -- promoted bytes not found or hash mismatch.');
  console.log(`  Retrieved ${bytes.length} bytes from CAS, hash independently re-verified on read.\n`);
  results.cas_bytes_length = bytes.length;

  console.log('=== STEP 4: governed text projection, run TWICE to prove determinism ===\n');
  const source = {
    ref: { artifact_id: quarantineId, artifact_type: 'RAW_SOURCE' },
    bytes_content_hash: { algorithm: 'sha256' as const, value: meta!.content_hash },
    doc_name: meta!.file_name,
    source_system: meta!.source_id,
    mime_type: 'application/pdf',
  };
  const run1 = await ingestDocumentToTextProjection({ source, bytes });
  const run2 = await ingestDocumentToTextProjection({ source, bytes });

  const deterministic = run1.projection.content_hash.value === run2.projection.content_hash.value;
  console.log(`  projection_id (run1): ${run1.projection.projection_id}`);
  console.log(`  projection_version: ${run1.projection.projection_version}`);
  console.log(`  content_hash (run1): ${run1.projection.content_hash.value}`);
  console.log(`  content_hash (run2): ${run2.projection.content_hash.value}`);
  console.log(`  char_count: ${run1.projection.char_count}`);
  console.log(`  extraction_status: ${run1.projection.extraction_status}`);
  console.log(`  ocr_used: ${run1.projection.ocr_used}`);
  console.log(`  source_artifact_ref bound: ${JSON.stringify(run1.projection.source_artifact_ref)}`);
  console.log(`  deterministic across two independent runs: ${deterministic}\n`);

  results.projection_content_hash = run1.projection.content_hash.value;
  results.projection_char_count = run1.projection.char_count;
  results.projection_extraction_status = run1.projection.extraction_status;
  results.projection_ocr_used = run1.projection.ocr_used;
  results.deterministic = deterministic;

  const ok = deterministic && run1.projection.char_count > 0 && run1.projection.source_artifact_ref.artifact_id === quarantineId;

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nALL GREEN: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
