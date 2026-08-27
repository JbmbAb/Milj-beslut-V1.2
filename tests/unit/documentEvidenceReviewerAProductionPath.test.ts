import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryArtifactRepository } from '../../packages/mps-runtime/src';
import { LocalPemSigningKeyProvider } from '../../packages/mimers-brunn-core/src';
import { createDocumentFactCandidate } from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import { reviewDocumentEvidenceProperty, reviewDocumentFact } from '../../server/services/documentEvidenceReviewerAProductionPath';
import * as reviewerGrants from '../../server/services/governanceReviewerGrantService';
import { verifyDocumentFactReviewSigner, verifyDocumentPropertyReviewSigner } from '../../server/security/documentReviewVerifier';

const original = new Map<string, string | undefined>();
const reviewer = { identity_ref: { id: 'reviewer-a-grant', content_hash: { algorithm: 'sha256', digest: 'a'.repeat(64) } }, role: 'GOVERNANCE_REVIEWER' as const };
const authUser = { id: 'user-a', organisationId: null, bankidId: 'bankid-a', role: 'CONSULTANT' as const };

function env(name: string, value: string | undefined) { if (!original.has(name)) original.set(name, process.env[name]); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
afterEach(() => { vi.restoreAllMocks(); for (const [name, value] of original) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } original.clear(); });

describe('DOCUMENT-EVIDENCE-REVIEWER-A-FACT-AND-PROPERTY-PRODUCTION-PATH-01', () => {
  it('derives Reviewer A from grant state and produces fact/property reviews with separate action-scoped signers', async () => {
    const factKey = LocalPemSigningKeyProvider.generate('ed25519:document-fact-review-v1');
    const propertyKey = LocalPemSigningKeyProvider.generate('ed25519:document-property-review-v1');
    env('DOCUMENT_FACT_REVIEW_PRIVATE_KEY_PEM', factKey.privateKey); env('DOCUMENT_FACT_REVIEW_PUBLIC_KEY_PEM', factKey.publicKey);
    env('DOCUMENT_PROPERTY_REVIEW_PRIVATE_KEY_PEM', propertyKey.privateKey); env('DOCUMENT_PROPERTY_REVIEW_PUBLIC_KEY_PEM', propertyKey.publicKey);
    vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockResolvedValue(reviewer);
    const repo = new InMemoryArtifactRepository();
    const candidate = await createDocumentFactCandidate({
      fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION', fact_version: 'v1',
      source_document_ref: { id: 'raw', content_hash: { algorithm: 'sha256', digest: 'raw-hash' } },
      inventory_ref: { id: 'inventory', content_hash: { algorithm: 'sha256', digest: 'inventory-hash' } },
      source_span: { text_projection_ref: { id: 'projection', content_hash: { algorithm: 'sha256', digest: 'projection-hash' } }, start_offset: 1, end_offset: 9 },
      asserted_by: { identity_ref: { id: 'extractor', content_hash: { algorithm: 'sha256', digest: 'e'.repeat(64) } }, role: 'SYSTEM_PROCESS' },
      assertion_method: 'MODEL_EXTRACTION', asserter_version: 'test', asserted_at: '2026-08-27T00:00:00.000Z',
    }, LocalPemSigningKeyProvider.generate('ed25519:extractor').provider);
    await repo.put({ artifact_id: candidate.artifact_id, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest }, body: candidate });
    const reviewed = await reviewDocumentFact({ authUser, candidate_ref: { artifact_id: candidate.artifact_id, artifact_type: candidate.artifact_type, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest } }, verification_method: 'HUMAN_REVIEW', governance_release: 'governance-v1', verified_at: '2026-08-27T00:00:00.000Z', artifactRepository: repo });
    await expect(verifyDocumentFactReviewSigner(reviewed.review_attestation.attestation)).resolves.toBeUndefined();
    expect(reviewed.fact.verification.verified_by).toEqual(reviewer);
    expect(reviewed.fact.contract_version).toBe('verified-document-fact-v2');
    expect(reviewed.fact.review_attestation_ref.artifact_id).toBe(reviewed.review_attestation.artifact_id);
    await repo.put({ artifact_id: 'lu-context', content_hash: { algorithm: 'sha256', value: 'context-hash' }, body: { artifact_id: 'lu-context', content_hash: { algorithm: 'sha256', value: 'context-hash' } } });
    await repo.put({ artifact_id: 'justification', content_hash: { algorithm: 'sha256', value: 'justification-hash' }, body: {} });
    const property = await reviewDocumentEvidenceProperty({ authUser, document_evidence_ref: { artifact_id: 'evidence', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: 'evidence-hash' }, verified_fact_refs: [{ artifact_id: reviewed.fact.artifact_id, artifact_type: reviewed.fact.artifact_type, content_hash: reviewed.fact.content_hash.digest }], property_ref: { artifact_id: 'lu-context', artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: 'context-hash' }, justification_refs: [{ artifact_id: 'justification', artifact_type: 'GOVERNANCE_NOTE' }], governance_release: 'governance-v1', artifactRepository: repo });
    await expect(verifyDocumentPropertyReviewSigner(property.review_attestation.attestation)).resolves.toBeUndefined();
    await expect(verifyDocumentFactReviewSigner(property.review_attestation.attestation)).rejects.toThrow(/predicate type|not trusted/i);
    expect(property.property_binding.payload.contract_version).toBe('document-evidence-property-binding-v3');
    expect(property.property_binding.payload.review_attestation_ref.artifact_id).toBe(property.review_attestation.artifact_id);
  });

  it('denies an ungranted reviewer before producing a fact or property binding', async () => {
    vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockRejectedValue(new Error('no verified GOVERNANCE_REVIEWER grant'));
    const repo = new InMemoryArtifactRepository();
    await expect(reviewDocumentEvidenceProperty({ authUser, document_evidence_ref: { artifact_id: 'evidence', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: 'h' }, verified_fact_refs: [], property_ref: { artifact_id: 'x', artifact_type: 'NOT_LU_CONTEXT', content_hash: 'x' }, justification_refs: [], governance_release: 'g', artifactRepository: repo })).rejects.toThrow(/LU_PROPERTY_CONTEXT/);
  });
});
