import {
  canonicalizeStrict,
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { createHash } from 'node:crypto';
import type { ActorReference } from '../../mps-core/src/types';

export type DocumentReviewAction =
  | 'document_fact.review'
  | 'document_evidence.property_review';

export type ReviewAttestationReference = Readonly<{
  artifact_id: string;
  artifact_type:
    | 'DOCUMENT_FACT_REVIEW_ATTESTATION'
    | 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION';
  content_hash: string;
}>;

export type DocumentReviewAttestationArtifact = Readonly<{
  artifact_id: string;
  artifact_type: ReviewAttestationReference['artifact_type'];
  content_hash: { algorithm: 'sha256'; value: string };
  payload: Record<string, unknown>;
  attestation: ArtifactAttestation;
}>;

export type DocumentReviewAttestationResolver = Readonly<{
  resolve<T>(
    reference: Pick<ReviewAttestationReference, 'artifact_id' | 'artifact_type'>,
  ): Promise<T>;
}>;

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalizeStrict(value)).digest('hex');
}

function predicateType(action: DocumentReviewAction): string {
  return action === 'document_fact.review' ? 'mimers-brunn/document-fact-review/v1' : 'mimers-brunn/document-property-review/v1';
}

export async function createDocumentReviewAttestation(args: {
  readonly artifact_type: ReviewAttestationReference['artifact_type'];
  readonly action: DocumentReviewAction;
  readonly subject_content_hash: string;
  readonly preimage: Record<string, unknown>;
  readonly reviewer: ActorReference;
  readonly governance_release: string;
  readonly signing: SigningKeyProvider;
}): Promise<{ readonly artifact: DocumentReviewAttestationArtifact; readonly ref: ReviewAttestationReference }> {
  if (args.reviewer.role !== 'GOVERNANCE_REVIEWER' || !args.governance_release.trim()) throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: reviewer and governance release are required');
  if (
    (args.action === 'document_fact.review' && args.artifact_type !== 'DOCUMENT_FACT_REVIEW_ATTESTATION') ||
    (args.action === 'document_evidence.property_review' && args.artifact_type !== 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION')
  ) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: artifact_type does not match review action');
  }
  const payload = { action: args.action, preimage: args.preimage, reviewer_actor_ref: args.reviewer, reviewer_role: args.reviewer.role, governance_release: args.governance_release, signer_key_id: args.signing.keyId };
  const content_hash = digest(payload);
  const attestation = await createArtifactAttestation({ subjectDigest: `sha256:${args.subject_content_hash}`, predicateType: predicateType(args.action), predicate: payload, signing: args.signing });
  const artifact_id = `${args.artifact_type.toLowerCase()}-${content_hash.slice(0, 24)}`;
  const artifact = { artifact_id, artifact_type: args.artifact_type, content_hash: { algorithm: 'sha256' as const, value: content_hash }, payload, attestation };
  return { artifact, ref: { artifact_id, artifact_type: args.artifact_type, content_hash } };
}

export async function validateResolvedDocumentReviewAttestation(args: {
  readonly artifact: DocumentReviewAttestationArtifact;
  readonly ref: ReviewAttestationReference;
  readonly expected_action: DocumentReviewAction;
  readonly expected_subject_digest: string;
  readonly expected_reviewer: ActorReference;
  readonly expected_governance_release?: string;
  readonly expected_preimage?: Record<string, unknown>;
  readonly verification: VerificationKeyProvider;
}): Promise<void> {
  if (args.artifact.artifact_id !== args.ref.artifact_id || args.artifact.artifact_type !== args.ref.artifact_type || args.artifact.content_hash.value !== args.ref.content_hash) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: resolved attestation does not match reference');
  }
  if (digest(args.artifact.payload) !== args.artifact.content_hash.value) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: content hash does not match attestation payload');
  }
  const payload = args.artifact.payload as Record<string, unknown>;
  if (canonicalizeStrict(args.artifact.attestation.predicate) !== canonicalizeStrict(args.artifact.payload)) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: signed predicate does not match persisted payload');
  }
  if (payload.action !== args.expected_action || payload.reviewer_role !== 'GOVERNANCE_REVIEWER') {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: action or reviewer role does not match');
  }
  if (
    (args.expected_action === 'document_fact.review' && args.artifact.artifact_type !== 'DOCUMENT_FACT_REVIEW_ATTESTATION') ||
    (args.expected_action === 'document_evidence.property_review' && args.artifact.artifact_type !== 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION')
  ) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: artifact type does not match expected action');
  }
  if (canonicalizeStrict(payload.reviewer_actor_ref) !== canonicalizeStrict(args.expected_reviewer)) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: reviewer actor is not bound to attestation');
  }
  if (args.expected_governance_release !== undefined && payload.governance_release !== args.expected_governance_release) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: governance release is not bound to attestation');
  }
  if (args.expected_preimage !== undefined && canonicalizeStrict(payload.preimage) !== canonicalizeStrict(args.expected_preimage)) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: reviewed preimage is not bound to attestation');
  }
  if (args.artifact.attestation.subjectDigest !== `sha256:${args.expected_subject_digest}`) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: subject digest does not match reviewed artifact');
  }
  if (args.artifact.attestation.signer !== args.verification.keyId || payload.signer_key_id !== args.verification.keyId) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: signer is not trusted');
  }
  if (!(await verifyArtifactAttestation(args.artifact.attestation, args.verification))) {
    throw new Error('REJECT_DOCUMENT_REVIEW_ATTESTATION: signature verification failed');
  }
}

/**
 * Public read-side gate for Reviewer A references.
 *
 * Callers provide only a resolver, the immutable reference, and the public verification key.
 * The attestation body must be fetched through the same artifact resolver used by production
 * admission paths, then it is checked against the reference hash, expected subject digest,
 * action, reviewer actor, signer key id, and signature.
 */
export async function validateDocumentReviewAttestationReference(args: {
  readonly resolver: DocumentReviewAttestationResolver;
  readonly ref: ReviewAttestationReference;
  readonly expected_action: DocumentReviewAction;
  readonly expected_subject_digest: string;
  readonly expected_reviewer: ActorReference;
  readonly expected_governance_release?: string;
  readonly expected_preimage?: Record<string, unknown>;
  readonly verification: VerificationKeyProvider;
}): Promise<DocumentReviewAttestationArtifact> {
  const artifact = await args.resolver.resolve<DocumentReviewAttestationArtifact>({
    artifact_id: args.ref.artifact_id,
    artifact_type: args.ref.artifact_type,
  });
  await validateResolvedDocumentReviewAttestation({
    artifact,
    ref: args.ref,
    expected_action: args.expected_action,
    expected_subject_digest: args.expected_subject_digest,
    expected_reviewer: args.expected_reviewer,
    expected_governance_release: args.expected_governance_release,
    expected_preimage: args.expected_preimage,
    verification: args.verification,
  });
  return artifact;
}
