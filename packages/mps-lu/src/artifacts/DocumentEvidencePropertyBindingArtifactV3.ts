import { sha256ContentHash } from '@miljobeslut/mps-compliance/src/canonical/sha256Canonical';
import type { ActorReference } from '@miljobeslut/mps-core/src/types';
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactReference';
import type { DocumentEvidenceHashedRef } from './DocumentEvidenceArtifactV2';
import type { ReviewAttestationReference } from '../../../mps-data-governance/src/DocumentReviewAttestation';

export interface DocumentEvidencePropertyBindingArtifactV3 {
  readonly artifact_id: string;
  readonly artifact_type: 'document_evidence_property_binding';
  readonly content_hash: { algorithm: 'sha256'; value: string };
  readonly references: readonly ArtifactReference[];
  readonly payload: {
    readonly contract_version: 'document-evidence-property-binding-v3';
    readonly document_evidence_ref: DocumentEvidenceHashedRef;
    readonly property_ref: DocumentEvidenceHashedRef;
    readonly binding_authority: ActorReference;
    readonly justification_refs: readonly ArtifactReference[];
    readonly review_attestation_ref: ReviewAttestationReference & { readonly artifact_type: 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION' };
  };
}

export function createDocumentEvidencePropertyBindingArtifactV3(payload: DocumentEvidencePropertyBindingArtifactV3['payload']): DocumentEvidencePropertyBindingArtifactV3 {
  if (!payload.review_attestation_ref?.artifact_id || !payload.review_attestation_ref.content_hash) throw new Error('REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING_V3: review_attestation_ref is required');
  if (payload.review_attestation_ref.artifact_type !== 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION') throw new Error('REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING_V3: review_attestation_ref must be DOCUMENT_PROPERTY_REVIEW_ATTESTATION');
  if (payload.property_ref.artifact_type !== 'LU_PROPERTY_CONTEXT') throw new Error('REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING_V3: property_ref must be LU_PROPERTY_CONTEXT');
  if (payload.binding_authority.role !== 'GOVERNANCE_REVIEWER' || !payload.binding_authority.identity_ref?.id || !payload.binding_authority.identity_ref.content_hash?.digest) {
    throw new Error('REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING_V3: binding_authority must be a hash-bound GOVERNANCE_REVIEWER');
  }
  // V3 identity is the canonical review decision; content_hash additionally pins its references.
  // justification_refs are reviewer-authored ordered rationale, matching the historical V2 contract.
  const identity = sha256ContentHash({ artifact_type: 'document_evidence_property_binding', payload });
  const artifact_id = `document-evidence-property-binding-v3-${identity.value.slice(0, 24)}`;
  const references = [{ artifact_id: payload.document_evidence_ref.artifact_id, artifact_type: payload.document_evidence_ref.artifact_type }, { artifact_id: payload.property_ref.artifact_id, artifact_type: payload.property_ref.artifact_type }, ...payload.justification_refs, { artifact_id: payload.review_attestation_ref.artifact_id, artifact_type: payload.review_attestation_ref.artifact_type }];
  const content_hash = sha256ContentHash({ artifact_id, artifact_type: 'document_evidence_property_binding', references, payload });
  return { artifact_id, artifact_type: 'document_evidence_property_binding', content_hash, references, payload };
}
