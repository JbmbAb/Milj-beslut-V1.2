import { describe, expect, it, beforeEach, vi } from 'vitest';

let membershipAllowed = true;
vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => {
    if (!membershipAllowed) throw new Error('REJECT_PROJECT_MEMBERSHIP: not a member');
  }),
}));

// buildJsonPdfBuffer renders a real, PDFKit-produced binary PDF (compressed content streams) --
// asserting on the underlying data object is the reliable, precise proof; asserting on decoded
// buffer text is not. Capture the exact object passed in instead of decoding PDF binary output.
const pdfBufferMock = vi.fn(async (_title: string, _subtitle: string | undefined, data: unknown) => {
  capturedPdfData = data;
  return Buffer.from('fake-pdf-bytes-for-test');
});
let capturedPdfData: unknown;
vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: (title: string, subtitle: string | undefined, data: unknown) => pdfBufferMock(title, subtitle, data),
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
  createProductLuPropertyContextArtifact,
  createProductLuProjectContextArtifact,
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
import { exportCurrentLuAssessmentPdf } from '../../server/modules/localization/localizationOrchestrator';
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

const PROJECT_ID = 'project-export-pdf';
const propertyBinding = { artifact_id: 'project-property-binding-export-pdf', artifact_type: 'project_property_binding' } as const;
const geometryRef = { artifact_id: 'geometry-export-pdf', artifact_type: 'CANONICAL_GEOMETRY' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-export-pdf-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-export-pdf-test');

const RELEASE_REF = { artifact_id: 'product-release-export-pdf', artifact_type: 'product_release' } as const;
const AUTH_USER: AuthUser = { id: 'user-export-pdf-test', organisationId: 'org-export-pdf-test', bankidId: 'bankid:export-pdf-test', role: 'CONSULTANT' };

const waterFinding: AssessmentFinding = {
  finding_id: 'finding-water-export-pdf',
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

  // Real governed context artifacts -- the export must resolve these itself, never trust a
  // client-supplied property/project identity.
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: 'property-identity-export-pdf',
    property_ref: 'GÄVLE EXPORT 1:1',
    official_name: 'Gävle Export 1:1',
    geometry_ref: geometryRef,
    municipality: 'Gävle',
    coordinates: [60.67, 17.14],
    project_property_binding_ref: propertyBinding,
  });
  await repository.put({ artifact_id: propertyContext.artifact_id, body: propertyContext });
  const propertyContextRef = { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type } as const;

  const projectContext = createProductLuProjectContextArtifact({
    project_id: PROJECT_ID,
    project_name: 'Export PDF test project',
    description: 'Test project for LU-REPORT-EXPORT-UI-V1',
    created_by: AUTH_USER.id,
    property_context_ref: propertyContextRef,
    project_property_binding_ref: propertyBinding,
  });
  await repository.put({ artifact_id: projectContext.artifact_id, body: projectContext });
  const contextNew = { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type } as const;

  const newBindingUnsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: contextNew, project_property_binding_ref: propertyBinding,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-08-24T00:00:00.000Z',
  });
  const newBinding = { ...newBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: newBindingUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index: bindingIndex, binding: newBinding, verification: pcbVerification });
  const newBindingRef = { artifact_id: newBinding.artifact_id, artifact_type: newBinding.artifact_type } as const;

  async function buildAndPersistAssessment(findings: readonly AssessmentFinding[] = []) {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `export-pdf-${Date.now()}-${Math.random()}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-export-pdf-${Date.now()}-${Math.random()}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-export-pdf', artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const assessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-export-pdf', project_context_ref: contextNew,
        property_ref: propertyContextRef,
        evidence_refs: [], system_summary: `export pdf test summary ${Math.random()}`,
      },
      findings, outcome, attestation,
    });
    await repository.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    return assessment;
  }

  return {
    repository, bindingIndex, newBindingRef, contextNew, buildAndPersistAssessment,
    currentBindingProvider: () => new ProjectContextBindingProvider(repository, bindingIndex, pcbVerification),
  };
}

describe('LU-REPORT-EXPORT-UI-V1: exportCurrentLuAssessmentPdf', () => {
  beforeEach(() => {
    membershipAllowed = true;
  });

  it('authenticated + current assessment -> PDF derived from the real governed assessment and its own resolved property/project context', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment([waterFinding]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await exportCurrentLuAssessmentPdf({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.filename).toContain(PROJECT_ID);
    expect(capturedPdfData).toMatchObject({
      property: { official_name: 'Gävle Export 1:1', municipality: 'Gävle' },
      project: { project_name: 'Export PDF test project' },
      findings: [expect.objectContaining({ finding_id: waterFinding.finding_id, rule_id: 'LU-WATER-001' })],
      verification: { assessment_artifact_id: assessment.artifact_id, content_hash_verified: true },
    });
  });

  it('negative proof: client-supplied findings/coordinates cannot change the exported content -- the function accepts no such input at all', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment([waterFinding]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    // exportCurrentLuAssessmentPdf's input type has no findings/coordinates/risk field at all --
    // this is the proof by construction: there is no parameter through which a caller could even
    // attempt to supply report authority. Casting through `as any` to simulate a malicious caller
    // who tries anyway; the function must not read it.
    const maliciousInput = {
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
      findings: [{ finding_id: 'fabricated', rule_id: 'FABRICATED', rule_version: '99', risk_level: 'HIGH', explanation: 'not real', evidence_refs: [] }],
      siteAlternatives: [{ id: 'fake', lat: 0, lng: 0 }],
    } as unknown as Parameters<typeof exportCurrentLuAssessmentPdf>[0];

    const result = await exportCurrentLuAssessmentPdf(maliciousInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const data = capturedPdfData as { findings: Array<{ finding_id: string; rule_id: string }> };
    expect(data.findings).toEqual([expect.objectContaining({ finding_id: waterFinding.finding_id, rule_id: 'LU-WATER-001' })]);
    expect(JSON.stringify(data)).not.toContain('fabricated');
    expect(JSON.stringify(data)).not.toContain('FABRICATED');
  });

  it('unauthorized user -> DENY (403), no PDF produced', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment([waterFinding]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });
    membershipAllowed = false;

    const result = await exportCurrentLuAssessmentPdf({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('no current assessment -> explicit unavailable (404), no PDF produced', async () => {
    const s = await setup();
    const projectionIndex = new FakeAssessmentProjectionIndex(); // never registered

    const result = await exportCurrentLuAssessmentPdf({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('tampered assessment -> never exported (rejected during projection selection, same as read path)', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment([waterFinding]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const tampered = { ...assessment, payload: { ...assessment.payload, findings: [{ ...waterFinding, risk_level: 'HIGH' as const }] } };
    s.repository.values.set(assessment.artifact_id, tampered);

    const result = await exportCurrentLuAssessmentPdf({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
