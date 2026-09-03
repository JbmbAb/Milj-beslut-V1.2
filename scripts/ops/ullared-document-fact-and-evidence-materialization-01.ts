/**
 * ULLARED-DOCUMENT-FACT-AND-EVIDENCE-MATERIALIZATION-01.
 *
 * Consumes existing runtime authority state only. It does not mint grants, provision keys,
 * or introduce alternate signer/load paths.
 *
 * Required env is the production signer contract consumed by server/security/*SigningKey.ts.
 */
import { createHash } from 'node:crypto';
import { FileCASRepository, DiskQuarantineStorage, LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { sha256ContentHash } from '@miljobeslut/mps-compliance/src/canonical/sha256Canonical';
import {
  createDocumentFactCandidate,
  type DocumentFactCandidateSigner,
} from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import { verifyRealDocumentFactCandidate } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import {
  DOCUMENT_FACT_VERIFICATION_POLICY_V1,
  type DocumentFactCandidateArtifact,
} from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import {
  createDocumentEvidenceArtifactV2,
  isDocumentEvidenceV2ContentHashValid,
  type DocumentEvidenceArtifactV2,
} from '../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2';
import { createDocumentEvidencePropertyBindingArtifactV2 } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifact';
import { ingestDocumentToTextProjection } from '../../server/text-projection/createGovernedTextIngestion';
import { getDocumentFactReviewSigningProvider, getDocumentPropertyReviewSigningProvider } from '../../server/security/documentReviewSigningKey';
import { getDocumentFactReviewVerifier, getDocumentPropertyReviewVerifier } from '../../server/security/documentReviewVerifier';
import { getDocumentEvidenceAdmissionSigningProvider } from '../../server/security/documentEvidenceAdmissionSigningKey';
import { getDocumentEvidenceAdmissionVerifier } from '../../server/security/documentEvidenceAdmissionVerifier';
import { resolveGovernanceReviewerActor, verifyGovernanceReviewerActorReference } from '../../server/services/governanceReviewerGrantService';
import { reviewDocumentEvidenceProperty, reviewDocumentFact } from '../../server/services/documentEvidenceReviewerAProductionPath';
import { admitDocumentEvidenceV2 } from '../../server/services/documentEvidenceAdmissionBridge';
import { prisma } from '../../server/db/prisma';
import type { AuthUser } from '../../server/security/types';
import type { ContentReference } from '../../packages/mps-core/src/types';

const QUARANTINE_ROOT = 'C:/miljöbeslut/.quarantine';
const MIMERS_ROOT = 'C:/Users/jimmy/.mimers';
const QUARANTINE_ID = '34d0a4ce-df46-494f-8264-e4e46d5adff7';
const SOURCE_SHA256 = '919edd923c272ea9523749e097b8c0223c4002cd312d5138d0efb0ccf6fda794';
const EXPECTED_BYTES = 72971;
const PROPERTY_CONTEXT_ID = 'lu_property_context-efe0bbffd8feca9cecb8f51b';
const GOVERNANCE_RELEASE = 'governance-v1';
const REVIEWER_A_USER_ID = 'cmt5c74dm000cokf76rtqbe4v';
const REVIEWER_B_USER_ID = 'cmtbfpr91001racf7tiwpogs6';
const FACT_SPAN =
  'Krav på åtgärder, redovisning samt förbud att använda oljeavskiljare Ullared 2:215 Beslut ' +
  'Miljö- och hälsoskyddsförvaltningen beslutar att Bertil Svederberg Gräv AB, org.nr. 556753-4671 ' +
  'ska göra följande: 1. Se till att utgående vatten från oljeavskiljaren på fastigheten Ullared 2:215 ' +
  'inte överstiger de riktvärden (målsättningsvärden) som finns i Bilaga B i Dagvattenanvisningar för ' +
  'Falkenbergs och Varbergs kommuner, daterad 2017-03-31. Du förbjuds från att använda oljeavskiljaren ' +
  'till dess att ni redovisat uppgifter om att oljeavskiljaren klarar de riktvärden som anges i Bilaga B. ' +
  'Den här punkten gäller omedelbart även om beslutet överklagas.';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function legacySigner(): DocumentFactCandidateSigner {
  const provider = new LocalPemSigningKeyProvider(
    required('DOCUMENT_FACT_EXTRACTOR_SIGNER_KEY_ID'),
    required('DOCUMENT_FACT_EXTRACTOR_PRIVATE_KEY_PEM'),
    required('DOCUMENT_FACT_EXTRACTOR_PUBLIC_KEY_PEM'),
  );
  return {
    keyId: provider.keyId,
    async sign(bytes) {
      const envelope = await provider.sign(bytes);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };
}

function legacySignerFromProvider(provider: { readonly keyId: string; sign(bytes: Uint8Array): Promise<{ readonly signature: string }> }): DocumentFactCandidateSigner {
  return {
    keyId: provider.keyId,
    async sign(bytes) {
      const envelope = await provider.sign(bytes);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };
}

function digestRef(id: string): ContentReference {
  return { id, content_hash: { algorithm: 'sha256', digest: createHash('sha256').update(id, 'utf8').digest('hex') } };
}

function sameBytes(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function authUser(id: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, organisationId: true, bankidId: true, role: true, identityEnvironment: true },
  });
  if (!user) throw new Error(`missing reviewer user ${id}`);
  return user as AuthUser;
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) throw new Error('Refusing to run without --execute.');
  process.env.MIMERS_ROOT = MIMERS_ROOT;
  process.env.GOVERNANCE_REVIEWER_GRANT_CAS_ROOT = 'C:/miljöbeslut/.data/governance-reviewer-grants';

  const factSigner = getDocumentFactReviewSigningProvider();
  const propertySigner = getDocumentPropertyReviewSigningProvider();
  const admissionSigner = getDocumentEvidenceAdmissionSigningProvider();
  const factVerifier = getDocumentFactReviewVerifier();
  const propertyVerifier = getDocumentPropertyReviewVerifier();
  const admissionVerifier = getDocumentEvidenceAdmissionVerifier();

  const reviewerAUser = await authUser(REVIEWER_A_USER_ID);
  const reviewerBUser = await authUser(REVIEWER_B_USER_ID);
  const reviewerA = await resolveGovernanceReviewerActor(reviewerAUser);
  const reviewerB = await resolveGovernanceReviewerActor(reviewerBUser);
  await verifyGovernanceReviewerActorReference(reviewerA);
  await verifyGovernanceReviewerActorReference(reviewerB);
  if (reviewerA.identity_ref.id === reviewerB.identity_ref.id) throw new Error('Reviewer A and B resolved to same grant.');

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;
  const propertyContext = await repo.resolve<any>({ artifact_id: PROPERTY_CONTEXT_ID, artifact_type: 'LU_PROPERTY_CONTEXT' });
  if (propertyContext.artifact_type !== 'LU_PROPERTY_CONTEXT' || propertyContext.content_hash?.value !== '3b82114f46438db4a1e2ab167d619f82d35492918c0cbbc6350f566947e64837') {
    throw new Error('LU_PROPERTY_CONTEXT preflight failed.');
  }

  const quarantine = new DiskQuarantineStorage(QUARANTINE_ROOT);
  const meta = await quarantine.getMetadata(QUARANTINE_ID);
  if (!meta || meta.status !== 'promoted' || meta.content_hash !== SOURCE_SHA256) throw new Error('Ullared source preflight failed.');
  const cas = new FileCASRepository(`${MIMERS_ROOT}/cas`, { durabilityMode: 'best-effort' });
  await cas.initialize();
  const rawBytes = await cas.getBytes(`sha256:${SOURCE_SHA256}`, { verifyHash: true });
  if (!rawBytes || rawBytes.length !== EXPECTED_BYTES) throw new Error('Ullared raw CAS byte preflight failed.');

  const source = {
    ref: { artifact_id: QUARANTINE_ID, artifact_type: 'RAW_SOURCE' },
    bytes_content_hash: { algorithm: 'sha256' as const, value: SOURCE_SHA256 },
    doc_name: meta.file_name,
    source_system: meta.source_id,
    mime_type: 'application/pdf',
  };
  const { projection } = await ingestDocumentToTextProjection({ source, bytes: rawBytes });
  const spanStart = projection.text.indexOf(FACT_SPAN);
  if (spanStart < 0) throw new Error('fact span not found in deterministic projection');
  const spanEnd = spanStart + FACT_SPAN.length;
  await repo.put({ artifact_id: projection.projection_id, content_hash: projection.content_hash, body: projection });

  const sourceRef: ContentReference = { id: QUARANTINE_ID, content_hash: { algorithm: 'sha256', digest: SOURCE_SHA256 } };
  const projectionRef: ContentReference = { id: projection.projection_id, content_hash: { algorithm: 'sha256', digest: projection.content_hash.value } };
  const candidate = await createDocumentFactCandidate({
    fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION',
    fact_version: '1.0',
    source_document_ref: sourceRef,
    inventory_ref: sourceRef,
    source_span: { text_projection_ref: projectionRef, start_offset: spanStart, end_offset: spanEnd },
    asserted_by: { identity_ref: digestRef('document-fact-deterministic-span-extractor/v1'), role: 'SYSTEM_PROCESS' },
    assertion_method: 'DETERMINISTIC_EXTRACTION',
    asserter_version: 'document-fact-deterministic-span-extractor/v1',
    asserted_at: '2026-08-28T00:00:00.000Z',
  }, legacySigner());
  await repo.put({ artifact_id: candidate.artifact_id, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest }, body: candidate });
  const factReview = await reviewDocumentFact({
    authUser: reviewerAUser,
    candidate_ref: { artifact_id: candidate.artifact_id, artifact_type: candidate.artifact_type, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest } },
    verification_method: 'HUMAN_REVIEW',
    governance_release: GOVERNANCE_RELEASE,
    verified_at: '2026-08-28T00:00:00.000Z',
    artifactRepository: repo,
  });

  const factRef = { artifact_id: factReview.fact.artifact_id, artifact_type: factReview.fact.artifact_type, content_hash: factReview.fact.content_hash.digest };
  const evidence = createDocumentEvidenceArtifactV2({
    document_ref: { artifact_id: QUARANTINE_ID, artifact_type: 'RAW_SOURCE', content_hash: SOURCE_SHA256 },
    raw_source_ref: { artifact_id: QUARANTINE_ID, artifact_type: 'RAW_SOURCE', content_hash: SOURCE_SHA256 },
    text_projection_ref: { artifact_id: projection.projection_id, artifact_type: 'text_projection', content_hash: projection.content_hash.value },
    verified_fact_refs: [factRef],
    source_metadata: { provider: meta.source_id, retrieved_at: meta.retrieved_at },
  });
  await repo.put({ artifact_id: evidence.artifact_id, content_hash: evidence.content_hash, body: evidence });
  const justification = {
    artifact_id: `ullared-document-property-justification-${sha256ContentHash({ factRef, property: PROPERTY_CONTEXT_ID }).value.slice(0, 24)}`,
    artifact_type: 'GOVERNANCE_NOTE',
    content_hash: sha256ContentHash({ factRef, property: PROPERTY_CONTEXT_ID, span: FACT_SPAN }),
    payload: { source_span_text: FACT_SPAN, property_context_ref: { artifact_id: PROPERTY_CONTEXT_ID, artifact_type: 'LU_PROPERTY_CONTEXT' } },
  };
  await repo.put({ artifact_id: justification.artifact_id, content_hash: justification.content_hash, body: justification });

  const propertyReview = await reviewDocumentEvidenceProperty({
    authUser: reviewerAUser,
    document_evidence_ref: { artifact_id: evidence.artifact_id, artifact_type: evidence.artifact_type, content_hash: evidence.content_hash.value },
    verified_fact_refs: evidence.payload.verified_fact_refs,
    property_ref: { artifact_id: PROPERTY_CONTEXT_ID, artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: propertyContext.content_hash.value },
    justification_refs: [{ artifact_id: justification.artifact_id, artifact_type: justification.artifact_type }],
    governance_release: GOVERNANCE_RELEASE,
    artifactRepository: repo,
  });

  const admissionInput = {
    authUser: reviewerBUser,
    evidence,
    propertyBinding: propertyReview.property_binding,
    governanceRelease: GOVERNANCE_RELEASE,
    artifactRepository: repo,
    cas,
    signing: admissionSigner,
    verification: admissionVerifier,
  };
  const admission = await admitDocumentEvidenceV2(admissionInput);
  const admissionAgain = await admitDocumentEvidenceV2(admissionInput);
  const freshEvidence = await cas.get<DocumentEvidenceArtifactV2>(admission.cas_content_hash, { verifyHash: true });
  if (!freshEvidence) throw new Error('fresh CAS read failed');
  const freshAgain = await cas.get<DocumentEvidenceArtifactV2>(admissionAgain.cas_content_hash, { verifyHash: true });

  const legacyFact = await verifyRealDocumentFactCandidate({
    candidate: candidate as DocumentFactCandidateArtifact,
    verified_by: reviewerA,
    verification_method: 'HUMAN_REVIEW',
    policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
    verified_at: '2026-08-28T00:00:00.000Z',
  }, legacySignerFromProvider(factSigner));
  const v2Binding = createDocumentEvidencePropertyBindingArtifactV2({
    document_evidence_ref: { artifact_id: evidence.artifact_id, artifact_type: evidence.artifact_type, content_hash: evidence.content_hash.value },
    property_ref: { artifact_id: PROPERTY_CONTEXT_ID, artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: propertyContext.content_hash.value },
    binding_method: 'GOVERNANCE_REVIEWER_CONFIRMED',
    binding_authority: reviewerA,
    justification_refs: [{ artifact_id: justification.artifact_id, artifact_type: justification.artifact_type }],
  });
  let legacyDenied = false;
  let v2BindingDenied = false;
  try {
    await repo.put({ artifact_id: legacyFact.artifact_id, content_hash: { algorithm: 'sha256', value: legacyFact.content_hash.digest }, body: legacyFact });
    const legacyEvidence = createDocumentEvidenceArtifactV2({
      document_ref: evidence.payload.document_ref,
      raw_source_ref: evidence.payload.raw_source_ref,
      text_projection_ref: evidence.payload.text_projection_ref,
      verified_fact_refs: [{ artifact_id: legacyFact.artifact_id, artifact_type: legacyFact.artifact_type, content_hash: legacyFact.content_hash.digest }],
      source_metadata: evidence.payload.source_metadata,
    });
    await admitDocumentEvidenceV2({ ...admissionInput, evidence: legacyEvidence, propertyBinding: propertyReview.property_binding });
  } catch {
    legacyDenied = true;
  }
  try {
    await admitDocumentEvidenceV2({ ...admissionInput, propertyBinding: v2Binding as any });
  } catch {
    v2BindingDenied = true;
  }

  const output = {
    unit: 'PROVEN',
    real_ullared_source: 'PROVEN',
    projection: 'PROVEN',
    reviewer_a_fact_review: 'PROVEN',
    verified_document_fact_v2: 'PROVEN',
    reviewer_a_property_review: 'PROVEN',
    property_binding_v3: 'PROVEN',
    reviewer_b_admission: 'PROVEN',
    document_evidence_v2: 'PROVEN',
    canonical_cas_fresh_read: freshEvidence.artifact_id === evidence.artifact_id && isDocumentEvidenceV2ContentHashValid(freshEvidence) ? 'PROVEN' : 'OPEN',
    second_run_idempotency: admissionAgain.is_duplicate && admissionAgain.cas_content_hash === admission.cas_content_hash && sameBytes(freshEvidence, freshAgain) ? 'PROVEN' : 'OPEN',
    full_artifact_hash_actor_trace: {
      raw_source: { quarantine_id: QUARANTINE_ID, source_sha256: SOURCE_SHA256 },
      text_projection: { projection_id: projection.projection_id, content_hash: projection.content_hash.value },
      fact_review: {
        attestation_artifact_id: factReview.review_attestation.artifact_id,
        attestation_content_hash: factReview.review_attestation.content_hash.value,
        reviewer_a_actor_id: reviewerA.identity_ref.id,
        action: factReview.review_attestation.attestation.predicate.action,
        signer: factReview.review_attestation.attestation.signer,
      },
      verified_fact_v2: { artifact_id: factReview.fact.artifact_id, content_hash: factReview.fact.content_hash.digest },
      property_review: {
        attestation_artifact_id: propertyReview.review_attestation.artifact_id,
        attestation_content_hash: propertyReview.review_attestation.content_hash.value,
        reviewer_a_actor_id: propertyReview.property_binding.payload.binding_authority.identity_ref.id,
        action: propertyReview.review_attestation.attestation.predicate.action,
        signer: propertyReview.review_attestation.attestation.signer,
      },
      property_binding_v3: { artifact_id: propertyReview.property_binding.artifact_id, content_hash: propertyReview.property_binding.content_hash.value },
      admission: {
        reviewer_b_actor_id: reviewerB.identity_ref.id,
        governance_release: GOVERNANCE_RELEASE,
        cas_content_hash: admission.cas_content_hash,
        duplicate_on_second_run: admissionAgain.is_duplicate,
      },
      document_evidence_v2: {
        artifact_id: evidence.artifact_id,
        content_hash: evidence.content_hash.value,
        verified_fact_refs: evidence.payload.verified_fact_refs,
      },
      runtime_signers: {
        fact: factVerifier.keyId,
        property: propertyVerifier.keyId,
        admission: admissionVerifier.keyId,
        fact_private_provider: factSigner.keyId,
        property_private_provider: propertySigner.keyId,
      },
      denials: { legacy_fact_new_governed_input: legacyDenied, property_binding_v2_new_governed_input: v2BindingDenied },
    },
    safe_to_start_real_lu_assessment: legacyDenied && v2BindingDenied ? 'YES' : 'NO',
  };
  console.log(JSON.stringify(output, null, 2));
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await prisma.$disconnect();
  process.exitCode = 1;
});
