import { type ArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import { sha256ContentHash } from '@miljobeslut/mps-compliance/src/canonical/sha256Canonical';
import type { AuthUser } from '../security/types';
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactReference';
import type { ActorReference } from '@miljobeslut/mps-core/src/types';
import {
  DOCUMENT_FACT_REVIEW_ACTION,
  DOCUMENT_PROPERTY_REVIEW_ACTION,
} from '../../packages/mps-data-governance/src/DocumentReviewAuthority';
import {
  DOCUMENT_FACT_VERIFICATION_POLICY_V1,
  type DocumentFactCandidateArtifact,
  type DocumentFactVerificationMethod,
  type VerifiedDocumentFactArtifact,
} from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import {
  createDocumentReviewAttestation,
  validateDocumentReviewAttestationReference,
  type DocumentReviewAttestationArtifact,
} from '../../packages/mps-data-governance/src/DocumentReviewAttestation';
import { createVerifiedDocumentFactV2, type VerifiedDocumentFactArtifactV2 } from '../../packages/mps-data-governance/src/VerifiedDocumentFactV2';
import { verifyRealDocumentFactCandidate } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { createDocumentEvidencePropertyBindingArtifactV2 } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifact';
import { createDocumentEvidencePropertyBindingArtifactV3, type DocumentEvidencePropertyBindingArtifactV3 } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifactV3';
import { LU_PROPERTY_CONTEXT_ARTIFACT_TYPE } from '../../packages/mps-lu/src/artifacts/LUPropertyContextArtifact';
import { getDocumentFactReviewSigningProvider, getDocumentPropertyReviewSigningProvider } from '../security/documentReviewSigningKey';
import { getDocumentFactReviewVerifier, getDocumentPropertyReviewVerifier } from '../security/documentReviewVerifier';
import { resolveGovernanceReviewerActor } from './governanceReviewerGrantService';

type ArtifactRepository = Readonly<{
  resolve<T>(reference: Pick<ArtifactReference, 'artifact_id' | 'artifact_type'>): Promise<T>;
  put(artifact: { artifact_id: string; content_hash: { algorithm: string; value: string }; body: unknown }): Promise<void>;
}>;

type HashedArtifactReference = Readonly<{
  artifact_id: string;
  artifact_type: string;
  content_hash: string;
}>;

type ComplianceHashedArtifactReference = Readonly<{
  artifact_id: string;
  artifact_type: string;
  content_hash: { algorithm: 'sha256'; value: string };
}>;

export class DocumentReviewerAProductionPathRejected extends Error {
  constructor(reason: string) { super(`FAIL_CLOSED: ${reason}`); this.name = 'DocumentReviewerAProductionPathRejected'; }
}

function reviewRecord(kind: 'DOCUMENT_FACT_REVIEW' | 'DOCUMENT_EVIDENCE_PROPERTY_REVIEW', reviewedArtifactId: string, reviewedContentHash: string, attestation: ArtifactAttestation) {
  const body = { artifact_type: kind, reviewed_artifact_id: reviewedArtifactId, reviewed_content_hash: reviewedContentHash, attestation };
  const content_hash = sha256ContentHash(body);
  return { artifact_id: `${kind.toLowerCase()}-${content_hash.value.slice(0, 24)}`, content_hash, body };
}

function hashOf(value: unknown): string | undefined {
  const record = value as { content_hash?: { value?: unknown; digest?: unknown } };
  if (typeof record.content_hash?.value === 'string') return record.content_hash.value;
  return typeof record.content_hash?.digest === 'string' ? record.content_hash.digest : undefined;
}

function legacySignatureAdapter(signing: { readonly keyId: string; sign(bytes: Uint8Array): Promise<{ readonly signature: string }> }) {
  return {
    keyId: signing.keyId,
    async sign(bytes: Uint8Array): Promise<{ readonly signatureBase64: string }> {
      const envelope = await signing.sign(bytes);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };
}

async function reviewer(authUser: AuthUser): Promise<ActorReference> {
  const actor = await resolveGovernanceReviewerActor(authUser);
  if (actor.role !== 'GOVERNANCE_REVIEWER') throw new DocumentReviewerAProductionPathRejected('resolved actor is not GOVERNANCE_REVIEWER');
  return actor;
}

export async function reviewDocumentFact(input: {
  readonly authUser: AuthUser;
  readonly candidate_ref: ComplianceHashedArtifactReference;
  readonly verification_method: DocumentFactVerificationMethod;
  readonly governance_release: string;
  readonly verified_at: string;
  readonly artifactRepository: ArtifactRepository;
}): Promise<{ readonly fact: VerifiedDocumentFactArtifactV2; readonly review_attestation: DocumentReviewAttestationArtifact }> {
  if (!input.governance_release.trim()) {
    throw new DocumentReviewerAProductionPathRejected('governance_release is required');
  }
  const candidate = await input.artifactRepository.resolve<DocumentFactCandidateArtifact>(input.candidate_ref);
  if (candidate.artifact_type !== 'DOCUMENT_FACT_CANDIDATE' || hashOf(candidate) !== input.candidate_ref.content_hash.value) {
    throw new DocumentReviewerAProductionPathRejected('candidate reference does not resolve to the claimed candidate/hash');
  }
  const actor = await reviewer(input.authUser);
  const signing = getDocumentFactReviewSigningProvider();
  const fact = await verifyRealDocumentFactCandidate({
    candidate,
    verified_by: actor,
    verification_method: input.verification_method,
    policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
    verified_at: input.verified_at,
  }, legacySignatureAdapter(signing));
  await input.artifactRepository.put({ artifact_id: fact.artifact_id, content_hash: { algorithm: 'sha256', value: fact.content_hash.digest }, body: fact });
  const review = await createDocumentReviewAttestation({
    artifact_type: 'DOCUMENT_FACT_REVIEW_ATTESTATION',
    action: DOCUMENT_FACT_REVIEW_ACTION,
    subject_content_hash: fact.content_hash.digest,
    preimage: {
      action: DOCUMENT_FACT_REVIEW_ACTION,
      candidate_artifact_id: candidate.artifact_id,
      candidate_content_hash: candidate.content_hash.digest,
      fact_artifact_id: fact.artifact_id,
      fact_content_hash: fact.content_hash.digest,
      fact_type: fact.fact_type,
      source_projection_ref: fact.source_span.text_projection_ref,
      source_span: { start_offset: fact.source_span.start_offset, end_offset: fact.source_span.end_offset },
      reviewer_actor_ref: actor,
      reviewer_role: actor.role,
      governance_release: input.governance_release,
      signer_key_id: signing.keyId,
    },
    reviewer: actor,
    governance_release: input.governance_release,
    signing,
  });
  await input.artifactRepository.put({ artifact_id: review.artifact.artifact_id, content_hash: review.artifact.content_hash, body: review.artifact });
  const resolvedReview = await validateDocumentReviewAttestationReference({
    resolver: input.artifactRepository,
    ref: review.ref,
    expected_action: DOCUMENT_FACT_REVIEW_ACTION,
    expected_subject_digest: fact.content_hash.digest,
    expected_reviewer: actor,
    verification: getDocumentFactReviewVerifier(),
  });
  const factV2 = await createVerifiedDocumentFactV2(fact, review.ref as typeof review.ref & { readonly artifact_type: 'DOCUMENT_FACT_REVIEW_ATTESTATION' }, legacySignatureAdapter(signing));
  await input.artifactRepository.put({ artifact_id: factV2.artifact_id, content_hash: { algorithm: 'sha256', value: factV2.content_hash.digest }, body: factV2 });
  const record = reviewRecord('DOCUMENT_FACT_REVIEW', factV2.artifact_id, factV2.content_hash.digest, resolvedReview.attestation);
  await input.artifactRepository.put(record);
  return { fact: factV2, review_attestation: resolvedReview };
}

export async function reviewDocumentEvidenceProperty(input: {
  readonly authUser: AuthUser;
  readonly document_evidence_ref: HashedArtifactReference;
  readonly verified_fact_refs: readonly HashedArtifactReference[];
  readonly property_ref: HashedArtifactReference;
  readonly justification_refs: readonly ArtifactReference[];
  readonly governance_release: string;
  readonly artifactRepository: ArtifactRepository;
}): Promise<{ readonly property_binding: DocumentEvidencePropertyBindingArtifactV3; readonly review_attestation: DocumentReviewAttestationArtifact }> {
  if (!input.governance_release.trim()) {
    throw new DocumentReviewerAProductionPathRejected('governance_release is required');
  }
  if (input.property_ref.artifact_type !== LU_PROPERTY_CONTEXT_ARTIFACT_TYPE) throw new DocumentReviewerAProductionPathRejected('property_ref must be LU_PROPERTY_CONTEXT');
  if (input.verified_fact_refs.length === 0 || input.justification_refs.length === 0) throw new DocumentReviewerAProductionPathRejected('verified fact and justification references are required');
  for (const ref of input.verified_fact_refs) {
    const fact = await input.artifactRepository.resolve<VerifiedDocumentFactArtifact>(ref);
    if (fact.artifact_type !== 'VERIFIED_DOCUMENT_FACT' || hashOf(fact) !== ref.content_hash) throw new DocumentReviewerAProductionPathRejected('verified fact reference/hash is invalid');
  }
  const property = await input.artifactRepository.resolve<unknown>(input.property_ref);
  if (hashOf(property) !== input.property_ref.content_hash) throw new DocumentReviewerAProductionPathRejected('property context reference/hash is invalid');
  for (const ref of input.justification_refs) await input.artifactRepository.resolve(ref);
  const actor = await reviewer(input.authUser);
  const historicalBinding = createDocumentEvidencePropertyBindingArtifactV2({
    document_evidence_ref: input.document_evidence_ref,
    property_ref: input.property_ref,
    binding_method: 'GOVERNANCE_REVIEWER_CONFIRMED',
    binding_authority: actor,
    justification_refs: input.justification_refs,
  });
  const signing = getDocumentPropertyReviewSigningProvider();
  await input.artifactRepository.put({ artifact_id: historicalBinding.artifact_id, content_hash: historicalBinding.content_hash, body: historicalBinding });
  const review = await createDocumentReviewAttestation({
    artifact_type: 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION',
    action: DOCUMENT_PROPERTY_REVIEW_ACTION,
    subject_content_hash: historicalBinding.content_hash.value,
    preimage: {
      action: DOCUMENT_PROPERTY_REVIEW_ACTION,
      property_binding_artifact_id: historicalBinding.artifact_id,
      property_binding_content_hash: historicalBinding.content_hash.value,
      verified_fact_refs: input.verified_fact_refs,
      property_ref: input.property_ref,
      justification_refs: input.justification_refs,
      reviewer_actor_ref: actor,
      reviewer_role: actor.role,
      governance_release: input.governance_release,
      signer_key_id: signing.keyId,
    },
    reviewer: actor,
    governance_release: input.governance_release,
    signing,
  });
  await input.artifactRepository.put({ artifact_id: review.artifact.artifact_id, content_hash: review.artifact.content_hash, body: review.artifact });
  const resolvedReview = await validateDocumentReviewAttestationReference({
    resolver: input.artifactRepository,
    ref: review.ref,
    expected_action: DOCUMENT_PROPERTY_REVIEW_ACTION,
    expected_subject_digest: historicalBinding.content_hash.value,
    expected_reviewer: actor,
    verification: getDocumentPropertyReviewVerifier(),
  });
  const binding = createDocumentEvidencePropertyBindingArtifactV3({
    contract_version: 'document-evidence-property-binding-v3',
    document_evidence_ref: input.document_evidence_ref,
    property_ref: input.property_ref,
    binding_authority: actor,
    justification_refs: input.justification_refs,
    review_attestation_ref: review.ref as typeof review.ref & { readonly artifact_type: 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION' },
  });
  await input.artifactRepository.put({ artifact_id: binding.artifact_id, content_hash: binding.content_hash, body: binding });
  const record = reviewRecord('DOCUMENT_EVIDENCE_PROPERTY_REVIEW', binding.artifact_id, binding.content_hash.value, resolvedReview.attestation);
  await input.artifactRepository.put(record);
  return { property_binding: binding, review_attestation: resolvedReview };
}
