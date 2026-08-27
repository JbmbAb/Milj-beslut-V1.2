import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';
import { createHash } from 'node:crypto';
import type { SignatureDescriptor } from '../../mps-core/src/types';
import type { VerifiedDocumentFactArtifact } from './DocumentFactArtifact';
import type { ReviewAttestationReference } from './DocumentReviewAttestation';

export interface VerifiedDocumentFactArtifactV2 extends VerifiedDocumentFactArtifact {
  readonly contract_version: 'verified-document-fact-v2';
  readonly reviewed_fact_ref: {
    readonly artifact_id: string;
    readonly artifact_type: 'VERIFIED_DOCUMENT_FACT';
    readonly content_hash: string;
  };
  readonly review_attestation_ref: ReviewAttestationReference & { readonly artifact_type: 'DOCUMENT_FACT_REVIEW_ATTESTATION' };
}

function v2Payload(fact: VerifiedDocumentFactArtifact, review_attestation_ref: VerifiedDocumentFactArtifactV2['review_attestation_ref']) {
  if (!review_attestation_ref?.artifact_id || !review_attestation_ref.content_hash) throw new Error('REJECT_VERIFIED_DOCUMENT_FACT_V2: review_attestation_ref is required');
  if (review_attestation_ref.artifact_type !== 'DOCUMENT_FACT_REVIEW_ATTESTATION') throw new Error('REJECT_VERIFIED_DOCUMENT_FACT_V2: review_attestation_ref must be DOCUMENT_FACT_REVIEW_ATTESTATION');
  const existingReviewedRef = (fact as Partial<VerifiedDocumentFactArtifactV2>).reviewed_fact_ref;
  const reviewed_fact_ref = existingReviewedRef ?? {
    artifact_id: fact.artifact_id,
    artifact_type: 'VERIFIED_DOCUMENT_FACT' as const,
    content_hash: fact.content_hash.digest,
  };
  return { contract_version: 'verified-document-fact-v2' as const, reviewed_fact_ref, candidate_ref: fact.candidate_ref, fact_type: fact.fact_type, fact_version: fact.fact_version, source_document_ref: fact.source_document_ref, inventory_ref: fact.inventory_ref, source_span: fact.source_span, assertion: fact.assertion, verification: fact.verification, review_attestation_ref };
}

export function computeVerifiedDocumentFactV2ContentHash(fact: VerifiedDocumentFactArtifactV2): string {
  const payload = v2Payload(fact, fact.review_attestation_ref);
  return createHash('sha256').update(canonicalizeStrict({ artifact_id: fact.artifact_id, ...payload })).digest('hex');
}

export function isVerifiedDocumentFactV2ContentHashValid(fact: VerifiedDocumentFactArtifactV2): boolean {
  return computeVerifiedDocumentFactV2ContentHash(fact) === fact.content_hash.digest;
}

export async function createVerifiedDocumentFactV2(fact: VerifiedDocumentFactArtifact, review_attestation_ref: VerifiedDocumentFactArtifactV2['review_attestation_ref'], signer: { readonly keyId: string; sign(bytes: Uint8Array): Promise<{ readonly signatureBase64: string }> }): Promise<VerifiedDocumentFactArtifactV2> {
  const payload = v2Payload(fact, review_attestation_ref);
  const identity = createHash('sha256').update(canonicalizeStrict(payload)).digest('hex');
  const artifact_id = `fact-verified-v2-${identity.slice(0, 24)}`;
  const digest = createHash('sha256').update(canonicalizeStrict({ artifact_id, ...payload })).digest('hex');
  const signed = await signer.sign(Buffer.from(digest, 'hex'));
  const signature: SignatureDescriptor = { algorithm: 'Ed25519', signature: `ed25519:${signed.signatureBase64}`, key_id: signer.keyId };
  return { ...fact, artifact_id, content_hash: { algorithm: 'sha256', digest }, signature, contract_version: 'verified-document-fact-v2', reviewed_fact_ref: payload.reviewed_fact_ref, review_attestation_ref };
}
