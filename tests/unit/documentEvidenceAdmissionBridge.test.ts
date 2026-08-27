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
import type { VerifiedDocumentFactArtifact } from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1 } from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import { createDocumentFactCandidate } from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import { verifyRealDocumentFactCandidate } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
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

describe('DOCUMENT-EVIDENCE-V2-PRODUCTION-ADMISSION-BRIDGE-01', () => {
  const signer = LocalPemSigningKeyProvider.generate('ed25519:document-evidence-admission-v1').provider;
  let tempRoot = '';

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  });

  async function setup() {
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
    }, { keyId: 'fixture-extractor', async sign(bytes) { return { signatureBase64: Buffer.from(bytes).toString('base64') }; } });
    const fact: VerifiedDocumentFactArtifact = await verifyRealDocumentFactCandidate({
      candidate, verified_by: reviewerA, verification_method: 'HUMAN_REVIEW',
      policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1, verified_at: '2026-08-27T00:00:00.000Z',
    }, { keyId: 'fixture-reviewer', async sign(bytes) { return { signatureBase64: Buffer.from(bytes).toString('base64') }; } });
    const evidence = createDocumentEvidenceArtifactV2({
      document_ref: { artifact_id: 'document-1', artifact_type: 'RAW_SOURCE', content_hash: 'document-hash' },
      verified_fact_refs: [{ artifact_id: fact.artifact_id, artifact_type: fact.artifact_type, content_hash: fact.content_hash.digest }],
      source_metadata: { provider: 'fixture', retrieved_at: '2026-08-27T00:00:00.000Z' },
    });
    const propertyContext = { artifact_id: 'lu-property-context-1', artifact_type: LU_PROPERTY_CONTEXT_ARTIFACT_TYPE, content_hash: { algorithm: 'sha256', value: 'property-context-hash' } };
    const binding = createDocumentEvidencePropertyBindingArtifactV2({
      document_evidence_ref: { artifact_id: evidence.artifact_id, artifact_type: evidence.artifact_type, content_hash: evidence.content_hash.value },
      property_ref: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type, content_hash: propertyContext.content_hash.value },
      binding_method: 'GOVERNANCE_REVIEWER_CONFIRMED',
      binding_authority: reviewerA,
      justification_refs: [{ artifact_id: 'justification-1', artifact_type: 'GOVERNANCE_NOTE' }],
    });
    await repo.put({ artifact_id: fact.artifact_id, content_hash: { algorithm: 'sha256', value: fact.content_hash.digest }, body: fact });
    await repo.put({ artifact_id: propertyContext.artifact_id, content_hash: propertyContext.content_hash, body: propertyContext });
    await repo.put({ artifact_id: 'justification-1', content_hash: { algorithm: 'sha256', value: 'justification-hash' }, body: { ok: true } });
    vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockResolvedValue(reviewerB);
    vi.spyOn(reviewerGrants, 'verifyGovernanceReviewerActorReference').mockResolvedValue();
    return { cas, evidence, binding, repo, fact };
  }

  it('derives reviewer B from verified grant state, binds the exact chain, and admits only after all checks', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const result = await admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence, propertyBinding: binding, governanceRelease: 'governance-v1', artifactRepository: repo, cas,
      signing: signer, verification: signer,
    });
    expect(result.cas_content_hash).toMatch(/^sha256:/);
    expect(reviewerGrants.resolveGovernanceReviewerActor).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-b' }));
  });

  it('denies an existing non-LU property artifact even when its reference and hash are correct', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const nonLuProperty = { artifact_id: 'project-context-1', artifact_type: 'PROJECT_CONTEXT', content_hash: { algorithm: 'sha256', value: 'project-context-hash' } };
    await repo.put({ artifact_id: nonLuProperty.artifact_id, content_hash: nonLuProperty.content_hash, body: nonLuProperty });
    const forgedBinding = createDocumentEvidencePropertyBindingArtifactV2({
      ...binding.payload,
      property_ref: { artifact_id: nonLuProperty.artifact_id, artifact_type: nonLuProperty.artifact_type, content_hash: nonLuProperty.content_hash.value },
    });
    const put = vi.spyOn(cas, 'putCanonical');

    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence, propertyBinding: forgedBinding, governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: signer, verification: signer,
    })).rejects.toThrow(/must reference an LU_PROPERTY_CONTEXT/i);

    expect(put).not.toHaveBeenCalled();
  });

  it('denies an LU property context reference with a mismatched hash', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const forgedBinding = createDocumentEvidencePropertyBindingArtifactV2({
      ...binding.payload,
      property_ref: { ...binding.payload.property_ref, content_hash: 'wrong-property-context-hash' },
    });
    const put = vi.spyOn(cas, 'putCanonical');

    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence, propertyBinding: forgedBinding, governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: signer, verification: signer,
    })).rejects.toThrow(/claimed canonical property context hash/i);

    expect(put).not.toHaveBeenCalled();
  });

  it('denies a missing LU property context reference', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const forgedBinding = createDocumentEvidencePropertyBindingArtifactV2({
      ...binding.payload,
      property_ref: { artifact_id: 'missing-lu-property-context', artifact_type: LU_PROPERTY_CONTEXT_ARTIFACT_TYPE, content_hash: 'missing-property-context-hash' },
    });
    const put = vi.spyOn(cas, 'putCanonical');

    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence, propertyBinding: forgedBinding, governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: signer, verification: signer,
    })).rejects.toThrow();

    expect(put).not.toHaveBeenCalled();
  });

  it('denies malformed property types before admission', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const malformedBinding = {
      ...binding,
      payload: {
        ...binding.payload,
        property_ref: { ...binding.payload.property_ref, artifact_type: '' },
      },
    };
    const put = vi.spyOn(cas, 'putCanonical');

    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence, propertyBinding: malformedBinding as typeof binding, governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: signer, verification: signer,
    })).rejects.toThrow(/property binding content hash is invalid/i);

    expect(put).not.toHaveBeenCalled();
  });

  it('denies reviewer B when B is also the fact reviewer before a CAS write', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const fact = await repo.resolve<VerifiedDocumentFactArtifact>({ artifact_id: evidence.payload.verified_fact_refs[0].artifact_id, artifact_type: 'VERIFIED_DOCUMENT_FACT' });
    const reviewerBFact = await verifyRealDocumentFactCandidate({
      candidate: {
        artifact_id: fact.candidate_ref.id, artifact_type: 'DOCUMENT_FACT_CANDIDATE', content_hash: fact.candidate_ref.content_hash,
        verification_status: 'CANDIDATE', fact_type: fact.fact_type, fact_version: fact.fact_version,
        source_document_ref: fact.source_document_ref, inventory_ref: fact.inventory_ref, source_span: fact.source_span, assertion: fact.assertion,
      },
      verified_by: reviewerB, verification_method: 'HUMAN_REVIEW', policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1, verified_at: '2026-08-27T00:00:00.000Z',
    }, { keyId: 'fixture-reviewer', async sign(bytes) { return { signatureBase64: Buffer.from(bytes).toString('base64') }; } });
    await repo.put({ artifact_id: reviewerBFact.artifact_id, content_hash: { algorithm: 'sha256', value: reviewerBFact.content_hash.digest }, body: reviewerBFact });
    const exactEvidence = createDocumentEvidenceArtifactV2({
      document_ref: evidence.payload.document_ref,
      verified_fact_refs: [{ artifact_id: reviewerBFact.artifact_id, artifact_type: reviewerBFact.artifact_type, content_hash: reviewerBFact.content_hash.digest }],
      source_metadata: evidence.payload.source_metadata,
    });
    const exactBinding = createDocumentEvidencePropertyBindingArtifactV2({
      ...binding.payload,
      document_evidence_ref: { artifact_id: exactEvidence.artifact_id, artifact_type: exactEvidence.artifact_type, content_hash: exactEvidence.content_hash.value },
    });
    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence: exactEvidence, propertyBinding: exactBinding, governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: signer, verification: signer,
    })).rejects.toThrow(/differ from the fact reviewer/i);
  });

  it('denies a request-supplied binding that names reviewer B as its authority', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const forged = createDocumentEvidencePropertyBindingArtifactV2({
      ...binding.payload,
      binding_authority: reviewerB,
    });
    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence, propertyBinding: forged, governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: signer, verification: signer,
    })).rejects.toThrow(/differ from the property binding reviewer/i);
  });

  it('denies an ungranted authenticated caller before any CAS write', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const put = vi.spyOn(cas, 'putCanonical');
    vi.spyOn(reviewerGrants, 'resolveGovernanceReviewerActor').mockRejectedValueOnce(new Error('no verified GOVERNANCE_REVIEWER grant'));
    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'ungranted', organisationId: null, bankidId: 'bankid-x', role: 'ADMIN' },
      evidence, propertyBinding: binding, governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: signer, verification: signer,
    })).rejects.toThrow(/no verified GOVERNANCE_REVIEWER grant/i);
    expect(put).not.toHaveBeenCalled();
  });

  it('denies a signer trusted only under a different key before any CAS write', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const put = vi.spyOn(cas, 'putCanonical');
    const wrongSigner = LocalPemSigningKeyProvider.generate('ed25519:quarantine-promote').provider;
    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence, propertyBinding: binding, governanceRelease: 'governance-v1', artifactRepository: repo, cas, signing: wrongSigner, verification: signer,
    })).rejects.toThrow(/cryptographic signature is invalid|expected governance key/i);
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects a legacy property binding instead of admitting it through the V2 bridge', async () => {
    const { cas, evidence, binding, repo } = await setup();
    const legacyBinding = createDocumentEvidencePropertyBindingArtifact({
      document_evidence_ref: binding.payload.document_evidence_ref,
      property_ref: binding.payload.property_ref,
      binding_method: binding.payload.binding_method,
      binding_authority: {
        identity_ref: { artifact_id: reviewerA.identity_ref.id, artifact_type: 'GOVERNANCE_REVIEWER_GRANT' },
        role: 'GOVERNANCE_REVIEWER',
      },
      justification_refs: binding.payload.justification_refs,
    });
    const put = vi.spyOn(cas, 'putCanonical');

    await expect(admitDocumentEvidenceV2({
      authUser: { id: 'user-b', organisationId: null, bankidId: 'bankid-b', role: 'CONSULTANT' },
      evidence,
      propertyBinding: legacyBinding as unknown as typeof binding,
      governanceRelease: 'governance-v1',
      artifactRepository: repo,
      cas,
      signing: signer,
      verification: signer,
    })).rejects.toThrow(/not confirmed by a GOVERNANCE_REVIEWER/i);

    expect(put).not.toHaveBeenCalled();
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
