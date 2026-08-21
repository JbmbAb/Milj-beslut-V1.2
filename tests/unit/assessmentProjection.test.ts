import { describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '../../packages/mps-compliance/src/artifacts/ArtifactReference';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingIssuerArtifact,
  createGovernedLocalizationAssessment,
  type LocalizationAssessmentArtifact,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import {
  attestProjectContextBindingArtifact,
  attestProjectContextBindingSupersessionArtifact,
} from '../../server/modules/localization/projectContextBindingAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection, resolveCurrentAssessmentProjection } from '../../server/modules/localization/assessmentProjection';

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

/** In-memory stand-in for the Prisma-backed index; a monotonic counter simulates createdAt so
 * ordering is deterministic regardless of real wall-clock timing between fast test operations. */
class FakeAssessmentProjectionIndex implements ProjectAssessmentProjectionIndex {
  private counter = 0;
  readonly rowsByProject = new Map<string, ProjectAssessmentProjectionRow[]>();
  async register(row: {
    projectId: string; assessmentArtifactId: string; assessmentArtifactType: string;
    projectContextRef: ArtifactReference; bindingArtifactId: string; releaseArtifactId: string;
  }): Promise<void> {
    const list = this.rowsByProject.get(row.projectId) ?? [];
    if (list.some((r) => r.assessmentArtifactId === row.assessmentArtifactId)) return; // idempotent no-op
    this.counter += 1;
    list.push({
      projectId: row.projectId,
      assessmentArtifactId: row.assessmentArtifactId,
      assessmentArtifactType: row.assessmentArtifactType,
      projectContextRefId: row.projectContextRef.artifact_id,
      projectContextRefType: row.projectContextRef.artifact_type,
      bindingArtifactId: row.bindingArtifactId,
      releaseArtifactId: row.releaseArtifactId,
      createdAt: new Date(this.counter * 1000),
    });
    this.rowsByProject.set(row.projectId, list);
  }
  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    return [...(this.rowsByProject.get(projectId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

const PROJECT_ID = 'project-assessment-projection';
const OTHER_PROJECT_ID = 'project-assessment-projection-other';
const contextOld = { artifact_id: 'lu-context-projection-old', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const contextNew = { artifact_id: 'lu-context-projection-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-projection', artifact_type: 'project_property_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-projection', artifact_type: 'product_release' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-projection-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;

async function setup() {
  const repository = new MemoryRepository();
  const bindingIndex = new MemoryBindingIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });

  async function provisionBinding(projectId: string, contextRef: ArtifactReference, createdAt: string) {
    const unsigned = createProjectContextBindingArtifact({
      project_id: projectId, project_context_ref: contextRef, project_property_binding_ref: propertyBinding,
      binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: createdAt,
    });
    const signed = { ...unsigned, attestation: await attestProjectContextBindingArtifact({ artifact: unsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
    await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index: bindingIndex, binding: signed, verification: pcbVerification });
    return { artifact_id: signed.artifact_id, artifact_type: signed.artifact_type } as const;
  }

  // Only the current binding is provisioned eagerly. Provisioning BOTH old and new up front,
  // unconditionally, would leave two un-superseded bindings for tests that never call
  // provisionOldBindingAndSupersede -- resolveCurrentProjectContextBindingHead correctly refuses
  // to pick a head among two un-superseded bindings ("ambiguous head"), so tests that don't need
  // supersession history must not have a stray second binding lying around.
  const newBindingRef = await provisionBinding(PROJECT_ID, contextNew, '2026-08-21T00:00:00.000Z');

  async function provisionOldBindingAndSupersede(): Promise<ArtifactReference> {
    const oldBindingRef = await provisionBinding(PROJECT_ID, contextOld, '2026-08-20T00:00:00.000Z');
    const unsigned = createProjectContextBindingSupersessionArtifact({
      contract_version: 'PROJECT_CONTEXT_BINDING_SUPERSESSION_V1', project_id: PROJECT_ID,
      superseded_binding_ref: oldBindingRef, successor_binding_ref: newBindingRef,
      reason_code: 'TEST_SUPERSESSION', issuer_ref: pcbAuthority, issuer_key_id: pcbIssuerKey.provider.keyId,
      issued_at: '2026-08-21T00:01:00.000Z',
    });
    const signed = { ...unsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: unsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
    await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repository, index: bindingIndex, supersession: signed, verification: pcbVerification });
    return oldBindingRef;
  }

  async function buildAndPersistAssessment(projectContextRef: ArtifactReference, evidenceRefs: readonly ArtifactReference[] = []) {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `projection-${Date.now()}-${Math.random()}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-projection-${Date.now()}-${Math.random()}`,
      artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-projection', artifact_type: 'execution_attempt' },
      result: 'success' as const,
      content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const assessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-projection',
        project_context_ref: projectContextRef,
        property_ref: { artifact_id: 'property-projection', artifact_type: 'PROPERTY' },
        evidence_refs: evidenceRefs,
        system_summary: `projection test assessment ${Math.random()}`,
      },
      findings: [],
      outcome,
      attestation,
    });
    await repository.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    return assessment;
  }

  return {
    repository, bindingIndex, newBindingRef, provisionOldBindingAndSupersede, buildAndPersistAssessment,
    currentBindingProvider: () => new ProjectContextBindingProvider(repository, bindingIndex, pcbVerification),
  };
}

describe('P3-LU-ASSESSMENT-CURRENT-PROJECTION-01', () => {
  it('first successful assessment -> projection inserted', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment(contextNew);
    const index = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });
    const rows = await index.listForProject(PROJECT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assessmentArtifactId).toBe(assessment.artifact_id);
  });

  it('identical rerun -> idempotent / no duplicate semantic row', async () => {
    const s = await setup();
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: 'projection-idempotent' });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: 'outcome-idempotent', artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-idempotent', artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', fixed: true }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const draft = {
      site_id: 'site-idempotent', project_context_ref: contextNew,
      property_ref: { artifact_id: 'property-projection', artifact_type: 'PROPERTY' },
      evidence_refs: [], system_summary: 'identical rerun',
    };
    const assessmentA = createGovernedLocalizationAssessment({ draft, findings: [], outcome, attestation });
    const assessmentB = createGovernedLocalizationAssessment({ draft, findings: [], outcome, attestation });
    expect(assessmentA.artifact_id).toBe(assessmentB.artifact_id); // same content -> same identity

    const index = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: assessmentA, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: assessmentB, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });
    const rows = await index.listForProject(PROJECT_ID);
    expect(rows).toHaveLength(1);
  });

  it('new assessment same current binding: both historical rows retained -> deterministic current selection', async () => {
    const s = await setup();
    const index = new FakeAssessmentProjectionIndex();
    const first = await s.buildAndPersistAssessment(contextNew);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: first, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });
    const second = await s.buildAndPersistAssessment(contextNew);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: second, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });

    const rows = await index.listForProject(PROJECT_ID);
    expect(rows).toHaveLength(2);
    const result = await resolveCurrentAssessmentProjection({
      projectId: PROJECT_ID, artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(), index,
    });
    expect(result.assessmentArtifactId).toBe(second.artifact_id); // most recent of the eligible set
  });

  it('binding superseded -> old assessment no longer current', async () => {
    const s = await setup();
    const index = new FakeAssessmentProjectionIndex();
    const oldBindingRef = await s.provisionOldBindingAndSupersede();
    const oldAssessment = await s.buildAndPersistAssessment(contextOld);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: oldAssessment, contextBindingRef: oldBindingRef, releaseRef: RELEASE_REF, index });

    await expect(
      resolveCurrentAssessmentProjection({ projectId: PROJECT_ID, artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(), index }),
    ).rejects.toThrow('REJECT_ASSESSMENT_PROJECTION_NOT_CURRENT');
  });

  it('new assessment under new binding -> becomes current', async () => {
    const s = await setup();
    const index = new FakeAssessmentProjectionIndex();
    const oldBindingRef = await s.provisionOldBindingAndSupersede();
    const oldAssessment = await s.buildAndPersistAssessment(contextOld);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: oldAssessment, contextBindingRef: oldBindingRef, releaseRef: RELEASE_REF, index });
    const newAssessment = await s.buildAndPersistAssessment(contextNew);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: newAssessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });

    const result = await resolveCurrentAssessmentProjection({
      projectId: PROJECT_ID, artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(), index,
    });
    expect(result.assessmentArtifactId).toBe(newAssessment.artifact_id);
  });

  it('missing CAS artifact -> fail closed (falls through to no valid candidate)', async () => {
    const s = await setup();
    const index = new FakeAssessmentProjectionIndex();
    const assessment = await s.buildAndPersistAssessment(contextNew);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });
    s.repository.values.delete(assessment.artifact_id); // simulate CAS entry disappearing

    await expect(
      resolveCurrentAssessmentProjection({ projectId: PROJECT_ID, artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(), index }),
    ).rejects.toThrow('REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no candidate for the current binding survived CAS re-verification');
  });

  it('tampered CAS artifact -> fail closed', async () => {
    const s = await setup();
    const index = new FakeAssessmentProjectionIndex();
    const assessment = await s.buildAndPersistAssessment(contextNew);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });
    const tampered = { ...assessment, payload: { ...assessment.payload, system_summary: 'tampered after persistence' } };
    s.repository.values.set(assessment.artifact_id, tampered);

    await expect(
      resolveCurrentAssessmentProjection({ projectId: PROJECT_ID, artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(), index }),
    ).rejects.toThrow('REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no candidate for the current binding survived CAS re-verification');
  });

  it('wrong project -> deny (row scoping prevents cross-project leakage)', async () => {
    const s = await setup();
    const index = new FakeAssessmentProjectionIndex();
    const assessment = await s.buildAndPersistAssessment(contextNew);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });

    await expect(
      resolveCurrentAssessmentProjection({ projectId: OTHER_PROJECT_ID, artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(), index }),
    ).rejects.toThrow('REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no assessment projection for project');
  });

  it('DB projection rebuilt with same rows -> same current resolution', async () => {
    const s = await setup();
    const index = new FakeAssessmentProjectionIndex();
    const assessment = await s.buildAndPersistAssessment(contextNew);
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index });
    const rows = await index.listForProject(PROJECT_ID);

    // A fresh index instance, "rebuilt" from the exact same underlying row data.
    const rebuilt = new FakeAssessmentProjectionIndex();
    for (const row of rows) {
      await rebuilt.register({
        projectId: row.projectId,
        assessmentArtifactId: row.assessmentArtifactId,
        assessmentArtifactType: row.assessmentArtifactType,
        projectContextRef: { artifact_id: row.projectContextRefId, artifact_type: row.projectContextRefType },
        bindingArtifactId: row.bindingArtifactId,
        releaseArtifactId: row.releaseArtifactId,
      });
    }

    const first = await resolveCurrentAssessmentProjection({ projectId: PROJECT_ID, artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(), index });
    const second = await resolveCurrentAssessmentProjection({ projectId: PROJECT_ID, artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(), index: rebuilt });
    expect(second.assessmentArtifactId).toBe(first.assessmentArtifactId);
  });
});
