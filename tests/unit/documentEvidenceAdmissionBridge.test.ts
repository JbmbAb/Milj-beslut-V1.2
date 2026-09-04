import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileCASRepository, LocalPemSigningKeyProvider } from '../../packages/mimers-brunn-core/src';
import { InMemoryArtifactRepository } from '../../packages/mps-runtime/src';
import { createDocumentEvidenceArtifactV2 } from '../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2';
import { LU_PROPERTY_CONTEXT_ARTIFACT_TYPE } from '../../packages/mps-lu/src/artifacts/LUPropertyContextArtifact';
import {
  createDocumentEvidencePropertyBindingArtifact,
  createDocumentEvidencePropertyBindingArtifactV2,
} from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifact';
import { createDocumentEvidencePropertyBindingArtifactV3 } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifactV3';
import type { DocumentEvidencePropertyBindingArtifactV3 } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifactV3';
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1, type VerifiedDocumentFactArtifact } from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import { createDocumentFactCandidate } from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import { verifyRealDocumentFactCandidate } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { reviewDocumentEvidenceProperty, reviewDocumentFact } from '../../server/services/documentEvidenceReviewerAProductionPath';
import { admitDocumentEvidenceV2 } from '../../server/services/documentEvidenceAdmissionBridge';
import * as reviewerGrants from '../../server/services/governanceReviewerGrantService';

const reviewerA = {
  identity_ref: { id: 'grant-reviewer-a', content_hash: { algorithm: 'sha256' as const, digest: 'a'.repeat(64) } },
  role: 'GOVERNANCE_REVIEWER' as const,
};
const reviewerB = {
  identity_ref: { id: 'grant-reviewer-b', content_hash: { algorithm: 'sha256' as const, digest: 'b'.repeat(64) } },
  role: 'GOVERNANCE_REVIEWER' as const,
};
const extractor = {
  identity_ref: { id: 'extractor', content_hash: { algorithm: 'sha256' as const, digest: 'e'.repeat(64) } },
  role: 'SYSTEM_PROCESS' as const,
};
const userA = { id: 'user-a', organisationId: null, bankidId: 'bankid-a', role: 'CONSULTANT' as const };
const userB = { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' as const };

describe('DOCUMENT-EVIDENCE-BRIDGE-REVIEW-ATTESTATION-VERIFICATION-01', () => {
  const admissionSigner = LocalPemSigningKeyProvider.generate('ed25519:document-evidence-admission-v1').provider;
  const original = new Map<string, string | undefined>();
  let tempRoot = '';

  function env(name: string, value: string | undefined) {
    if (!original.has(name)) original.set(name, process.env[name]);
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }

  function installReviewKeys() {
    const factKey = LocalPemSigningKeyProvider.generate('ed25519:document-fact-review-v1');
    const propertyKey = LocalPemSigningKeyProvider.generate('ed25519:document-property-review-v1');
    env('DOCUMENT_FACT_REVIEW_PRIVATE_KEY_PEM', factKey.privateKey); env('DOCUMENT_FACT_REVIEW_PUBLIC_KEY_PEM', factKey.publicKey);
    env('DOCUMENT_PROPERTY_REVIEW_PRIVATE_KEY_PEM', propertyKey.privateKey); env('DOCUMENT_PROPERTY_REVIEW_PUBLIC_KEY_PEM', propertyKey.publicKey);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, value] of original) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    original.clear();
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  });

  async function setup() {
    installReviewKeys();
    vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockImplementation(async (authUser) => authUser.id === userA.id ? reviewerA : reviewerB);
    vi.spyOn(reviewerGrants, 'verifyGovernanceReviewerActorReference').mockResolvedValue();
    const repo = new InMemoryArtifactRepository();
    tempRoot = mkdtempSync(path.join(tmpdir(), 'document-evidence-bridge-'));
    const cas = new FileCASRepository(tempRoot, { durabilityMode: 'none' });
    await cas.initialize();
    const candidate = await createDocumentFactCandidate({
      fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION', fact_version: 'v1',
      source_document_ref: { id: 'document-1', content_hash: { algorithm: 'sha256', digest: 'document-hash' } },
      inventory_ref: { id: 'inventory-1', content_hash: { algorithm: 'sha256', digest: 'inventory-hash' } },
      source_span: { text_projection_ref: { id: 'projection-1', content_hash: { algorithm: 'sha256', digest: 'projection-hash' } }, start_offset: 1, end_offset: 2 },
      asserted_by: extractor, assertion_method: 'HUMAN_ASSERTION', asserter_version: 'fixture', asserted_at: '2026-08-27T00:00:00.000Z',
    }, LocalPemSigningKeyProvider.generate('ed25519:extractor').provider);
    await repo.put({ artifact_id: candidate.artifact_id, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest }, body: candidate });
    const reviewed = await reviewDocumentFact({
      authUser: userA,
      candidate_ref: { artifact_id: candidate.artifact_id, artifact_type: candidate.artifact_type, content_hash: { algorithm: 'sha256', value: candidate.content_hash.digest } },
      verification_method: 'HUMAN_REVIEW',
      governance_release: 'governance-v1',
      verified_at: '2026-08-27T00:00:00.000Z',
      artifactRepository: repo,
    });
    const evidence = createDocumentEvidenceArtifactV2({
      document_ref: { artifact_id: 'document-1', artifact_type: 'RAW_SOURCE', content_hash: 'document-hash' },
      verified_fact_refs: [{ artifact_id: reviewed.fact.artifact_id, artifact_type: reviewed.fact.artifact_type, content_hash: reviewed.fact.content_hash.digest }],
      source_metadata: { provider: 'fixture', retrieved_at: '2026-08-27T00:00:00.000Z' },
    });
    const propertyContext = { artifact_id: 'lu-property-context-1', artifact_type: LU_PROPERTY_CONTEXT_ARTIFACT_TYPE, content_hash: { algorithm: 'sha256' as const, value: 'property-context-hash' } };
    await repo.put({ artifact_id: evidence.artifact_id, content_hash: evidence.content_hash, body: evidence });
    await repo.put({ artifact_id: propertyContext.artifact_id, content_hash: propertyContext.content_hash, body: propertyContext });
    await repo.put({ artifact_id: 'justification-1', content_hash: { algorithm: 'sha256', value: 'justification-hash' }, body: { artifact_id: 'justification-1', artifact_type: 'GOVERNANCE_NOTE', content_hash: { algorithm: 'sha256', value: 'justification-hash' } } });
    const property = await reviewDocumentEvidenceProperty({
      authUser: userA,
      document_evidence_ref: { artifact_id: evidence.artifact_id, artifact_type: evidence.artifact_type, content_hash: evidence.content_hash.value },
      verified_fact_refs: evidence.payload.verified_fact_refs,
      property_ref: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type, content_hash: propertyContext.content_hash.value },
      justification_refs: [{ artifact_id: 'justification-1', artifact_type: 'GOVERNANCE_NOTE' }],
      governance_release: 'governance-v1',
      artifactRepository: repo,
    });
    return { cas, evidence, binding: property.property_binding, repo, reviewed };
  }

  async function expectNoCasWrite(input: Parameters<typeof admitDocumentEvidenceV2>[0], pattern: RegExp) {
    const put = vi.spyOn(input.cas, 'putCanonical');
    await expect(admitDocumentEvidenceV2(input)).rejects.toThrow(pattern);
    expect(put).not.toHaveBeenCalled();
  }

  it('verifies fact and property review attestations before admitting through the sole CAS writer', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const result = await admitDocumentEvidenceV2({
      authUser: userB, evidence, propertyBinding: binding, governanceRelease: 'governance-v1', artifactRepository: repo, cas,
      signing: admissionSigner, verification: admissionSigner,
    });
    expect(result.cas_content_hash).toMatch(/^sha256:/);
    expect(reviewerGrants.resolveGovernanceReviewerActor).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-b' }));
    expect(reviewerGrants.verifyGovernanceReviewerActorReference).toHaveBeenCalledWith(reviewerA);
  });

  it.each([
    ['property binding content hash', (b: DocumentEvidencePropertyBindingArtifactV3, _r: Awaited<ReturnType<typeof setup>>) => ({ ...b, payload: { ...b.payload, verified_fact_refs: [{ ...b.payload.verified_fact_refs[0], content_hash: '0'.repeat(64) }] } }), /content hash is invalid/],
    ['property review attestation ref', (b: DocumentEvidencePropertyBindingArtifactV3) => createDocumentEvidencePropertyBindingArtifactV3({ ...b.payload, review_attestation_ref: { ...b.payload.review_attestation_ref, content_hash: '0'.repeat(64) } }), /does not match reference|content hash/],
    ['property review action/type', (b: DocumentEvidencePropertyBindingArtifactV3) => ({ ...b, payload: { ...b.payload, review_attestation_ref: { ...b.payload.review_attestation_ref, artifact_type: 'DOCUMENT_FACT_REVIEW_ATTESTATION' as never } } }), /content hash is invalid|DOCUMENT_PROPERTY_REVIEW_ATTESTATION/],
    ['property binding fact refs', (b: DocumentEvidencePropertyBindingArtifactV3) => createDocumentEvidencePropertyBindingArtifactV3({ ...b.payload, verified_fact_refs: [{ ...b.payload.verified_fact_refs[0], artifact_id: 'wrong' }] }), /exact verified fact refs|not found/],
    ['property ref', (b: DocumentEvidencePropertyBindingArtifactV3) => createDocumentEvidencePropertyBindingArtifactV3({ ...b.payload, property_ref: { ...b.payload.property_ref, content_hash: 'wrong' } }), /canonical property context hash/],
    ['justification refs', (b: DocumentEvidencePropertyBindingArtifactV3) => createDocumentEvidencePropertyBindingArtifactV3({ ...b.payload, justification_refs: [{ artifact_id: 'missing', artifact_type: 'GOVERNANCE_NOTE' }] }), /not found/i],
  ])('denies wrong %s before any CAS write', async (_, mutate, error) => {
    const setupResult = await setup();
    await expectNoCasWrite({
      authUser: userB,
      evidence: setupResult.evidence,
      propertyBinding: mutate(setupResult.binding, setupResult) as DocumentEvidencePropertyBindingArtifactV3,
      governanceRelease: 'governance-v1',
      artifactRepository: setupResult.repo,
      cas: setupResult.cas,
      signing: admissionSigner,
      verification: admissionSigner,
    }, error);
  });

  it('denies tampered fact review attestation resolution before any CAS write', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const tamperingRepo = {
      put: repo.put.bind(repo),
      async resolve<T>(ref: { artifact_id: string; artifact_type: string }): Promise<T> {
        const factRef = evidence.payload.verified_fact_refs[0];
        if (ref.artifact_id === factRef.artifact_id) {
          const fact = await repo.resolve<T>(ref) as T & { review_attestation_ref: { content_hash: string } };
          return { ...fact, review_attestation_ref: { ...fact.review_attestation_ref, content_hash: '0'.repeat(64) } };
        }
        return repo.resolve<T>(ref);
      },
    };
    await expectNoCasWrite({
      authUser: userB, evidence, propertyBinding: binding, governanceRelease: 'governance-v1', artifactRepository: tamperingRepo,
      cas, signing: admissionSigner, verification: admissionSigner,
    }, /content hash|attestation|invalid|inconsistent/);
  });

  it('denies when Reviewer B equals Reviewer A before any CAS write', async () => {
    const { cas, evidence, binding, repo } = await setup();
    vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockResolvedValue(reviewerA);
    await expectNoCasWrite({
      authUser: userB, evidence, propertyBinding: binding, governanceRelease: 'governance-v1', artifactRepository: repo,
      cas, signing: admissionSigner, verification: admissionSigner,
    }, /differ from the property binding reviewer/);
  });

  it('denies an ungranted authenticated caller before any CAS write', async () => {
    const { cas, evidence, binding, repo } = await setup();
    vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockRejectedValueOnce(new Error('no verified GOVERNANCE_REVIEWER grant'));
    await expectNoCasWrite({
      authUser: { id: 'ungranted', organisationId: null, bankidId: 'bankid-x', role: 'ADMIN' },
      evidence, propertyBinding: binding, governanceRelease: 'governance-v1', artifactRepository: repo,
      cas, signing: admissionSigner, verification: admissionSigner,
    }, /no verified GOVERNANCE_REVIEWER grant/i);
  });

  it('denies legacy facts and V2 property bindings as new governed admission inputs', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const legacyCandidate = await createDocumentFactCandidate({
      fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION', fact_version: 'v1',
      source_document_ref: { id: 'document-1', content_hash: { algorithm: 'sha256', digest: 'document-hash' } },
      inventory_ref: { id: 'inventory-1', content_hash: { algorithm: 'sha256', digest: 'inventory-hash' } },
      source_span: { text_projection_ref: { id: 'projection-1', content_hash: { algorithm: 'sha256', digest: 'projection-hash' } }, start_offset: 1, end_offset: 2 },
      asserted_by: extractor, assertion_method: 'HUMAN_ASSERTION', asserter_version: 'fixture', asserted_at: '2026-08-27T00:00:00.000Z',
    }, LocalPemSigningKeyProvider.generate('ed25519:extractor-legacy').provider);
    const legacyFact: VerifiedDocumentFactArtifact = await verifyRealDocumentFactCandidate({
      candidate: legacyCandidate, verified_by: reviewerA, verification_method: 'HUMAN_REVIEW',
      policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1, verified_at: '2026-08-27T00:00:00.000Z',
    }, LocalPemSigningKeyProvider.generate('ed25519:legacy-reviewer').provider);
    await repo.put({ artifact_id: legacyFact.artifact_id, content_hash: { algorithm: 'sha256', value: legacyFact.content_hash.digest }, body: legacyFact });
    const legacyEvidence = createDocumentEvidenceArtifactV2({
      document_ref: evidence.payload.document_ref,
      verified_fact_refs: [{ artifact_id: legacyFact.artifact_id, artifact_type: legacyFact.artifact_type, content_hash: legacyFact.content_hash.digest }],
      source_metadata: evidence.payload.source_metadata,
    });
    const v2Binding = createDocumentEvidencePropertyBindingArtifactV2({
      document_evidence_ref: { artifact_id: evidence.artifact_id, artifact_type: evidence.artifact_type, content_hash: evidence.content_hash.value },
      property_ref: binding.payload.property_ref,
      binding_method: 'GOVERNANCE_REVIEWER_CONFIRMED',
      binding_authority: reviewerA,
      justification_refs: binding.payload.justification_refs,
    });
    const legacyEvidenceBinding = createDocumentEvidencePropertyBindingArtifactV3({
      ...binding.payload,
      document_evidence_ref: { artifact_id: legacyEvidence.artifact_id, artifact_type: legacyEvidence.artifact_type, content_hash: legacyEvidence.content_hash.value },
      verified_fact_refs: legacyEvidence.payload.verified_fact_refs,
    });
    await expectNoCasWrite({
      authUser: userB, evidence: legacyEvidence, propertyBinding: legacyEvidenceBinding, governanceRelease: 'governance-v1', artifactRepository: repo,
      cas, signing: admissionSigner, verification: admissionSigner,
    }, /not V2/);
    await expectNoCasWrite({
      authUser: userB, evidence, propertyBinding: v2Binding as unknown as DocumentEvidencePropertyBindingArtifactV3, governanceRelease: 'governance-v1', artifactRepository: repo,
      cas, signing: admissionSigner, verification: admissionSigner,
    }, /requires DocumentEvidencePropertyBinding V3/);
  });

  it('rejects a legacy property binding instead of admitting it through the production bridge', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const legacyBinding = createDocumentEvidencePropertyBindingArtifact({
      document_evidence_ref: binding.payload.document_evidence_ref,
      property_ref: binding.payload.property_ref,
      binding_method: 'GOVERNANCE_REVIEWER_CONFIRMED',
      binding_authority: {
        identity_ref: { artifact_id: reviewerA.identity_ref.id, artifact_type: 'GOVERNANCE_REVIEWER_GRANT' },
        role: 'GOVERNANCE_REVIEWER',
      },
      justification_refs: binding.payload.justification_refs,
    });
    await expectNoCasWrite({
      authUser: userB, evidence, propertyBinding: legacyBinding as unknown as DocumentEvidencePropertyBindingArtifactV3,
      governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: admissionSigner, verification: admissionSigner,
    }, /DocumentEvidencePropertyBinding V3|not confirmed/);
  });

  it('keeps the production route behind the sole DocumentEvidenceAdmitter CAS writer', () => {
    const route = readFileSync(path.join(process.cwd(), 'server/routes/documentEvidence.routes.ts'), 'utf8');
    const bridge = readFileSync(path.join(process.cwd(), 'server/services/documentEvidenceAdmissionBridge.ts'), 'utf8');
    const admitter = readFileSync(path.join(process.cwd(), 'packages/mps-data-governance/src/DocumentEvidenceAdmission.ts'), 'utf8');

    expect(route).toContain('admitDocumentEvidenceV2');
    expect(route).not.toMatch(/\.putCanonical\s*\(/);
    expect(bridge).toMatch(/new DocumentEvidenceAdmitter\(/);
    expect(bridge).toMatch(/admitter\.admit\(/);
    expect(bridge).not.toMatch(/\.putCanonical\s*\(/);
    expect((admitter.match(/\.putCanonical\s*\(/g) ?? [])).toHaveLength(1);
  });
});
