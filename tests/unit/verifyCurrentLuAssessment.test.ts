import { describe, expect, it, beforeEach, vi } from 'vitest';

let membershipAllowed = true;
vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => {
    if (!membershipAllowed) throw new Error('REJECT_PROJECT_MEMBERSHIP: not a member');
  }),
}));

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '../../packages/mps-compliance/src/artifacts/ArtifactReference';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  runLuAssessmentViaKernel,
  buildSpatialEvidenceContentHash,
  SPATIAL_STACK_V1,
  type AssessmentFinding,
  type SpatialEvidenceArtifact,
  type LocalizationAssessmentArtifact,
} from '@miljobeslut/mps-lu';
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProjectContextBindingSupersessionArtifact,
  attestProjectContextBindingSupersessionIssuerArtifact,
} from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { verifyCurrentLuAssessment } from '../../server/modules/localization/localizationOrchestrator';
import type { AuthUser } from '../../server/security/types';

class MemoryRepository {
  readonly values = new Map<string, unknown>();
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    const value = this.values.get(reference.artifact_id);
    if (!value) throw new Error(`not found: ${reference.artifact_id}`);
    return value as T;
  }
}

class MemoryBindingIndex implements ProjectContextBindingIndex {
  private readonly byProjectAndContext = new Map<string, string>();
  private readonly bindingsByProject = new Map<string, ArtifactReference[]>();
  private readonly supersessionsByProject = new Map<string, ArtifactReference[]>();
  private key(projectId: string, context: ArtifactReference): string {
    return `${projectId}:${context.artifact_type}:${context.artifact_id}`;
  }
  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    const key = this.key(binding.payload.project_id, binding.payload.project_context_ref);
    const existing = this.byProjectAndContext.get(key);
    if (existing && existing !== binding.artifact_id) throw new Error('binding collision');
    this.byProjectAndContext.set(key, binding.artifact_id);
    const list = this.bindingsByProject.get(binding.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === binding.artifact_id)) {
      list.push({ artifact_id: binding.artifact_id, artifact_type: binding.artifact_type });
      this.bindingsByProject.set(binding.payload.project_id, list);
    }
  }
  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const bindingId = this.byProjectAndContext.get(this.key(projectId, context));
    if (!bindingId) throw new Error('no binding');
    return bindingId;
  }
  async registerSupersession(supersession: ReturnType<typeof createProjectContextBindingSupersessionArtifact>): Promise<void> {
    const list = this.supersessionsByProject.get(supersession.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === supersession.artifact_id)) {
      list.push({ artifact_id: supersession.artifact_id, artifact_type: supersession.artifact_type });
      this.supersessionsByProject.set(supersession.payload.project_id, list);
    }
  }
  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.bindingsByProject.get(projectId) ?? [];
  }
  async listSupersessionRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.supersessionsByProject.get(projectId) ?? [];
  }
}

class FakeAssessmentProjectionIndex implements ProjectAssessmentProjectionIndex {
  private counter = 0;
  private readonly rowsByProject = new Map<string, ProjectAssessmentProjectionRow[]>();
  async register(row: {
    projectId: string; assessmentArtifactId: string; assessmentArtifactType: string;
    projectContextRef: ArtifactReference; bindingArtifactId: string; releaseArtifactId: string;
  }): Promise<void> {
    const list = this.rowsByProject.get(row.projectId) ?? [];
    if (list.some((r) => r.assessmentArtifactId === row.assessmentArtifactId)) return;
    this.counter += 1;
    list.push({
      projectId: row.projectId, assessmentArtifactId: row.assessmentArtifactId, assessmentArtifactType: row.assessmentArtifactType,
      projectContextRefId: row.projectContextRef.artifact_id, projectContextRefType: row.projectContextRef.artifact_type,
      bindingArtifactId: row.bindingArtifactId, releaseArtifactId: row.releaseArtifactId, createdAt: new Date(this.counter * 1000),
    });
    this.rowsByProject.set(row.projectId, list);
  }
  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    return [...(this.rowsByProject.get(projectId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

const PROJECT_ID = 'project-verify-assessment';
const contextNew = { artifact_id: 'lu-context-verify-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-verify', artifact_type: 'project_property_binding' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-verify-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-verify-test');

const RELEASE_REF = { artifact_id: 'product-release-verify', artifact_type: 'product_release' } as const;
const AUTH_USER: AuthUser = { id: 'user-verify-test', organisationId: 'org-verify-test', bankidId: 'bankid:verify-test', role: 'CONSULTANT' };

function spatialEvidence(id: string, siteId: string): SpatialEvidenceArtifact {
  const payload = {
    result_semantics: {
      kind: 'EXISTENCE_WITHIN_DISTANCE' as const,
      query: { subject_ref: { artifact_id: 'prop-verify', artifact_type: 'PROPERTY' }, srid: 3006, distance_meters: 100 },
      result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
    },
    property_ref: { artifact_id: 'prop-verify', artifact_type: 'PROPERTY' },
    geometry: null,
    srid: 3006,
    operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
    layer_ref: { layer_id: 'water', version_hash: 'b'.repeat(64), layer_version: 'v1' },
    source_metadata: { provider: 'SGU', dataset: 'water', dataset_version: 'b'.repeat(64), retrieved_at: '2026-08-24T00:00:00.000Z' },
    query_context: { query_id: `q-${siteId}`, query_type: 'SPATIAL_DWITHIN', parameters: {} },
  };
  return {
    artifact_id: id, artifact_type: 'SPATIAL_EVIDENCE',
    content_hash: buildSpatialEvidenceContentHash(payload as never),
    references: [{ artifact_id: 'prop-verify', artifact_type: 'PROPERTY' }],
    payload,
  } as unknown as SpatialEvidenceArtifact;
}

async function setup() {
  const repository = new MemoryRepository();
  const bindingIndex = new MemoryBindingIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });

  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = pcbSupersessionIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = pcbSupersessionIssuerKey.publicKey;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const pcbSupersessionIssuerUnsigned = createProjectContextBindingSupersessionIssuerArtifact({
    issuer_key_id: pcbSupersessionIssuerKey.provider.keyId,
    owner_authority_ref: pcbAuthority,
  });
  const pcbSupersessionIssuer = {
    ...pcbSupersessionIssuerUnsigned,
    attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: pcbSupersessionIssuerUnsigned, signing: pcbSupersessionIssuerKey.provider }),
  };
  await repository.put({ artifact_id: pcbSupersessionIssuer.artifact_id, body: pcbSupersessionIssuer });

  const newBindingUnsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: contextNew, project_property_binding_ref: propertyBinding,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-08-24T00:00:00.000Z',
  });
  const newBinding = { ...newBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: newBindingUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index: bindingIndex, binding: newBinding, verification: pcbVerification });
  const newBindingRef = { artifact_id: newBinding.artifact_id, artifact_type: newBinding.artifact_type } as const;

  // Uses the real kernel (as H15's own test suite does) rather than hand-rolling an
  // outcome/attempt/manifest chain -- H15's re-execution needs the full, genuine chain
  // (replayFromManifestId) to resolve, not just an assessment artifact in isolation.
  async function buildAndPersistAssessment(siteId = `site-verify-${Date.now()}-${Math.random()}`) {
    const evidence = spatialEvidence(`spatial-verify-${siteId}`, siteId);
    await repository.put({ artifact_id: evidence.artifact_id, content_hash: evidence.content_hash, body: evidence });
    const kernelResult = await runLuAssessmentViaKernel({
      site_id: siteId,
      deterministic_seed: `seed:${siteId}`,
      evidence: [evidence],
      artifact_repository: repository,
      assessment_draft: {
        site_id: siteId,
        project_context_ref: contextNew,
        property_ref: { artifact_id: 'property-verify', artifact_type: 'PROPERTY' },
        evidence_refs: [{ artifact_id: evidence.artifact_id, artifact_type: evidence.artifact_type }],
        system_summary: `verify test summary ${siteId}`,
      },
    });
    if (!kernelResult.assessment) throw new Error('expected kernel to admit and persist an assessment');
    const assessment = kernelResult.assessment as LocalizationAssessmentArtifact;
    return assessment;
  }

  return {
    repository, bindingIndex, newBindingRef, buildAndPersistAssessment,
    currentBindingProvider: () => new ProjectContextBindingProvider(repository, bindingIndex, pcbVerification),
  };
}

describe('LU-REEXECUTION-VERIFY-UI-V1: verifyCurrentLuAssessment', () => {
  beforeEach(() => {
    membershipAllowed = true;
    process.env.MPS_LU_BOOTSTRAP_ADMIT = '1';
  });

  it('proof 1+2: uses the persisted assessment identity; PASS only when H15 re-execution matches exactly', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment();
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await verifyCurrentLuAssessment({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.assessmentArtifactId).toBe(assessment.artifact_id);
    expect(result.outcome).toBe('PASS');
    expect(result.mismatches).toEqual([]);
  });

  it('proof 3: a tampered finding reports mismatch/DENY, never PASS', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment();

    // Simulates rule-engine drift since this assessment was minted (e.g. a rule_version change),
    // NOT a direct CAS edit: build a genuinely self-consistent artifact -- both content_hash AND
    // artifact_id recomputed to match the (fabricated) findings -- so it legitimately becomes
    // "current" via resolveCurrentLuAssessmentSummary's own tamper check, and the mismatch is then
    // caught by H15's findings comparison specifically, not by the earlier identity gate.
    const realFinding = assessment.payload.findings[0]!;
    const newPayload = { ...assessment.payload, findings: [{ ...realFinding, risk_level: 'HIGH' as const }] };
    const identityBody = { artifact_type: assessment.artifact_type, references: assessment.references, payload: newPayload };
    const newHash = sha256ContentHash(identityBody);
    const tampered = { ...assessment, payload: newPayload, content_hash: newHash, artifact_id: `assessment-${newHash.value}` };
    s.repository.values.delete(assessment.artifact_id);
    s.repository.values.set(tampered.artifact_id, tampered);

    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: tampered, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await verifyCurrentLuAssessment({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.outcome).toBe('DENY');
    expect(result.mismatches.some((m) => m.code === 'FINDINGS_MISMATCH')).toBe(true);
  });

  it('proof 5: client-supplied findings/evidence cannot influence the result -- no such parameter exists to supply them through', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment();
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const maliciousInput = {
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
      findings: [{ finding_id: 'fabricated', rule_id: 'FABRICATED', rule_version: '99', risk_level: 'HIGH', explanation: 'not real', evidence_refs: [] }],
      expectedOutcome: 'PASS',
    } as unknown as Parameters<typeof verifyCurrentLuAssessment>[0];

    const result = await verifyCurrentLuAssessment(maliciousInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.outcome).toBe('PASS');
    expect(result.assessmentArtifactId).toBe(assessment.artifact_id);
    expect(JSON.stringify(result.mismatches)).not.toContain('fabricated');
  });

  it('proof 8: unauthorized user -> DENY (403), H15 never invoked', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment();
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });
    membershipAllowed = false;

    const result = await verifyCurrentLuAssessment({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('no current assessment -> explicit unavailable (404), H15 never invoked', async () => {
    const s = await setup();
    const projectionIndex = new FakeAssessmentProjectionIndex(); // never registered

    const result = await verifyCurrentLuAssessment({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
