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
  createGovernedLocalizationAssessment,
  type AssessmentFinding,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
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
import { resolveCurrentLuAssessmentSummary } from '../../server/modules/localization/localizationOrchestrator';
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

const PROJECT_ID = 'project-assessment-read';
const contextNew = { artifact_id: 'lu-context-assessment-read-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-assessment-read', artifact_type: 'project_property_binding' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-assessment-read-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-assessment-read-test');

const RELEASE_REF = { artifact_id: 'product-release-assessment-read', artifact_type: 'product_release' } as const;
const AUTH_USER: AuthUser = { id: 'user-assessment-read-test', organisationId: 'org-assessment-read-test', bankidId: 'bankid:assessment-read-test', role: 'CONSULTANT' };

const waterFinding: AssessmentFinding = {
  finding_id: 'finding-water-assessment-read',
  rule_id: 'LU-WATER-001',
  rule_version: '1.0',
  risk_level: 'MEDIUM',
  explanation: 'Närhet till vatten kräver analys',
  evidence_refs: [],
};

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

  async function buildAndPersistAssessment(projectContextRef: ArtifactReference, findings: readonly AssessmentFinding[] = []) {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `assessment-read-${Date.now()}-${Math.random()}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-assessment-read-${Date.now()}-${Math.random()}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-assessment-read', artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const assessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-assessment-read', project_context_ref: projectContextRef,
        property_ref: { artifact_id: 'property-assessment-read', artifact_type: 'PROPERTY' },
        evidence_refs: [], system_summary: `assessment read test ${Math.random()}`,
      },
      findings, outcome, attestation,
    });
    await repository.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    return assessment;
  }

  return {
    repository, bindingIndex, newBindingRef, buildAndPersistAssessment,
    currentBindingProvider: () => new ProjectContextBindingProvider(repository, bindingIndex, pcbVerification),
  };
}

describe('LU-ASSESSMENT-PERSISTENCE-READ-V1: resolveCurrentLuAssessmentSummary', () => {
  beforeEach(() => {
    membershipAllowed = true;
  });

  it('authenticated + current assessment -> real findings/rule_refs/evidence_refs returned', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment(contextNew, [waterFinding]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await resolveCurrentLuAssessmentSummary({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.assessmentArtifactId).toBe(assessment.artifact_id);
    expect(result.findings).toEqual([waterFinding]);
    expect(result.ruleRefs).toEqual([{ rule_id: 'LU-WATER-001', rule_version: '1.0' }]);
    expect(result.evidenceRefs).toEqual([]);
    expect(typeof result.systemSummary).toBe('string');
  });

  it('unauthorized user -> DENY (403)', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment(contextNew);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });
    membershipAllowed = false;

    const result = await resolveCurrentLuAssessmentSummary({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('no assessment has ever been produced -> explicit unavailable (404), no stale fallback', async () => {
    const s = await setup();
    const projectionIndex = new FakeAssessmentProjectionIndex(); // never registered

    const result = await resolveCurrentLuAssessmentSummary({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('assessment persisted to CAS but its projection row was never written -> 404, never a stale/browser-supplied fallback', async () => {
    const s = await setup();
    await s.buildAndPersistAssessment(contextNew); // persisted, but never registered below
    const projectionIndex = new FakeAssessmentProjectionIndex();

    const result = await resolveCurrentLuAssessmentSummary({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('tampered assessment content_hash -> never presented as current (rejected during projection selection itself)', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment(contextNew, [waterFinding]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    // Mutate the stored body after persistence, keeping the same content_hash -- exactly what a
    // corrupted/tampered CAS write would look like.
    const tampered = { ...assessment, payload: { ...assessment.payload, findings: [{ ...waterFinding, risk_level: 'HIGH' as const }] } };
    s.repository.values.set(assessment.artifact_id, tampered);

    const result = await resolveCurrentLuAssessmentSummary({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    // resolveCurrentAssessmentProjection (called internally) already re-verifies every candidate's
    // hash and rejects a tampered one during selection -- it never becomes "current" in the first
    // place, so no candidate survives and this module's own redundant tamper check never even runs.
    // The observable outcome is the same fail-closed result as "no current assessment": 404, not a
    // distinct 424 -- the projection layer's own verification is what actually caught this.
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
