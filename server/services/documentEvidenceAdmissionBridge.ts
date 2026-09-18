import { canonicalizeStrict, createArtifactAttestation, type CASRepository, type SigningKeyProvider, type VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { createHash } from 'node:crypto';
import type { ArtifactRepositoryPort } from '../../packages/mps-runtime/src';
import {
  DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
  DocumentEvidenceAdmitter,
  type AdmittableDocumentEvidenceV2,
  type DocumentEvidenceAdmissionPredicate,
} from '../../packages/mps-data-governance/src/DocumentEvidenceAdmission';
import {
  DOCUMENT_FACT_REVIEW_ACTION,
  DOCUMENT_PROPERTY_REVIEW_ACTION,
} from '../../packages/mps-data-governance/src/DocumentReviewAuthority';
import {
  validateDocumentReviewAttestationReference,
} from '../../packages/mps-data-governance/src/DocumentReviewAttestation';
import {
  isVerifiedDocumentFactV2ContentHashValid,
  type VerifiedDocumentFactArtifactV2,
} from '../../packages/mps-data-governance/src/VerifiedDocumentFactV2';
import {
  DOCUMENT_EVIDENCE_PROPERTY_BINDING_V2_CONTRACT_VERSION,
  type DocumentEvidencePropertyBindingArtifactV2,
} from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifact';
import {
  isDocumentEvidencePropertyBindingV3ContentHashValid,
  type DocumentEvidencePropertyBindingArtifactV3,
} from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifactV3';
import { LU_PROPERTY_CONTEXT_ARTIFACT_TYPE } from '../../packages/mps-lu/src/artifacts/LUPropertyContextArtifact';
import { recomputeDocumentEvidenceV2ContentHash, type DocumentEvidenceArtifactV2 } from '../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2';
import { getDocumentFactReviewVerifier, getDocumentPropertyReviewVerifier } from '../security/documentReviewVerifier';
import type { AuthUser } from '../security/types';
import {
  resolveGovernanceReviewerActor,
  verifyGovernanceReviewerActorReference,
} from './governanceReviewerGrantService';

export class DocumentEvidenceAdmissionBridgeRejected extends Error {
  constructor(reason: string) {
    super(`FAIL_CLOSED: ${reason}`);
    this.name = 'DocumentEvidenceAdmissionBridgeRejected';
  }
}

type HashedRef = Readonly<{ artifact_id: string; artifact_type: string; content_hash: string }>;

function refEquals(left: HashedRef, right: HashedRef): boolean {
  return left.artifact_id === right.artifact_id &&
    left.artifact_type === right.artifact_type && left.content_hash === right.content_hash;
}

function actorEquals(left: Readonly<{ identity_ref: { id: string; content_hash: { digest: string } } }>, right: Readonly<{ identity_ref: { id: string; content_hash: { digest: string } } }>): boolean {
  return left.identity_ref.id === right.identity_ref.id &&
    left.identity_ref.content_hash.digest === right.identity_ref.content_hash.digest;
}

function artifactHash(artifact: unknown): string | null {
  if (!artifact || typeof artifact !== 'object') return null;
  const hash = (artifact as { content_hash?: { value?: unknown; digest?: unknown } }).content_hash;
  if (typeof hash?.value === 'string') return hash.value;
  if (typeof hash?.digest === 'string') return hash.digest;
  return null;
}

function refListEquals(left: readonly HashedRef[], right: readonly HashedRef[]): boolean {
  return left.length === right.length && left.every((ref, index) => refEquals(ref, right[index]));
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

function factReviewPreimageFromV2(fact: VerifiedDocumentFactArtifactV2, governanceRelease: string, signerKeyId: string): Record<string, unknown> {
  return {
    action: DOCUMENT_FACT_REVIEW_ACTION,
    candidate_artifact_id: fact.candidate_ref.id,
    candidate_content_hash: fact.candidate_ref.content_hash.digest,
    fact_artifact_id: fact.reviewed_fact_ref.artifact_id,
    fact_content_hash: fact.reviewed_fact_ref.content_hash,
    fact_type: fact.fact_type,
    source_projection_ref: fact.source_span.text_projection_ref,
    source_span: { start_offset: fact.source_span.start_offset, end_offset: fact.source_span.end_offset },
    reviewer_actor_ref: fact.verification.verified_by,
    reviewer_role: fact.verification.verified_by.role,
    governance_release: governanceRelease,
    signer_key_id: signerKeyId,
  };
}

function propertyReviewPreimage(binding: DocumentEvidencePropertyBindingArtifactV3, governanceRelease: string, signerKeyId: string): Record<string, unknown> {
  return {
    action: DOCUMENT_PROPERTY_REVIEW_ACTION,
    document_evidence_ref: binding.payload.document_evidence_ref,
    verified_fact_refs: binding.payload.verified_fact_refs,
    property_ref: binding.payload.property_ref,
    justification_refs: binding.payload.justification_refs,
    reviewer_actor_ref: binding.payload.binding_authority,
    reviewer_role: binding.payload.binding_authority.role,
    governance_release: governanceRelease,
    signer_key_id: signerKeyId,
  };
}

function propertyReviewSubjectHash(preimage: Record<string, unknown>): string {
  return sha256Hex({
    contract_version: 'document-evidence-property-binding-v3.review-preimage',
    preimage,
  });
}

export async function admitDocumentEvidenceV2(input: {
  readonly authUser: AuthUser;
  readonly evidence: DocumentEvidenceArtifactV2;
  readonly propertyBinding: DocumentEvidencePropertyBindingArtifactV3;
  readonly governanceRelease: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly cas: CASRepository;
  readonly signing: SigningKeyProvider;
  readonly verification: VerificationKeyProvider;
}): Promise<{ readonly cas_content_hash: string; readonly is_duplicate: boolean }> {
  if (!input.governanceRelease.trim()) {
    throw new DocumentEvidenceAdmissionBridgeRejected('governance_release is required');
  }
  const reviewer = await resolveGovernanceReviewerActor(input.authUser);
  const evidence = input.evidence;
  const binding = input.propertyBinding;

  if ((binding as unknown as DocumentEvidencePropertyBindingArtifactV2).payload.contract_version === DOCUMENT_EVIDENCE_PROPERTY_BINDING_V2_CONTRACT_VERSION) {
    throw new DocumentEvidenceAdmissionBridgeRejected('new governed admission requires DocumentEvidencePropertyBinding V3');
  }
  if (binding.payload.contract_version !== 'document-evidence-property-binding-v3' ||
      binding.payload.binding_authority.role !== 'GOVERNANCE_REVIEWER') {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding V3 is not confirmed by a GOVERNANCE_REVIEWER');
  }
  if (!isDocumentEvidencePropertyBindingV3ContentHashValid(binding)) {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding V3 content hash is invalid');
  }
  const evidenceRef: HashedRef = {
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    content_hash: evidence.content_hash.value,
  };
  if (!refEquals(binding.payload.document_evidence_ref, evidenceRef)) {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding does not bind the exact evidence');
  }
  if (!refListEquals(binding.payload.verified_fact_refs, evidence.payload.verified_fact_refs)) {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding V3 does not bind the exact verified fact refs');
  }
  if (binding.payload.justification_refs.length === 0) {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding lacks verified justification references');
  }
  for (const justification of binding.payload.justification_refs) {
    await input.artifactRepository.resolve({ artifact_id: justification.artifact_id, artifact_type: justification.artifact_type });
  }

  await verifyGovernanceReviewerActorReference(binding.payload.binding_authority);
  if (actorEquals(binding.payload.binding_authority, reviewer)) {
    throw new DocumentEvidenceAdmissionBridgeRejected('evidence admission reviewer must differ from the property binding reviewer');
  }

  const factReviewVerifier = getDocumentFactReviewVerifier();
  for (const ref of evidence.payload.verified_fact_refs) {
    const fact = await input.artifactRepository.resolve<VerifiedDocumentFactArtifactV2>({
      artifact_id: ref.artifact_id,
      artifact_type: ref.artifact_type,
    });
    if (fact.artifact_type !== 'VERIFIED_DOCUMENT_FACT' || fact.verification_status !== 'VERIFIED' ||
        fact.contract_version !== 'verified-document-fact-v2' ||
        fact.content_hash.digest !== ref.content_hash || !isVerifiedDocumentFactV2ContentHashValid(fact)) {
      throw new DocumentEvidenceAdmissionBridgeRejected(`verified fact '${ref.artifact_id}' is missing, inconsistent, not verified, or not V2`);
    }
    if (fact.verification.verified_by.role !== 'GOVERNANCE_REVIEWER') {
      throw new DocumentEvidenceAdmissionBridgeRejected(`verified fact '${ref.artifact_id}' was not reviewed by GOVERNANCE_REVIEWER`);
    }
    if (!actorEquals(fact.verification.verified_by, binding.payload.binding_authority)) {
      throw new DocumentEvidenceAdmissionBridgeRejected('property binding V3 reviewer must match the fact reviewer');
    }
    const reviewedFactDigest = recomputeReviewedFactDigestFromV2(fact);
    if (fact.reviewed_fact_ref.content_hash !== reviewedFactDigest) {
      throw new DocumentEvidenceAdmissionBridgeRejected(`verified fact '${ref.artifact_id}' reviewed preimage/hash is invalid`);
    }
    await validateDocumentReviewAttestationReference({
      resolver: input.artifactRepository,
      ref: fact.review_attestation_ref,
      expected_action: DOCUMENT_FACT_REVIEW_ACTION,
      expected_subject_digest: reviewedFactDigest,
      expected_reviewer: fact.verification.verified_by,
      expected_governance_release: input.governanceRelease,
      expected_preimage: factReviewPreimageFromV2(fact, input.governanceRelease, factReviewVerifier.keyId),
      verification: factReviewVerifier,
    });
    await verifyGovernanceReviewerActorReference(fact.verification.verified_by);
    if (actorEquals(fact.verification.verified_by, reviewer)) {
      throw new DocumentEvidenceAdmissionBridgeRejected('evidence admission reviewer must differ from the fact reviewer');
    }
  }

  if (binding.payload.property_ref.artifact_type !== LU_PROPERTY_CONTEXT_ARTIFACT_TYPE) {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding must reference an LU_PROPERTY_CONTEXT artifact');
  }
  const propertyContext = await input.artifactRepository.resolve<unknown>({
    artifact_id: binding.payload.property_ref.artifact_id,
    artifact_type: binding.payload.property_ref.artifact_type,
  });
  if (artifactHash(propertyContext) !== binding.payload.property_ref.content_hash) {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding does not resolve to the claimed canonical property context hash');
  }

  const propertyReviewVerifier = getDocumentPropertyReviewVerifier();
  const reviewedPropertyPreimage = propertyReviewPreimage(binding, input.governanceRelease, propertyReviewVerifier.keyId);
  await validateDocumentReviewAttestationReference({
    resolver: input.artifactRepository,
    ref: binding.payload.review_attestation_ref,
    expected_action: DOCUMENT_PROPERTY_REVIEW_ACTION,
    expected_subject_digest: propertyReviewSubjectHash(reviewedPropertyPreimage),
    expected_reviewer: binding.payload.binding_authority,
    expected_governance_release: input.governanceRelease,
    expected_preimage: reviewedPropertyPreimage,
    verification: propertyReviewVerifier,
  });

  const predicate: DocumentEvidenceAdmissionPredicate = {
    action: 'document_evidence.admit',
    evidence_artifact_id: evidence.artifact_id,
    evidence_content_hash: evidence.content_hash.value,
    approver_actor_ref: reviewer,
    approver_role: 'GOVERNANCE_REVIEWER',
    verified_fact_refs: evidence.payload.verified_fact_refs,
    property_binding_ref: {
      artifact_id: binding.artifact_id,
      artifact_type: binding.artifact_type,
      content_hash: binding.content_hash.value,
    },
    governance_release: input.governanceRelease,
    attestation_schema_version: 1,
    signer_key_id: input.signing.keyId,
  };
  const attestation = await createArtifactAttestation({
    subjectDigest: `sha256:${evidence.content_hash.value}`,
    predicateType: DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
    predicate: predicate as unknown as Record<string, unknown>,
    signing: input.signing,
  });
  const admitter = new DocumentEvidenceAdmitter(input.cas, input.verification);
  return admitter.admit(evidence as AdmittableDocumentEvidenceV2, attestation, input.governanceRelease, (artifact) =>
    recomputeDocumentEvidenceV2ContentHash(artifact as DocumentEvidenceArtifactV2),
  );
}
