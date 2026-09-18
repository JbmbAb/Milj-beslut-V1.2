import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryArtifactRepository } from '../../packages/mps-runtime/src';
import { LocalPemSigningKeyProvider } from '../../packages/mimers-brunn-core/src';
import { createDocumentFactCandidate } from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import { verifyRealDocumentFactCandidate } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1 } from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import { createDocumentEvidencePropertyBindingArtifactV2 } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifact';
import { reviewDocumentEvidenceProperty, reviewDocumentFact } from '../../server/services/documentEvidenceReviewerAProductionPath';
import * as reviewerGrants from '../../server/services/governanceReviewerGrantService';
import { verifyDocumentFactReviewSigner, verifyDocumentPropertyReviewSigner } from '../../server/security/documentReviewVerifier';

const original = new Map<string, string | undefined>();
const reviewer = { identity_ref: { id: 'reviewer-a-grant', content_hash: { algorithm: 'sha256' as const, digest: 'a'.repeat(64) } }, role: 'GOVERNANCE_REVIEWER' as const };
const otherReviewer = { identity_ref: { id: 'reviewer-other-grant', content_hash: { algorithm: 'sha256' as const, digest: 'b'.repeat(64) } }, role: 'GOVERNANCE_REVIEWER' as const };
const authUser = { id: 'user-a', organisationId: null, bankidId: 'bankid-a', role: 'CONSULTANT' as const };

function env(name: string, value: string | undefined) { if (!original.has(name)) original.set(name, process.env[name]); if (value === undefined) delete process.env[name]; else process.env[name] = value; }

function installReviewKeys() {
  const factKey = LocalPemSigningKeyProvider.generate('ed25519:document-fact-review-v1');
  const propertyKey = LocalPemSigningKeyProvider.generate('ed25519:document-property-review-v1');
  env('DOCUMENT_FACT_REVIEW_PRIVATE_KEY_PEM', factKey.privateKey); env('DOCUMENT_FACT_REVIEW_PUBLIC_KEY_PEM', factKey.publicKey);
  env('DOCUMENT_PROPERTY_REVIEW_PRIVATE_KEY_PEM', propertyKey.privateKey); env('DOCUMENT_PROPERTY_REVIEW_PUBLIC_KEY_PEM', propertyKey.publicKey);
  return { factKey, propertyKey };
}

async function makeCandidate() {
  return createDocumentFactCandidate({
    fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION', fact_version: 'v1',
    source_document_ref: { id: 'raw', content_hash: { algorithm: 'sha256', digest: 'raw-hash' } },
    inventory_ref: { id: 'inventory', content_hash: { algorithm: 'sha256', digest: 'inventory-hash' } },
    source_span: { text_projection_ref: { id: 'projection', content_hash: { algorithm: 'sha256', digest: 'projection-hash' } }, start_offset: 1, end_offset: 9 },
    asserted_by: { identity_ref: { id: 'extractor', content_hash: { algorithm: 'sha256', digest: 'e'.repeat(64) } }, role: 'SYSTEM_PROCESS' },
    assertion_method: 'MODEL_EXTRACTION', asserter_version: 'test', asserted_at: '2026-08-27T00:00:00.000Z',
  }, LocalPemSigningKeyProvider.generate('ed25519:extractor').provider);
}

async function setupReviewedFact() {
  installReviewKeys();
  vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockResolvedValue(reviewer);
  const repo = new InMemoryArtifactRepository();
  const candidate = await makeCandidate();
  await repo.put({ artifact_id: candidate.artifact_id, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest }, body: candidate });
  const reviewed = await reviewDocumentFact({ authUser, candidate_ref: { artifact_id: candidate.artifact_id, artifact_type: candidate.artifact_type, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest } }, verification_method: 'HUMAN_REVIEW', governance_release: 'governance-v1', verified_at: '2026-08-27T00:00:00.000Z', artifactRepository: repo });
  await repo.put({ artifact_id: 'evidence', content_hash: { algorithm: 'sha256', value: 'evidence-hash' }, body: { artifact_id: 'evidence', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: { algorithm: 'sha256', value: 'evidence-hash' } } });
  await repo.put({ artifact_id: 'lu-context', content_hash: { algorithm: 'sha256', value: 'context-hash' }, body: { artifact_id: 'lu-context', artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: { algorithm: 'sha256', value: 'context-hash' } } });
  await repo.put({ artifact_id: 'justification', content_hash: { algorithm: 'sha256', value: 'justification-hash' }, body: { artifact_id: 'justification', artifact_type: 'GOVERNANCE_NOTE', content_hash: { algorithm: 'sha256', value: 'justification-hash' } } });
  return { repo, reviewed };
}

async function produceProperty(overrides = {}) {
  const { repo, reviewed } = await setupReviewedFact();
  const input = {
    authUser,
    document_evidence_ref: { artifact_id: 'evidence', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: 'evidence-hash' },
    verified_fact_refs: [{ artifact_id: reviewed.fact.artifact_id, artifact_type: reviewed.fact.artifact_type, content_hash: reviewed.fact.content_hash.digest }],
    property_ref: { artifact_id: 'lu-context', artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: 'context-hash' },
    justification_refs: [{ artifact_id: 'justification', artifact_type: 'GOVERNANCE_NOTE' }],
    governance_release: 'governance-v1',
    artifactRepository: repo,
    ...overrides,
  };
  return { repo, reviewed, property: await reviewDocumentEvidenceProperty(input) };
}

afterEach(() => { vi.restoreAllMocks(); for (const [name, value] of original) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } original.clear(); });

describe('DOCUMENT-EVIDENCE-REVIEWER-A-FACT-AND-PROPERTY-PRODUCTION-PATH-01', () => {
  it('derives Reviewer A from grant state and produces fact V2/property V3 reviews with separate action-scoped signers', async () => {
    const { reviewed, property } = await produceProperty();
    await expect(verifyDocumentFactReviewSigner(reviewed.review_attestation.attestation)).resolves.toBeUndefined();
    await expect(verifyDocumentPropertyReviewSigner(property.review_attestation.attestation)).resolves.toBeUndefined();
    await expect(verifyDocumentFactReviewSigner(property.review_attestation.attestation)).rejects.toThrow(/predicate type|not trusted/i);
    expect(reviewed.fact.verification.verified_by).toEqual(reviewer);
    expect(reviewed.fact.contract_version).toBe('verified-document-fact-v2');
    expect(reviewed.fact.review_attestation_ref.artifact_id).toBe(reviewed.review_attestation.artifact_id);
    expect(property.property_binding.payload.contract_version).toBe('document-evidence-property-binding-v3');
    expect(property.property_binding.payload.verified_fact_refs).toEqual([{ artifact_id: reviewed.fact.artifact_id, artifact_type: reviewed.fact.artifact_type, content_hash: reviewed.fact.content_hash.digest }]);
    expect(property.property_binding.payload.review_attestation_ref.artifact_id).toBe(property.review_attestation.artifact_id);
  });

  it('denies an ungranted reviewer before producing a fact or property binding', async () => {
    vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockRejectedValue(new Error('no verified GOVERNANCE_REVIEWER grant'));
    const repo = new InMemoryArtifactRepository();
    const candidate = await makeCandidate();
    await repo.put({ artifact_id: candidate.artifact_id, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest }, body: candidate });
    installReviewKeys();
    await expect(reviewDocumentFact({ authUser, candidate_ref: { artifact_id: candidate.artifact_id, artifact_type: candidate.artifact_type, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest } }, verification_method: 'HUMAN_REVIEW', governance_release: 'governance-v1', verified_at: '2026-08-27T00:00:00.000Z', artifactRepository: repo })).rejects.toThrow(/GOVERNANCE_REVIEWER grant/);
  });

  it.each([
    ['wrong governance release', { governance_release: 'governance-v2' }, /governance release/],
    ['wrong fact ref hash', { verified_fact_refs: [{ artifact_id: 'later', artifact_type: 'VERIFIED_DOCUMENT_FACT', content_hash: 'wrong' }] }, /not found|invalid/i],
    ['wrong property ref', { property_ref: { artifact_id: 'lu-context', artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: 'wrong' } }, /property context reference/],
    ['property_ref not LU_PROPERTY_CONTEXT', { property_ref: { artifact_id: 'lu-context', artifact_type: 'PROPERTY_CONTEXT', content_hash: 'context-hash' } }, /LU_PROPERTY_CONTEXT/],
    ['wrong justification ref', { justification_refs: [{ artifact_id: 'missing', artifact_type: 'GOVERNANCE_NOTE' }] }, /not found/i],
    ['wrong document evidence ref', { document_evidence_ref: { artifact_id: 'missing', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: 'evidence-hash' } }, /not found/i],
  ])('denies %s before V3 persistence', async (_, overrides, error) => {
    const { repo, reviewed } = await setupReviewedFact();
    const input = {
      authUser,
      document_evidence_ref: { artifact_id: 'evidence', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: 'evidence-hash' },
      verified_fact_refs: [{ artifact_id: reviewed.fact.artifact_id, artifact_type: reviewed.fact.artifact_type, content_hash: reviewed.fact.content_hash.digest }],
      property_ref: { artifact_id: 'lu-context', artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: 'context-hash' },
      justification_refs: [{ artifact_id: 'justification', artifact_type: 'GOVERNANCE_NOTE' }],
      governance_release: 'governance-v1',
      artifactRepository: repo,
      ...overrides,
    };
    await expect(reviewDocumentEvidenceProperty(input)).rejects.toThrow(error);
    await expect(repo.resolve({ artifact_id: 'document-evidence-property-binding-v3-', artifact_type: 'document_evidence_property_binding' })).rejects.toThrow(/not found/i);
  });

  it('denies legacy fact where V2 is required', async () => {
    const { repo, reviewed } = await setupReviewedFact();
    const legacy = await verifyRealDocumentFactCandidate({
      candidate: await makeCandidate(),
      verified_by: reviewer,
      verification_method: 'HUMAN_REVIEW',
      policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
      verified_at: '2026-08-27T00:00:00.000Z',
    }, LocalPemSigningKeyProvider.generate('ed25519:legacy').provider);
    await repo.put({ artifact_id: legacy.artifact_id, content_hash: { algorithm: 'sha256', value: legacy.content_hash.digest }, body: legacy });
    await expect(reviewDocumentEvidenceProperty({ authUser, document_evidence_ref: { artifact_id: 'evidence', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: 'evidence-hash' }, verified_fact_refs: [{ artifact_id: legacy.artifact_id, artifact_type: legacy.artifact_type, content_hash: legacy.content_hash.digest }], property_ref: { artifact_id: 'lu-context', artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: 'context-hash' }, justification_refs: [{ artifact_id: 'justification', artifact_type: 'GOVERNANCE_NOTE' }], governance_release: 'governance-v1', artifactRepository: repo })).rejects.toThrow(/not V2/);
    expect(reviewed.fact.contract_version).toBe('verified-document-fact-v2');
  });

  it('denies tampered fact review attestations before property V3 persistence', async () => {
    const { repo, reviewed } = await setupReviewedFact();
    const tamperingRepo = {
      put: repo.put.bind(repo),
      async resolve<T>(ref: { artifact_id: string; artifact_type: string }): Promise<T> {
        if (ref.artifact_id === reviewed.fact.artifact_id) {
          return { ...reviewed.fact, review_attestation_ref: { ...reviewed.fact.review_attestation_ref, content_hash: '0'.repeat(64) } } as T;
        }
        return repo.resolve<T>(ref);
      },
    };
    await expect(reviewDocumentEvidenceProperty({ authUser, document_evidence_ref: { artifact_id: 'evidence', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: 'evidence-hash' }, verified_fact_refs: [{ artifact_id: reviewed.fact.artifact_id, artifact_type: reviewed.fact.artifact_type, content_hash: reviewed.fact.content_hash.digest }], property_ref: { artifact_id: 'lu-context', artifact_type: 'LU_PROPERTY_CONTEXT', content_hash: 'context-hash' }, justification_refs: [{ artifact_id: 'justification', artifact_type: 'GOVERNANCE_NOTE' }], governance_release: 'governance-v1', artifactRepository: tamperingRepo })).rejects.toThrow(/invalid|not V2|attestation/i);
  });

  it('leaves historical PropertyBinding V2 semantics unchanged', () => {
    const binding = createDocumentEvidencePropertyBindingArtifactV2({
      document_evidence_ref: { artifact_id: 'e', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: 'a'.repeat(64) },
      property_ref: { artifact_id: 'p', artifact_type: 'ANY_PROPERTY_CONTEXT', content_hash: 'b'.repeat(64) },
      binding_method: 'GOVERNANCE_REVIEWER_CONFIRMED',
      binding_authority: reviewer,
      justification_refs: [{ artifact_id: 'j', artifact_type: 'NOTE' }],
    });
    expect(binding.payload.contract_version).toBe('document-evidence-property-binding-v2');
    expect(binding.payload).not.toHaveProperty('review_attestation_ref');
  });
});
