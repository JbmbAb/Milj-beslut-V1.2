import { describe, expect, it, beforeEach, vi } from 'vitest';

let membershipAllowed = true;
vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => {
    // W-U20CDF5 (B1; W-CATCH2 #14): the denial is the access check's own TYPED denial (projectAccessRepository
    // ProjectAccessDeniedError, matched by its code) -- the only failure answered 403. An untyped error is a
    // failed read of the access facts (503 PROJECT_ACCESS_UNRESOLVED / 409 for a refusal), never "not authorized".
    if (!membershipAllowed) throw Object.assign(new Error('User is not a member of this project'), { code: 'PROJECT_ACCESS_DENIED', name: 'ProjectAccessDeniedError' });
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
// DEMO M1a / D9(a): keep localization-geometry currentness DB-independent in this file. Default
// (un-injected) indexes are empty -> currentness NOT_FOUND, i.e. the legacy binding-only path these
// pre-existing tests were written for. Tests that need a geometry inject their own index.
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register() {}
    async listForProject() { return []; }
  },
}));
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => ({
  PrismaLocalizationGeometrySupersessionIndex: class {
    async register() {}
    async listForProject() { return []; }
  },
}));

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
import {
  exportCurrentLuAssessmentPdf,
  resolveCurrentLuAssessmentSummary,
  resolveLuViewerPresentation,
  verifyCurrentLuAssessment,
} from '../../server/modules/localization/localizationOrchestrator';
import { evidenceRefsOf, negativeLayerEvidence } from '../helpers/luGovernedLayerEvidenceU20CDF5';
import { createLocalizationGeometryArtifactV2 } from '@miljobeslut/mps-lu';
import type { LocalizationGeometryProjectionIndex, LocalizationGeometryProjectionRow } from '../../server/repositories/localizationGeometryProjectionRepository';
import type { AuthUser } from '../../server/security/types';

class MemoryRepository {
  readonly values = new Map<string, unknown>();
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    const value = this.values.get(reference.artifact_id);
    // W-U20CDF5-R3 (U20CDF5-R2 verification R2-1): the repository's frozen never-stored contract, the CAS's exact text.
    // The project-property binding this fixture names but never stores is then a PROVEN absence of a root link
    // (ROOT_ARTIFACT_NOT_FOUND), which the PDF does not refuse; "not found: <id>" is a read of unknown persistence
    // (ROOT_READ_ERROR), which it now does.
    if (!value) throw new Error(`Artifact not found: ${reference.artifact_id}`);
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

  // W-U20CDF5 (L2, owner decision 2026-10-02): a V3 record that reads back as a valid assessment pins every
  // governed layer (here one negative evidence per layer); a silent layer in a V3 record is an integrity error.
  const layerEvidence = negativeLayerEvidence(propertyContextRef);
  for (const e of layerEvidence) await repository.put({ artifact_id: e.artifact_id, body: e });
  async function buildAndPersistAssessment(findings: readonly AssessmentFinding[] = [], localizationGeometryRef?: ArtifactReference) {
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
        evidence_refs: evidenceRefsOf(layerEvidence), system_summary: `export pdf test summary ${Math.random()}`,
        ...(localizationGeometryRef ? { localization_geometry_ref: localizationGeometryRef } : {}),
      },
      findings, outcome, attestation,
    });
    await repository.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    return assessment;
  }

  return {
    repository, bindingIndex, newBindingRef, contextNew, propertyContextRef, buildAndPersistAssessment,
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
    const pdfCallsBefore = pdfBufferMock.mock.calls.length;

    const result = await exportCurrentLuAssessmentPdf({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
    });
    // W-APR (OD-R1/OD-R2): the tampered candidate may be the current assessment -> a typed, lasting
    // integrity fault (503, not retryable), never the 404 "no current assessment"; no PDF rendered.
    expect(result).toEqual({
      ok: false,
      status: 503,
      code: 'ASSESSMENT_READ_ERROR',
      failureClass: 'ASSESSMENT_STORAGE_INTEGRITY_FAULT',
      reasonCode: 'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT',
      retryable: false,
      error:
        'Projektets aktuella bedömning kan inte fastställas: en bedömning som kan vara den aktuella kunde inte läsas ' +
        'eller verifieras ur CAS (bestående lagrings- eller integritetsfel). En äldre bedömning visas aldrig i stället. ' +
        'Felet är bestående och löses inte av ett nytt försök. Kontakta systemets administratör.',
    });
    expect(pdfBufferMock.mock.calls.length).toBe(pdfCallsBefore);
  });
});

// ---------------------------------------------------------------------------------------------
// DEMO M1a -- owner decision D9(a): geometry provenance survives into the current-assessment
// read-back and the PDF; every non-NOT_FOUND currentness failure fails closed with its class kept.
// ---------------------------------------------------------------------------------------------

class MemoryGeometryIndex implements LocalizationGeometryProjectionIndex {
  readonly rows: LocalizationGeometryProjectionRow[] = [];
  listCalls = 0;
  failWith: Error | null = null;
  async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: ArtifactReference }): Promise<void> {
    this.rows.push({
      projectId: row.projectId, geometryArtifactId: row.geometryArtifactId,
      propertyContextRefId: row.propertyContextRef.artifact_id, propertyContextRefType: row.propertyContextRef.artifact_type,
      createdAt: new Date(),
    });
  }
  async listForProject(projectId: string): Promise<readonly LocalizationGeometryProjectionRow[]> {
    this.listCalls += 1;
    if (this.failWith) throw this.failWith;
    return this.rows.filter((r) => r.projectId === projectId);
  }
}

/** Like FakeAssessmentProjectionIndex above, but keeps localizationGeometryArtifactId (needed for geometry eligibility). */
class GeometryAwareAssessmentProjectionIndex implements ProjectAssessmentProjectionIndex {
  readonly rows: ProjectAssessmentProjectionRow[] = [];
  listCalls = 0;
  async register(row: {
    projectId: string; assessmentArtifactId: string; assessmentArtifactType: string;
    projectContextRef: ArtifactReference; bindingArtifactId: string; releaseArtifactId: string; localizationGeometryArtifactId?: string | null;
  }): Promise<void> {
    this.rows.push({
      projectId: row.projectId, assessmentArtifactId: row.assessmentArtifactId, assessmentArtifactType: row.assessmentArtifactType,
      projectContextRefId: row.projectContextRef.artifact_id, projectContextRefType: row.projectContextRef.artifact_type,
      bindingArtifactId: row.bindingArtifactId, releaseArtifactId: row.releaseArtifactId,
      localizationGeometryArtifactId: row.localizationGeometryArtifactId ?? null, createdAt: new Date(),
    } as ProjectAssessmentProjectionRow);
  }
  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    this.listCalls += 1;
    return this.rows.filter((r) => r.projectId === projectId);
  }
}

async function putGeometry(
  s: Awaited<ReturnType<typeof setup>>,
  index: MemoryGeometryIndex,
  provenance: 'user_defined' | 'derived_from_property_boundary',
  northing = 6580743.0,
) {
  const geometry = createLocalizationGeometryArtifactV2({
    project_id: PROJECT_ID, property_context_ref: s.propertyContextRef,
    wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, northing],
    provenance, label: `m1a ${provenance} ${northing}`, created_by: 'user-m1a',
  });
  await s.repository.put({ artifact_id: geometry.artifact_id, body: geometry });
  await index.register({ projectId: PROJECT_ID, geometryArtifactId: geometry.artifact_id, propertyContextRef: s.propertyContextRef });
  return geometry;
}

describe('DEMO M1a / D9(a): geometry provenance in read-back + PDF; fail closed on currentness errors', () => {
  beforeEach(() => {
    membershipAllowed = true;
    capturedPdfData = undefined;
    pdfBufferMock.mockClear();
  });

  it.each(['user_defined', 'derived_from_property_boundary'] as const)(
    'current %s geometry -> provenance survives in the stored assessment binding, the read-back AND the PDF',
    async (provenance) => {
      const s = await setup();
      const geometryIndex = new MemoryGeometryIndex();
      const geometry = await putGeometry(s, geometryIndex, provenance);
      const geometryRef = { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type };
      const assessment = await s.buildAndPersistAssessment([waterFinding], geometryRef);
      // The stored (CAS, content-addressed) assessment binds the exact geometry it was produced for,
      // and that immutable geometry artifact carries the provenance.
      expect(assessment.payload.localization_geometry_ref).toEqual(geometryRef);
      expect(geometry.payload.provenance).toBe(provenance);
      const projectionIndex = new GeometryAwareAssessmentProjectionIndex();
      await registerAssessmentProjection({
        projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF,
        localizationGeometryArtifactId: geometry.artifact_id, index: projectionIndex,
      });
      const common = {
        authUser: AUTH_USER, projectId: PROJECT_ID, artifactRepository: s.repository,
        assessmentProjectionIndex: projectionIndex, localizationGeometryIndex: geometryIndex,
      };

      const summary = await resolveCurrentLuAssessmentSummary({ ...common, currentBindingProvider: s.currentBindingProvider() });
      expect(summary.ok).toBe(true);
      if (!summary.ok) throw new Error('expected ok');
      expect(summary.localizationGeometry).toMatchObject({ artifact_id: geometry.artifact_id, provenance });
      expect(summary.localizationGeometry.provenance_label_sv).toMatch(
        provenance === 'user_defined' ? /Användardefinierad/ : /Härledd från fastighetens centrumpunkt/,
      );

      const pdf = await exportCurrentLuAssessmentPdf({ ...common, currentBindingProvider: s.currentBindingProvider() });
      expect(pdf.ok).toBe(true);
      expect(capturedPdfData).toMatchObject({
        lokalisering: {
          geometri_artifact_id: geometry.artifact_id,
          provenance,
          beskrivning: summary.localizationGeometry.provenance_label_sv,
        },
      });
    },
  );

  it('ambiguous current geometry (two heads) -> read-back, PDF, verify and viewer evidence all fail closed with the class kept; no binding-only fallback, no PDF', async () => {
    const s = await setup();
    const geometryIndex = new MemoryGeometryIndex();
    const pointA = await putGeometry(s, geometryIndex, 'user_defined', 6580743.0);
    await putGeometry(s, geometryIndex, 'user_defined', 6580843.0); // second head, no supersession edge
    // A binding-eligible assessment exists for point A: the OLD swallow dropped the geometry filter
    // and would have presented it as current. It must not even be looked up now.
    const assessment = await s.buildAndPersistAssessment([waterFinding], { artifact_id: pointA.artifact_id, artifact_type: pointA.artifact_type });
    const projectionIndex = new GeometryAwareAssessmentProjectionIndex();
    await registerAssessmentProjection({
      projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF,
      localizationGeometryArtifactId: pointA.artifact_id, index: projectionIndex,
    });
    const common = {
      authUser: AUTH_USER, projectId: PROJECT_ID, artifactRepository: s.repository,
      currentBindingProvider: s.currentBindingProvider(), assessmentProjectionIndex: projectionIndex,
      localizationGeometryIndex: geometryIndex,
    };
    const expected = {
      ok: false, status: 409, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY', reasonCode: 'LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY',
    };

    const summary = await resolveCurrentLuAssessmentSummary(common);
    expect(summary).toMatchObject(expected);
    if (summary.ok) throw new Error('expected failure');
    expect((summary as { error: string }).error).toMatch(/ingen bedömning/i);

    expect(await exportCurrentLuAssessmentPdf(common)).toMatchObject(expected);
    expect(pdfBufferMock).not.toHaveBeenCalled();
    expect(await verifyCurrentLuAssessment(common)).toMatchObject(expected);
    expect(await resolveLuViewerPresentation(common)).toMatchObject(expected);
    expect(projectionIndex.listCalls).toBe(0);
  });

  it('CAS/projection/DB error while resolving currentness -> fail closed (503, CURRENTNESS_RESOLUTION_ERROR), never binding-only', async () => {
    const s = await setup();
    const geometryIndex = new MemoryGeometryIndex();
    geometryIndex.failWith = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const projectionIndex = new GeometryAwareAssessmentProjectionIndex();
    const result = await resolveCurrentLuAssessmentSummary({
      authUser: AUTH_USER, projectId: PROJECT_ID, artifactRepository: s.repository,
      currentBindingProvider: s.currentBindingProvider(), assessmentProjectionIndex: projectionIndex,
      localizationGeometryIndex: geometryIndex,
    });
    expect(result).toMatchObject({ ok: false, status: 503, failureClass: 'CURRENTNESS_RESOLUTION_ERROR' });
    expect(projectionIndex.listCalls).toBe(0);
  });

  it('legacy project with NO geometry (NOT_FOUND) -> binding-only read-back still works; provenance reported as unknown, never invented', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment([waterFinding]);
    const projectionIndex = new GeometryAwareAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });
    const common = {
      authUser: AUTH_USER, projectId: PROJECT_ID, artifactRepository: s.repository,
      assessmentProjectionIndex: projectionIndex, localizationGeometryIndex: new MemoryGeometryIndex(),
    };
    const summary = await resolveCurrentLuAssessmentSummary({ ...common, currentBindingProvider: s.currentBindingProvider() });
    expect(summary.ok).toBe(true);
    if (!summary.ok) throw new Error('expected ok');
    expect(summary.localizationGeometry).toEqual({
      artifact_id: null, provenance: null, provenance_label_sv: expect.stringMatching(/^Okänd/),
      // U20-D additions: no bound point recorded -> stated as such, coordinates never invented.
      bound_geometry_status: 'NOT_RECORDED', geometry_type: null, coordinates_wgs84: null, coordinates_sweref99tm: null, srid: null,
    });
    const pdf = await exportCurrentLuAssessmentPdf({ ...common, currentBindingProvider: s.currentBindingProvider() });
    expect(pdf.ok).toBe(true);
    expect(capturedPdfData).toMatchObject({ lokalisering: { geometri_artifact_id: null, provenance: null } });
  });
});
