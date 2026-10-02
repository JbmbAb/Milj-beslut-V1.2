/**
 * DEMO M1a-repair, verifier findings F1 + F2 through the real GenerateLocalizationReportUseCase.
 *
 * Unlike luGeometryCurrentnessD9aUsecase.test.ts (which injects each failure class into a mocked
 * resolveOrDeriveCurrentLocalizationGeometry), this file keeps the REAL geometry service, provider,
 * graph reduction and signed-edge verification, and injects the failure where it happens in
 * production: one CAS read. A transient CAS read failure on the current head must stop the run
 * before the spatial query and the kernel (EXECUTION_FAILED, CURRENTNESS_RESOLUTION_ERROR), never
 * run the kernel on the superseded predecessor.
 *
 * Mock layout follows luGeometryCurrentnessD9aUsecase.test.ts. Hermetic: both projection
 * repositories and server/db/prisma are mocked (the prisma guard throws and records on any access).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kernelMock = vi.fn();
const queryMock = vi.fn();

const state = vi.hoisted(() => ({
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  supersessionRows: [] as Array<{ projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date }>,
  registerCalls: 0,
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register() {
      state.registerCalls += 1;
    }
    async listForProject(projectId: string) {
      return state.geometryRows.filter((r) => r.projectId === projectId);
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => ({
  PrismaLocalizationGeometrySupersessionIndex: class {
    async register() {}
    async listForProject(projectId: string) {
      return state.supersessionRows.filter((r) => r.projectId === projectId);
    }
  },
}));
vi.mock('@miljobeslut/mps-lu', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LU_SPATIAL_CAPABILITY_KEY: 'lu.spatial',
  runLuAssessmentViaKernel: (...args: unknown[]) => kernelMock(...args),
  runCanonicalLuProductAssessment: (...args: unknown[]) => kernelMock(...args),
  deriveLuExecutionSeed: vi.fn(() => 'canonical-seed'),
  createLuRegistryRuntime: vi.fn(() => ({ getReleaseSnapshot: () => ({ snapshot_id: 'lu-registry-snapshot-test' }) })),
}));
vi.mock('../../server/services/complianceRuleEngine', () => ({
  evaluateComplianceRules: vi.fn(() => ({
    overallRisk: 'LOW', permitProbability: 0.9, restrictions: [], rules: [], summary: 'legacy',
    requiredActions: [], notes: [],
  })),
}));
vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: vi.fn(async () => ({
    protectedAreaHits: [], protectedAreaAvailable: true, isProtected: false,
    sgu: { manualReviewRequired: false, summary: 'ok' },
    distanceToWaterMeters: 50, distanceToWaterAvailable: true,
  })),
}));
vi.mock('../../server/services/nvrService', () => ({ fetchProtectedAreas: vi.fn(async () => []) }));
vi.mock('../../server/services/raaService', () => ({ fetchAncientMonuments: vi.fn(async () => []) }));
vi.mock('../../server/services/vissService', () => ({ queryVissPoint: vi.fn(async () => null) }));
vi.mock('../../server/services/sguRiskService', () => ({ toGeologicalData: vi.fn(() => ({})) }));
vi.mock('../../server/services/sluService', () => ({ searchSluByCoordinates: vi.fn(async () => []), getSpeciesInformation: vi.fn(async () => null) }));
vi.mock('../../server/services/auditTrailService', () => ({ auditTrail: { logAction: vi.fn(async () => undefined) } }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/application/enqueue-lu-execution-ticket', () => ({ enqueueAdmittedLuTicket: vi.fn(async () => 'ticket-1') }));
vi.mock('../../server/modules/localization/assessmentProjection', () => ({ registerAssessmentProjection: vi.fn(async () => undefined) }));
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: vi.fn(async () => ({
    projectContextRef: { artifact_id: 'project-context-1', artifact_type: 'LU_PROJECT_CONTEXT' },
    propertyContextRef: { artifact_id: 'property-context-1', artifact_type: 'LU_PROPERTY_CONTEXT' },
    geometryRef: { artifact_id: 'property-geometry-1', artifact_type: 'geometry' },
    contextBindingRef: { artifact_id: 'project-context-binding-1', artifact_type: 'project_context_binding' },
    propertyIdentity: 'property-1',
    coordinates: [6580000, 674000],
    geometry: { type: 'Point', coordinates: [674000, 6580000] },
  })),
}));
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({
  resolveCanonicalProductRelease: vi.fn(async () => ({
    artifact_id: 'product-release-1', artifact_type: 'product_release_manifest', release_hash: { value: 'a'.repeat(64) },
  })),
}));

import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
  createLocalizationGeometryArtifactV2,
  createLocalizationGeometrySupersessionArtifact,
  createLocalizationGeometrySupersessionIssuerArtifact,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import {
  attestLocalizationGeometrySupersessionArtifact,
  attestLocalizationGeometrySupersessionIssuerArtifact,
} from '../../server/modules/localization/localizationGeometrySupersessionAuthority';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';

const PROJECT_ID = 'proj-m1a-repair-usecase';
const PROPERTY_REF = { artifact_id: 'property-context-1', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const SITE = { id: 'site-a', name: 'Alternativ A', lat: 59.33, lng: 18.06 };
const supersessionKey = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-issuer-m1a-repair-usecase');

/** Real "Artifact not found" contract + per-artifact fault injection (see the F1/F2 service test). */
class CasRepository {
  readonly values = new Map<string, unknown>();
  readonly faults = new Map<string, unknown>();
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: { artifact_id: string }): Promise<T> {
    if (this.faults.has(reference.artifact_id)) throw this.faults.get(reference.artifact_id);
    if (!this.values.has(reference.artifact_id)) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return this.values.get(reference.artifact_id) as T;
  }
}

function userGeometry(northing: number): LocalizationGeometryArtifact {
  return createLocalizationGeometryArtifactV2({
    project_id: PROJECT_ID, property_context_ref: PROPERTY_REF,
    wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, northing],
    provenance: 'user_defined', label: `user point ${northing}`, created_by: 'user-usecase',
  });
}

/** A (superseded) -> B (current): both geometries plus a real signed edge in CAS and in the projections. */
async function movedPoint() {
  const repo = new CasRepository();
  const a = userGeometry(6580743.0);
  const b = userGeometry(6580843.0);
  for (const g of [a, b]) {
    await repo.put({ artifact_id: g.artifact_id, body: g });
    state.geometryRows.push({
      projectId: PROJECT_ID, geometryArtifactId: g.artifact_id,
      propertyContextRefId: PROPERTY_REF.artifact_id, propertyContextRefType: PROPERTY_REF.artifact_type, createdAt: new Date(),
    });
  }
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: supersessionKey.provider.keyId,
    owner_authority_ref: { artifact_id: 'owner-authority-m1a-repair', artifact_type: 'owner_authority_attestation' },
  });
  const issuer = { ...bareIssuer, attestation: await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing: supersessionKey.provider }) };
  await repo.put({ artifact_id: issuer.artifact_id, body: issuer });
  const bareEdge = createLocalizationGeometrySupersessionArtifact({
    contract_version: LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
    project_id: PROJECT_ID,
    predecessor_geometry_ref: { artifact_id: a.artifact_id, artifact_type: a.artifact_type },
    successor_geometry_ref: { artifact_id: b.artifact_id, artifact_type: b.artifact_type },
    reason_code: 'USER_LOCALIZATION_CHANGE_V1',
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: supersessionKey.provider.keyId,
    issued_at: '2026-10-02T00:00:00.000Z',
  });
  const edge = { ...bareEdge, attestation: await attestLocalizationGeometrySupersessionArtifact({ artifact: bareEdge, issuer, signing: supersessionKey.provider }) };
  await repo.put({ artifact_id: edge.artifact_id, body: edge });
  state.supersessionRows.push({
    projectId: PROJECT_ID, supersessionArtifactId: edge.artifact_id,
    predecessorGeometryArtifactId: a.artifact_id, successorGeometryArtifactId: b.artifact_id, createdAt: new Date(),
  });
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = supersessionKey.provider.keyId;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = supersessionKey.publicKey;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
  return { repo, a, b };
}

async function runReport(repo: CasRepository) {
  const runtime = {
    artifactRepository: repo,
    resolveSpatialProvider: vi.fn(() => ({ query: queryMock })),
    sweref99ToWgs84: vi.fn(async () => [59.33, 18.06] as const),
    close: vi.fn(async () => undefined),
  };
  return new GenerateLocalizationReportUseCase(async () => runtime as never).execute({ projectId: PROJECT_ID, siteAlternatives: [SITE] });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.geometryRows.length = 0;
  state.supersessionRows.length = 0;
  state.registerCalls = 0;
  // U20CDF3 (low 5): the provider answers every requested layer, as the real one does (silence is an
  // invalid outcome form in a fresh run and fails closed before the kernel; tested in the U20C/normal-form suites).
  queryMock.mockResolvedValue({
    evidence: ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'].map((layer) => ({
      artifact_id: `evidence-${layer}-tf`,
      artifact_type: 'SPATIAL_EVIDENCE',
      payload: { source_metadata: { dataset: layer }, result_semantics: { kind: 'EXISTENCE_WITHIN_DISTANCE', result: { exists: false, match_count_observed: 0 } } },
    })),
    unavailable_layers: [],
  });
  kernelMock.mockResolvedValue({
    admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1',
    findings: [], finding_ids: [], assessment: { artifact_id: 'assessment-1' },
  });
});

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('F1/F2 through generate-report with the real currentness provider', () => {
  it('control: A -> B, everything readable -> the run uses the current head B', async () => {
    const { repo, b } = await movedPoint();
    const analysis = (await runReport(repo)).siteAnalyses[0]!;
    expect(kernelMock).toHaveBeenCalledTimes(1);
    expect(analysis.executionMotor?.localization_geometry).toMatchObject({ status: 'RESOLVED', artifact_id: b.artifact_id });
  });

  it('transient CAS read failure on the current head B -> EXECUTION_FAILED / CURRENTNESS_RESOLUTION_ERROR; no spatial query, no kernel, no verdict, never the stale A', async () => {
    const { repo, a, b } = await movedPoint();
    repo.faults.set(b.artifact_id, Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' }));
    const report = await runReport(repo);
    const analysis = report.siteAnalyses[0]!;

    expect(analysis.executionMotor?.localization_geometry?.artifact_id ?? null).not.toBe(a.artifact_id);
    expect(queryMock).not.toHaveBeenCalled();
    expect(kernelMock).not.toHaveBeenCalled();
    expect(analysis.executionMotor).toMatchObject({
      admitted: false,
      assessment_artifact_id: null,
      assessment_status: 'EXECUTION_FAILED',
      reason_codes: ['LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED', 'LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR'],
      localization_geometry: {
        status: 'FAILED_CLOSED', artifact_id: null, provenance: null, derived_in_this_request: false,
        failure_class: 'CURRENTNESS_RESOLUTION_ERROR', reason_code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR',
      },
    });
    expect(analysis.executionMotor?.localization_geometry?.message_sv).toMatch(/tekniskt fel.*försök igen/);
    expect('overallRisk' in analysis.complianceAnalysis).toBe(false);
    expect('permitProbability' in analysis.complianceAnalysis).toBe(false);
    expect(state.registerCalls).toBe(0); // no centroid derived and registered in place of B
  });
});
