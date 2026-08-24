/**
 * DOCUMENT-EVIDENCE-CANONICAL-ADMISSION-V1 (resumed on the V2 contract).
 *
 * Admits ONE real DocumentEvidenceArtifactV2, built from the real, human-verified fact
 * (fact-verified-8386a613c27e89efa9d4bf2e, commit 7a6f919f), through the governance-owned
 * DocumentEvidenceAdmitter (packages/mps-data-governance/src/DocumentEvidenceAdmission.ts) into
 * the real local CAS. Proves the full write -> read -> independently recompute roundtrip,
 * idempotent re-admission, and a set of negative proofs (tampered content_hash, wrong signer
 * key, wrong action, legacy "uncalculated" shape, fabricated property_ref).
 *
 * Does NOT create a DocumentEvidencePropertyBindingArtifact. Proves the evidence remains
 * legitimately UNBOUND and that resolveDocumentEvidenceForPropertyAssessment still denies it for
 * property-specific LU use even after real canonical CAS admission -- canonical evidence does
 * not imply property-bound LU evidence.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-document-evidence-canonical-admission-01.ts --execute
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  FileCASRepository,
  DiskQuarantineStorage,
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
  canonicalizeStrict,
  type ArtifactAttestation,
} from '@miljobeslut/mimers-brunn-core';
import { ingestDocumentToTextProjection } from '../../server/text-projection/createGovernedTextIngestion';
import {
  createDocumentFactCandidate,
  type DocumentFactCandidateSigner,
} from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import {
  verifyRealDocumentFactCandidate,
  type DocumentFactReviewSigner,
} from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1 } from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import {
  createDocumentEvidenceArtifactV2,
  recomputeDocumentEvidenceV2ContentHash,
  type DocumentEvidenceHashedRef,
  type DocumentEvidenceArtifactV2,
} from '../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2';
import { resolveDocumentEvidenceForPropertyAssessment } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyAdmission';
import {
  DocumentEvidenceAdmissionError,
  DocumentEvidenceAdmitter,
  DOCUMENT_EVIDENCE_ADMISSION_ACTION,
  DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
  DOCUMENT_EVIDENCE_ADMISSION_SCHEMA_VERSION,
  type AdmittableDocumentEvidenceV2,
  type DocumentEvidenceAdmissionPredicate,
} from '../../packages/mps-data-governance/src/DocumentEvidenceAdmission';
import type { ContentReference } from '../../packages/mps-core/src/types';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const EXTRACTOR_KEY_ID = 'ed25519:document-fact-extractor-v1';
const REVIEWER_KEY_ID = 'ed25519:document-fact-reviewer-v1';
const GOVERNANCE_KEY_ID = 'ed25519:governance-promotion-v1';
const GOVERNANCE_RELEASE = 'v1';
const APPROVER_ACTOR_ID = 'bjb@miljöbeslut.se';
const APPROVER_ROLE = 'ADMIN';
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
  console.log('########## PROVE-DOCUMENT-EVIDENCE-CANONICAL-ADMISSION-01 ##########\n');
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
  if (start < 0) throw new Error('REJECT: approved span text not found.');
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
  console.log(`  rebuilt verified fact matches commit 7a6f919f exactly: ${verifiedFactMatches}\n`);
  if (!verifiedFactMatches) throw new Error('REJECT: verified fact identity mismatch.');

  console.log('=== STEP 2: build the real, unbound DocumentEvidenceArtifactV2 ===\n');
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
  console.log(`  evidence content_hash: ${evidence.content_hash.value}\n`);

  console.log('=== STEP 3: governance-owned admission ===\n');
  const govKey = loadOrGenerateKey('governance-signing-key-v1', GOVERNANCE_KEY_ID);
  const govSigning = new LocalPemSigningKeyProvider(govKey.keyId, govKey.privatePem, govKey.publicPem);
  const admitter = new DocumentEvidenceAdmitter(cas, govSigning);
  const recompute = (a: AdmittableDocumentEvidenceV2) => recomputeDocumentEvidenceV2ContentHash(a as unknown as DocumentEvidenceArtifactV2);

  async function buildAttestation(target: AdmittableDocumentEvidenceV2, signer = govSigning): Promise<ArtifactAttestation> {
    const predicate: DocumentEvidenceAdmissionPredicate = {
      action: DOCUMENT_EVIDENCE_ADMISSION_ACTION,
      evidence_artifact_id: target.artifact_id,
      evidence_content_hash: target.content_hash.value,
      approver_actor_id: APPROVER_ACTOR_ID,
      approver_role: APPROVER_ROLE,
      governance_release: GOVERNANCE_RELEASE,
      attestation_schema_version: DOCUMENT_EVIDENCE_ADMISSION_SCHEMA_VERSION,
      signer_key_id: signer.keyId,
    };
    return createArtifactAttestation({
      subjectDigest: `sha256:${target.content_hash.value}`,
      predicateType: DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
      predicate: predicate as unknown as Record<string, unknown>,
      signing: signer,
    });
  }

  const attestation = await buildAttestation(evidence);
  const result = await admitter.admit(evidence, attestation, GOVERNANCE_RELEASE, recompute);
  console.log(`  cas_content_hash: ${result.cas_content_hash}`);
  console.log(`  is_duplicate (first write): ${result.is_duplicate}\n`);

  console.log('=== STEP 4: real CAS roundtrip -- read back, independently recompute, verify equality ===\n');
  const retrieved = await cas.get<AdmittableDocumentEvidenceV2>(result.cas_content_hash, { verifyHash: true });
  const retrievedMatches = retrieved !== null && canonicalizeStrict(retrieved) === canonicalizeStrict(evidence);
  const retrievedRecomputeValid = retrieved !== null && recompute(retrieved) === retrieved.content_hash.value;
  console.log(`  retrieved object deep-equals written object: ${retrievedMatches}`);
  console.log(`  retrieved object's content_hash independently recomputes correctly: ${retrievedRecomputeValid}\n`);

  console.log('=== STEP 5: idempotent re-admission of the exact same evidence ===\n');
  const attestation2 = await buildAttestation(evidence);
  const result2 = await admitter.admit(evidence, attestation2, GOVERNANCE_RELEASE, recompute);
  const idempotent = result2.cas_content_hash === result.cas_content_hash && result2.is_duplicate === true;
  console.log(`  second admission cas_content_hash matches: ${result2.cas_content_hash === result.cas_content_hash}`);
  console.log(`  second admission reports is_duplicate: ${result2.is_duplicate}\n`);

  console.log('=== NEGATIVE PROOFS ===\n');

  async function expectDenied(label: string, run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run();
      console.log(`  [${label}] FAILED TO DENY`);
      return false;
    } catch (err) {
      const denied = err instanceof DocumentEvidenceAdmissionError;
      console.log(`  [${label}] denied: ${denied} (${err instanceof Error ? err.message.slice(0, 90) : String(err)})`);
      return denied;
    }
  }

  const tamperedHash: AdmittableDocumentEvidenceV2 = { ...evidence, content_hash: { algorithm: 'sha256', value: '0'.repeat(64) } };
  const tamperedHashAttestation = await buildAttestation(tamperedHash);
  const denyTamperedHash = await expectDenied('tampered content_hash', () => admitter.admit(tamperedHash, tamperedHashAttestation, GOVERNANCE_RELEASE, recompute));

  const impostor = LocalPemSigningKeyProvider.generate('ed25519:impostor');
  const wrongSignerAttestation = await createArtifactAttestation({
    subjectDigest: `sha256:${evidence.content_hash.value}`,
    predicateType: DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
    predicate: {
      action: DOCUMENT_EVIDENCE_ADMISSION_ACTION,
      evidence_artifact_id: evidence.artifact_id,
      evidence_content_hash: evidence.content_hash.value,
      approver_actor_id: APPROVER_ACTOR_ID,
      approver_role: APPROVER_ROLE,
      governance_release: GOVERNANCE_RELEASE,
      attestation_schema_version: DOCUMENT_EVIDENCE_ADMISSION_SCHEMA_VERSION,
      signer_key_id: impostor.provider.keyId,
    },
    signing: impostor.provider,
  });
  const denyWrongSignerReal = await expectDenied('wrong signer key (real)', () => admitter.admit(evidence, wrongSignerAttestation, GOVERNANCE_RELEASE, recompute));

  const wrongActionAttestation = await createArtifactAttestation({
    subjectDigest: `sha256:${evidence.content_hash.value}`,
    predicateType: DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
    predicate: {
      action: 'document_evidence.delete',
      evidence_artifact_id: evidence.artifact_id,
      evidence_content_hash: evidence.content_hash.value,
      approver_actor_id: APPROVER_ACTOR_ID,
      approver_role: APPROVER_ROLE,
      governance_release: GOVERNANCE_RELEASE,
      attestation_schema_version: DOCUMENT_EVIDENCE_ADMISSION_SCHEMA_VERSION,
      signer_key_id: govSigning.keyId,
    },
    signing: govSigning,
  });
  const denyWrongAction = await expectDenied('wrong action', () => admitter.admit(evidence, wrongActionAttestation, GOVERNANCE_RELEASE, recompute));

  const legacyShaped: AdmittableDocumentEvidenceV2 = {
    artifact_id: `doc_ev_0_${Math.random().toString(36).slice(2)}`,
    artifact_type: 'DOCUMENT_EVIDENCE',
    content_hash: { algorithm: 'sha256', value: 'uncalculated' },
    payload: {
      contract_version: 'document-evidence-v2',
      document_ref: documentRefHashed,
      verified_fact_refs: [verifiedFactRefHashed],
      source_metadata: { provider: meta.source_id, retrieved_at: new Date().toISOString() },
    },
  };
  const legacyShapedAttestation = await buildAttestation(legacyShaped);
  const denyLegacyShaped = await expectDenied('legacy "uncalculated" shape', () => admitter.admit(legacyShaped, legacyShapedAttestation, GOVERNANCE_RELEASE, recompute));

  const fabricatedPropertyRef: AdmittableDocumentEvidenceV2 = {
    ...evidence,
    payload: { ...evidence.payload, property_ref: { artifact_id: 'guessed-property', artifact_type: 'PROPERTY' } },
  };
  const fabricatedPropertyRefAttestation = await buildAttestation(fabricatedPropertyRef);
  const denyFabricatedPropertyRef = await expectDenied('fabricated property_ref', () => admitter.admit(fabricatedPropertyRef, fabricatedPropertyRefAttestation, GOVERNANCE_RELEASE, recompute));

  console.log('\n=== STEP 6: unbound canonical evidence still denied for property-specific LU use ===\n');
  const decision = resolveDocumentEvidenceForPropertyAssessment(evidence, 'property-bollnas-unknown', []);
  console.log(`  admitted for property-specific LU: ${decision.admitted} (expected false)\n`);

  const ok =
    verifiedFactMatches && retrievedMatches && retrievedRecomputeValid && idempotent &&
    denyTamperedHash && denyWrongSignerReal && denyWrongAction && denyLegacyShaped && denyFabricatedPropertyRef &&
    !decision.admitted;

  console.log('════════════════════════════════════════════════════════════════');
  console.log(' REAL, CANONICALLY-ADMITTED (unbound) DocumentEvidenceArtifactV2');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`\ncas_content_hash: ${result.cas_content_hash}`);
  console.log(`\nALL GREEN: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
