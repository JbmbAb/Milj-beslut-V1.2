import { canonicalizeStrict, type ArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import { createHash } from 'node:crypto';
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
import { createVerifiedDocumentFactV2, isVerifiedDocumentFactV2ContentHashValid, type VerifiedDocumentFactArtifactV2 } from '../../packages/mps-data-governance/src/VerifiedDocumentFactV2';
import { verifyRealDocumentFactCandidate } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
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

function artifactTypeOf(value: unknown): string | undefined {
  const record = value as { artifact_type?: unknown };
  return typeof record.artifact_type === 'string' ? record.artifact_type : undefined;
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(Buffer.from(canonicalizeStrict(value), 'utf8')).digest('hex');
}

function recomputeReviewedFactDigestFromV2(fact: VerifiedDocumentFactArtifactV2): string {
  return sha256Hex({
    artifact_id: fact.reviewed_fact_ref.artifact_id,
    artifact_type: 'VERIFIED_DOCUMENT_FACT',
    contract_version: 'verified-document-fact-v1',
    verification_status: 'VERIFIED',
    candidate_ref: fact.candidate_ref,
    fact_type: fact.fact_type,
    fact_version: fact.fact_version,
    source_document_ref: fact.source_document_ref,
    inventory_ref: fact.inventory_ref,
    source_span: fact.source_span,
    ...(fact.subject_ref !== undefined ? { subject_ref: fact.subject_ref } : {}),
    assertion: {
      asserted_by: fact.assertion.asserted_by,
      assertion_method: fact.assertion.assertion_method,
      asserter_version: fact.assertion.asserter_version,
    },
    verification: {
      verified_by: fact.verification.verified_by,
      verification_method: fact.verification.verification_method,
      verification_policy_version: fact.verification.verification_policy_version,
    },
  });
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

function factReviewPreimage(args: {
  readonly action: typeof DOCUMENT_FACT_REVIEW_ACTION;
  readonly candidate: DocumentFactCandidateArtifact;
  readonly fact: VerifiedDocumentFactArtifact;
  readonly actor: ActorReference;
  readonly governance_release: string;
  readonly signer_key_id: string;
}): Record<string, unknown> {
  return {
    action: args.action,
    candidate_artifact_id: args.candidate.artifact_id,
    candidate_content_hash: args.candidate.content_hash.digest,
    fact_artifact_id: args.fact.artifact_id,
    fact_content_hash: args.fact.content_hash.digest,
    fact_type: args.fact.fact_type,
    source_projection_ref: args.fact.source_span.text_projection_ref,
    source_span: { start_offset: args.fact.source_span.start_offset, end_offset: args.fact.source_span.end_offset },
    reviewer_actor_ref: args.actor,
    reviewer_role: args.actor.role,
    governance_release: args.governance_release,
    signer_key_id: args.signer_key_id,
  };
}

function propertyReviewPreimage(args: {
  readonly action: typeof DOCUMENT_PROPERTY_REVIEW_ACTION;
  readonly document_evidence_ref: HashedArtifactReference;
  readonly verified_fact_refs: readonly HashedArtifactReference[];
  readonly property_ref: HashedArtifactReference;
  readonly justification_refs: readonly ArtifactReference[];
  readonly actor: ActorReference;
  readonly governance_release: string;
  readonly signer_key_id: string;
}): Record<string, unknown> {
  return {
    action: args.action,
    document_evidence_ref: args.document_evidence_ref,
    verified_fact_refs: args.verified_fact_refs,
    property_ref: args.property_ref,
    justification_refs: args.justification_refs,
    reviewer_actor_ref: args.actor,
    reviewer_role: args.actor.role,
    governance_release: args.governance_release,
    signer_key_id: args.signer_key_id,
  };
}

function factReviewPreimageFromV2(args: {
  readonly fact: VerifiedDocumentFactArtifactV2;
  readonly governance_release: string;
  readonly signer_key_id: string;
}): Record<string, unknown> {
  return {
    action: DOCUMENT_FACT_REVIEW_ACTION,
    candidate_artifact_id: args.fact.candidate_ref.id,
    candidate_content_hash: args.fact.candidate_ref.content_hash.digest,
    fact_artifact_id: args.fact.reviewed_fact_ref.artifact_id,
    fact_content_hash: args.fact.reviewed_fact_ref.content_hash,
    fact_type: args.fact.fact_type,
    source_projection_ref: args.fact.source_span.text_projection_ref,
    source_span: { start_offset: args.fact.source_span.start_offset, end_offset: args.fact.source_span.end_offset },
    reviewer_actor_ref: args.fact.verification.verified_by,
    reviewer_role: args.fact.verification.verified_by.role,
    governance_release: args.governance_release,
    signer_key_id: args.signer_key_id,
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
  const preimage = factReviewPreimage({
    action: DOCUMENT_FACT_REVIEW_ACTION,
    candidate,
    fact,
    actor,
    governance_release: input.governance_release,
    signer_key_id: signing.keyId,
  });
  const review = await createDocumentReviewAttestation({
    artifact_type: 'DOCUMENT_FACT_REVIEW_ATTESTATION',
    action: DOCUMENT_FACT_REVIEW_ACTION,
    subject_content_hash: fact.content_hash.digest,
    preimage,
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
    expected_governance_release: input.governance_release,
    expected_preimage: preimage,
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
  const evidence = await input.artifactRepository.resolve<unknown>(input.document_evidence_ref);
  if (hashOf(evidence) !== input.document_evidence_ref.content_hash) throw new DocumentReviewerAProductionPathRejected('document evidence reference/hash is invalid');
  for (const ref of input.verified_fact_refs) {
    const fact = await input.artifactRepository.resolve<VerifiedDocumentFactArtifactV2>(ref);
    if (fact.artifact_type !== 'VERIFIED_DOCUMENT_FACT' || fact.contract_version !== 'verified-document-fact-v2' || hashOf(fact) !== ref.content_hash || !isVerifiedDocumentFactV2ContentHashValid(fact)) throw new DocumentReviewerAProductionPathRejected('verified fact reference/hash is invalid or not V2');
    const reviewedFactDigest = recomputeReviewedFactDigestFromV2(fact);
    if (fact.reviewed_fact_ref.content_hash !== reviewedFactDigest) throw new DocumentReviewerAProductionPathRejected('verified fact reviewed preimage/hash is invalid');
    const factVerifier = getDocumentFactReviewVerifier();
    await validateDocumentReviewAttestationReference({
      resolver: input.artifactRepository,
      ref: fact.review_attestation_ref,
      expected_action: DOCUMENT_FACT_REVIEW_ACTION,
      expected_subject_digest: reviewedFactDigest,
      expected_reviewer: fact.verification.verified_by,
      expected_governance_release: input.governance_release,
      expected_preimage: factReviewPreimageFromV2({
        fact,
        governance_release: input.governance_release,
        signer_key_id: factVerifier.keyId,
      }),
      verification: factVerifier,
    });
  }
  const property = await input.artifactRepository.resolve<unknown>(input.property_ref);
  if (artifactTypeOf(property) !== LU_PROPERTY_CONTEXT_ARTIFACT_TYPE || hashOf(property) !== input.property_ref.content_hash) throw new DocumentReviewerAProductionPathRejected('property context reference/hash is invalid');
  for (const ref of input.justification_refs) await input.artifactRepository.resolve(ref);
  const actor = await reviewer(input.authUser);
  const signing = getDocumentPropertyReviewSigningProvider();
  const preimage = propertyReviewPreimage({
    action: DOCUMENT_PROPERTY_REVIEW_ACTION,
    document_evidence_ref: input.document_evidence_ref,
    verified_fact_refs: input.verified_fact_refs,
    property_ref: input.property_ref,
    justification_refs: input.justification_refs,
    actor,
    governance_release: input.governance_release,
    signer_key_id: signing.keyId,
  });
  const reviewSubjectHash = sha256ContentHash({
    contract_version: 'document-evidence-property-binding-v3.review-preimage',
    preimage,
  }).value;
  const review = await createDocumentReviewAttestation({
    artifact_type: 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION',
    action: DOCUMENT_PROPERTY_REVIEW_ACTION,
    subject_content_hash: reviewSubjectHash,
    preimage,
    reviewer: actor,
    governance_release: input.governance_release,
    signing,
  });
  await input.artifactRepository.put({ artifact_id: review.artifact.artifact_id, content_hash: review.artifact.content_hash, body: review.artifact });
  const resolvedReview = await validateDocumentReviewAttestationReference({
    resolver: input.artifactRepository,
    ref: review.ref,
    expected_action: DOCUMENT_PROPERTY_REVIEW_ACTION,
    expected_subject_digest: reviewSubjectHash,
    expected_reviewer: actor,
    expected_governance_release: input.governance_release,
    expected_preimage: preimage,
    verification: getDocumentPropertyReviewVerifier(),
  });
  const binding = createDocumentEvidencePropertyBindingArtifactV3({
    contract_version: 'document-evidence-property-binding-v3',
    document_evidence_ref: input.document_evidence_ref,
    verified_fact_refs: input.verified_fact_refs,
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
