/**
 * DOCUMENT-EVIDENCE-PROPERTY-BINDING-CONTRACT-V2.
 *
 * Builds ONE real, canonical DocumentEvidenceArtifactV2 for the real, human-verified fact
 * (fact-verified-8386a613c27e89efa9d4bf2e, DOCUMENT-FACT-HUMAN-VERIFICATION-APPROVED-V1, commit
 * 7a6f919f), WITHOUT any property binding -- proving that real document truth can be canonical
 * without inventing cadastral truth, and that the fail-closed LU-admission rule genuinely
 * refuses this evidence for property-specific use until a real binding exists.
 *
 * Does NOT write anything to CAS (governance-owned CAS admission is Unit E, resumed separately
 * after this contract correction). Does NOT wire into LU. Does NOT bind to a property.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-document-evidence-v2-unbound-01.ts --execute
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { FileCASRepository, DiskQuarantineStorage, LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { ingestDocumentToTextProjection } from '../../server/text-projection/createGovernedTextIngestion';
import {
  createDocumentFactCandidate,
  type DocumentFactCandidateSigner,
} from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import {
  isVerifiedDocumentFactContentHashValid,
  verifyRealDocumentFactCandidate,
  type DocumentFactReviewSigner,
} from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1 } from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import {
  createDocumentEvidenceArtifactV2,
  isDocumentEvidenceV2ContentHashValid,
  type DocumentEvidenceHashedRef,
} from '../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2';
import { resolveDocumentEvidenceForPropertyAssessment } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyAdmission';
import type { ContentReference } from '../../packages/mps-core/src/types';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const EXTRACTOR_KEY_ID = 'ed25519:document-fact-extractor-v1';
const REVIEWER_KEY_ID = 'ed25519:document-fact-reviewer-v1';
const QUARANTINE_ID = '00019927-5933-499c-9be1-98991ad31f2f';
const REVIEWER_HUMAN_NAME = 'bjb@miljöbeslut.se';
const APPROVED_SPAN_TEXT =
  'äger skogsbruksfastigheten i Bollnäs kommun. Fastigheten omfattar 92 ha. Kärandena anmälde i ' +
  'januari 2018 en planerad föryngringsavverkning av ett område om 2,7 ha inom fastigheten. ' +
  'Skogsstyrelsen har i ett beslut den 29 juni 2018 vid vite förbjudit all form av avverkning ' +
  'inom det anmälda området.';
const EXPECTED_VERIFIED_FACT_ID = 'fact-verified-8386a613c27e89efa9d4bf2e';

function loadOrGenerateKey(name: string, keyId: string) {
  const dir = `${SECRETS_DIR}/${name}`;
  const privatePath = `${dir}/private.pem`;
  const publicPath = `${dir}/public.pem`;
  if (existsSync(privatePath) && existsSync(publicPath)) {
    return { keyId, privatePem: readFileSync(privatePath, 'utf8'), publicPem: readFileSync(publicPath, 'utf8') };
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate(keyId);
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey);
  return { keyId, privatePem: privateKey, publicPem: publicKey };
}

async function main() {
  console.log('########## PROVE-DOCUMENT-EVIDENCE-V2-UNBOUND-01 ##########\n');
  if (!process.argv.includes('--execute')) throw new Error('Refusing to run without --execute.');

  const quarantineRoot = process.env.QUARANTINE_ROOT || path.resolve('.quarantine');
  const mimersRoot = process.env.MIMERS_ROOT || path.resolve('.data/mimers');
  const durabilityMode = (process.env.MIMERS_DURABILITY_MODE || 'best-effort') as 'strict' | 'best-effort' | 'none';

  console.log('=== STEP 1: rebuild the real chain through to VerifiedDocumentFactArtifact ===\n');
  const cas = new FileCASRepository(path.join(mimersRoot, 'cas'), { durabilityMode });
  await cas.initialize();
  const quarantine = new DiskQuarantineStorage(quarantineRoot);
  const meta = await quarantine.getMetadata(QUARANTINE_ID);
  if (!meta) throw new Error('quarantine metadata not found');
  if (meta.status !== 'promoted') throw new Error(`REJECT: not promoted (status=${meta.status})`);
  const bytes = await cas.getBytes(`sha256:${meta.content_hash}`, { verifyHash: true });
  if (!bytes) throw new Error('CAS retrieval failed');
  const source = {
    ref: { artifact_id: QUARANTINE_ID, artifact_type: 'RAW_SOURCE' },
    bytes_content_hash: { algorithm: 'sha256' as const, value: meta.content_hash },
    doc_name: meta.file_name,
    source_system: meta.source_id,
    mime_type: 'application/pdf',
  };
  const { projection } = await ingestDocumentToTextProjection({ source, bytes });

  const documentRef: ContentReference = { id: QUARANTINE_ID, content_hash: { algorithm: 'sha256', digest: meta.content_hash } };
  const projectionRef: ContentReference = { id: projection.projection_id, content_hash: { algorithm: 'sha256', digest: projection.content_hash.value } };
  const extractorIdentityId = 'document-fact-deterministic-span-extractor/v1';
  const extractorIdentityRef: ContentReference = {
    id: extractorIdentityId,
    content_hash: { algorithm: 'sha256', digest: createHash('sha256').update(extractorIdentityId, 'utf8').digest('hex') },
  };
  const extractorKey = loadOrGenerateKey('document-fact-extractor-signing-key-v1', EXTRACTOR_KEY_ID);
  const extractorSigningProvider = new LocalPemSigningKeyProvider(extractorKey.keyId, extractorKey.privatePem, extractorKey.publicPem);
  const extractorSigner: DocumentFactCandidateSigner = {
    keyId: extractorKey.keyId,
    async sign(payload) {
      const envelope = await extractorSigningProvider.sign(payload);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };

  const start = projection.text.indexOf(APPROVED_SPAN_TEXT);
  if (start < 0) throw new Error('REJECT: approved span text not found in real projection.');
  const end = start + APPROVED_SPAN_TEXT.length;

  const candidate = await createDocumentFactCandidate(
    {
      fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION',
      fact_version: '1.0',
      source_document_ref: documentRef,
      inventory_ref: documentRef,
      source_span: { text_projection_ref: projectionRef, start_offset: start, end_offset: end },
      asserted_by: { identity_ref: extractorIdentityRef, role: 'SYSTEM_PROCESS' },
      assertion_method: 'DETERMINISTIC_EXTRACTION',
      asserter_version: extractorIdentityId,
      asserted_at: '2026-08-24T14:45:00.000Z',
    },
    extractorSigner,
  );

  const reviewerKey = loadOrGenerateKey('document-fact-reviewer-signing-key-v1', REVIEWER_KEY_ID);
  const reviewerSigningProvider = new LocalPemSigningKeyProvider(reviewerKey.keyId, reviewerKey.privatePem, reviewerKey.publicPem);
  const reviewerSigner: DocumentFactReviewSigner = {
    keyId: reviewerKey.keyId,
    async sign(payload) {
      const envelope = await reviewerSigningProvider.sign(payload);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };
  const reviewerIdentityRef: ContentReference = {
    id: REVIEWER_HUMAN_NAME,
    content_hash: { algorithm: 'sha256', digest: createHash('sha256').update(REVIEWER_HUMAN_NAME, 'utf8').digest('hex') },
  };

  const verifiedFact = await verifyRealDocumentFactCandidate(
    {
      candidate,
      verified_by: { identity_ref: reviewerIdentityRef, role: 'GOVERNANCE_REVIEWER' },
      verification_method: 'HUMAN_REVIEW',
      policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
      verified_at: '2026-08-24T13:09:40.952Z',
    },
    reviewerSigner,
  );

  const verifiedFactMatches = verifiedFact.artifact_id === EXPECTED_VERIFIED_FACT_ID;
  console.log(`  rebuilt verified fact matches commit 7a6f919f exactly: ${verifiedFactMatches} (${verifiedFact.artifact_id})`);
  const factSelfConsistent = isVerifiedDocumentFactContentHashValid(verifiedFact);
  console.log(`  verified fact self-consistency: ${factSelfConsistent}\n`);
  if (!verifiedFactMatches) throw new Error('REJECT: rebuilt verified fact identity mismatch.');

  console.log('=== STEP 2: build ONE real DocumentEvidenceArtifactV2 -- NO property binding ===\n');
  const documentRefHashed: DocumentEvidenceHashedRef = { artifact_id: QUARANTINE_ID, artifact_type: 'RAW_SOURCE', content_hash: meta.content_hash };
  const projectionRefHashed: DocumentEvidenceHashedRef = { artifact_id: projection.projection_id, artifact_type: 'text_projection', content_hash: projection.content_hash.value };
  const verifiedFactRefHashed: DocumentEvidenceHashedRef = { artifact_id: verifiedFact.artifact_id, artifact_type: verifiedFact.artifact_type, content_hash: verifiedFact.content_hash.digest };

  const evidenceInput = {
    document_ref: documentRefHashed,
    raw_source_ref: documentRefHashed,
    text_projection_ref: projectionRefHashed,
    verified_fact_refs: [verifiedFactRefHashed],
    source_metadata: { provider: meta.source_id, retrieved_at: new Date().toISOString() },
  };
  const evidence = createDocumentEvidenceArtifactV2(evidenceInput);

  console.log(`  evidence artifact_id: ${evidence.artifact_id}`);
  console.log(`  evidence content_hash: ${evidence.content_hash.value}`);
  const noPropertyRef = !('property_ref' in evidence.payload);
  console.log(`  no property_ref field anywhere on payload: ${noPropertyRef}\n`);

  console.log('=== STEP 3: exact VerifiedDocumentFact binding ===\n');
  const bindsExactFact =
    evidence.payload.verified_fact_refs.length === 1 &&
    evidence.payload.verified_fact_refs[0].artifact_id === EXPECTED_VERIFIED_FACT_ID &&
    evidence.payload.verified_fact_refs[0].content_hash === verifiedFact.content_hash.digest;
  console.log(`  binds exactly fact-verified-8386a613c27e89efa9d4bf2e: ${bindsExactFact}\n`);

  console.log('=== STEP 4: deterministic identity across two independent runs (different retrieved_at) ===\n');
  const evidenceRerun = createDocumentEvidenceArtifactV2({ ...evidenceInput, source_metadata: { ...evidenceInput.source_metadata, retrieved_at: new Date(Date.now() + 60_000).toISOString() } });
  const deterministic = evidence.artifact_id === evidenceRerun.artifact_id;
  console.log(`  deterministic: ${deterministic}\n`);

  console.log('=== STEP 5: independent rehash (self-consistency) ===\n');
  const rehashValid = isDocumentEvidenceV2ContentHashValid(evidence);
  console.log(`  independent rehash valid: ${rehashValid}\n`);

  console.log('=== STEP 6: tamper -> DENY ===\n');
  const tampered = { ...evidence, payload: { ...evidence.payload, verified_fact_refs: [{ ...verifiedFactRefHashed, content_hash: '0'.repeat(64) }] } };
  const tamperDenied = !isDocumentEvidenceV2ContentHashValid(tampered);
  console.log(`  tamper denied: ${tamperDenied}\n`);

  console.log('=== STEP 7: fail-closed LU admission -- NO binding exists, so NO admission ===\n');
  const decision = resolveDocumentEvidenceForPropertyAssessment(evidence, 'property-bollnas-unknown', []);
  console.log(`  admitted: ${decision.admitted}`);
  if (!decision.admitted) console.log(`  reason: ${decision.reason}`);
  console.log();

  const ok = verifiedFactMatches && factSelfConsistent && noPropertyRef && bindsExactFact && deterministic && rehashValid && tamperDenied && !decision.admitted;

  console.log('════════════════════════════════════════════════════════════════');
  console.log(' REAL, UNBOUND DocumentEvidenceArtifactV2');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`\nALL GREEN: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
