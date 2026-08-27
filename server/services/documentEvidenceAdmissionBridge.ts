import { createArtifactAttestation, type CASRepository, type SigningKeyProvider, type VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactRepositoryPort } from '../../packages/mps-runtime/src';
import {
  DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
  DocumentEvidenceAdmitter,
  type AdmittableDocumentEvidenceV2,
  type DocumentEvidenceAdmissionPredicate,
} from '../../packages/mps-data-governance/src/DocumentEvidenceAdmission';
import {
  isVerifiedDocumentFactContentHashValid,
  type VerifiedDocumentFactArtifact,
} from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import {
  isDocumentEvidencePropertyBindingContentHashValid,
  DOCUMENT_EVIDENCE_PROPERTY_BINDING_V2_CONTRACT_VERSION,
  type DocumentEvidencePropertyBindingArtifactV2,
} from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifact';
import { LU_PROPERTY_CONTEXT_ARTIFACT_TYPE } from '../../packages/mps-lu/src/artifacts/LUPropertyContextArtifact';
import { recomputeDocumentEvidenceV2ContentHash, type DocumentEvidenceArtifactV2 } from '../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2';
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

export async function admitDocumentEvidenceV2(input: {
  readonly authUser: AuthUser;
  readonly evidence: DocumentEvidenceArtifactV2;
  readonly propertyBinding: DocumentEvidencePropertyBindingArtifactV2;
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

  if (!isDocumentEvidencePropertyBindingContentHashValid(binding)) {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding content hash is invalid');
  }
  const evidenceRef: HashedRef = {
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    content_hash: evidence.content_hash.value,
  };
  if (!refEquals(binding.payload.document_evidence_ref, evidenceRef)) {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding does not bind the exact evidence');
  }
  if (binding.payload.contract_version !== DOCUMENT_EVIDENCE_PROPERTY_BINDING_V2_CONTRACT_VERSION ||
      binding.payload.binding_method !== 'GOVERNANCE_REVIEWER_CONFIRMED' ||
      binding.payload.binding_authority.role !== 'GOVERNANCE_REVIEWER') {
    throw new DocumentEvidenceAdmissionBridgeRejected('property binding is not confirmed by a GOVERNANCE_REVIEWER');
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

  for (const ref of evidence.payload.verified_fact_refs) {
    const fact = await input.artifactRepository.resolve<VerifiedDocumentFactArtifact>({
      artifact_id: ref.artifact_id,
      artifact_type: ref.artifact_type,
    });
    if (fact.artifact_type !== 'VERIFIED_DOCUMENT_FACT' || fact.verification_status !== 'VERIFIED' ||
        fact.content_hash.digest !== ref.content_hash || !isVerifiedDocumentFactContentHashValid(fact)) {
      throw new DocumentEvidenceAdmissionBridgeRejected(`verified fact '${ref.artifact_id}' is missing, inconsistent, or not verified`);
    }
    if (fact.verification.verified_by.role !== 'GOVERNANCE_REVIEWER') {
      throw new DocumentEvidenceAdmissionBridgeRejected(`verified fact '${ref.artifact_id}' was not reviewed by GOVERNANCE_REVIEWER`);
    }
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
