/**
 * U20-C (LU 72h; U20-U30 spec 1.4/1.5 K1; owner decisions DP-04 = yes, DP-10 = yes).
 *
 * The unbound reads -- the old local spatialAudit (U-1) and the live NVR / RAÄ / VISS / SLU
 * fetchers (U-2) -- must never steer the governed LU request:
 *   - strict gating (the former 503 after the governed assessment was already persisted to CAS),
 *   - the risk level / permit probability,
 *   - summary.reasoning (no "tillståndssannolikhet (NN%)", no legacy counts),
 *   - any field outside an explicit `legacyObservations` block marked `governed: false`.
 * DP-04: generate-report performs none of these reads at all. The older generate-pdf-data route,
 * the one existing consumer of those observations, gets them only in that labelled block.
 * No raw SQL / provider error strings in any HTTP body. A low risk level is never stated alone
 * while a governed check (in document v1: always the document check) did not complete
 * (K0 verification finding 1).
 *
 * Path under test: real router + requireAuth -> real localizationOrchestrator -> real
 * localizationReportService -> real GenerateLocalizationReportUseCase. Hermetic: server/db/prisma
 * is the throwing guard, the spatial runtime is an in-memory fake, the kernel is a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: vi.fn(async () => undefined) }));

const kernelMock = vi.fn();
const queryMock = vi.fn();
vi.mock('@miljobeslut/mps-lu', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LU_SPATIAL_CAPABILITY_KEY: 'lu.spatial',
  runCanonicalLuProductAssessment: (...args: unknown[]) => kernelMock(...args),
  deriveLuExecutionSeed: vi.fn(() => 'canonical-seed'),
  createLuRegistryRuntime: vi.fn(() => ({ getReleaseSnapshot: () => ({ snapshot_id: 'lu-registry-snapshot-test' }) })),
}));
vi.mock('../../server/modules/localization/createLocalizationSpatialRuntime', () => ({
  createLocalizationSpatialRuntime: vi.fn(async () => ({
    artifactRepository: {
      put: vi.fn(async () => undefined),
      resolve: vi.fn(async (ref: { artifact_id: string }) => { throw new Error(`Artifact not found: ${ref.artifact_id}`); }),
    },
    resolveSpatialProvider: vi.fn(() => ({ query: queryMock })),
    sweref99ToWgs84: vi.fn(async () => [59.33, 18.06] as const),
    close: vi.fn(async () => undefined),
  })),
}));
vi.mock('../../src/application/enqueue-lu-execution-ticket', () => ({ enqueueAdmittedLuTicket: vi.fn(async () => 'ticket-1') }));
vi.mock('../../server/modules/localization/assessmentProjection', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerAssessmentProjection: vi.fn(async () => undefined),
}));
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
vi.mock('../../server/modules/localization/localizationGeometryService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveOrDeriveCurrentLocalizationGeometry: vi.fn(async () => ({
    geometry: { artifact_id: 'localization-geometry-1', artifact_type: 'localization_geometry', payload: { provenance: 'user_defined' } },
    wasDerived: false,
  })),
}));

// ---- the unbound reads (U-1, U-2) and the legacy rule engine: spies with switchable state ----
const legacy = vi.hoisted(() => ({ down: true }));
const RAW_SQL_PROTECTED = 'Skyddad natur kunde inte verifieras i lokal databas: column "nvr_id" does not exist (42703)';
const RAW_SQL_WATER = 'Kunde inte beräkna avstånd: relation "topo10.vatten" does not exist (42P01)';
const RAW_SQL_SGU = 'SGU-fel: column "jy1" does not exist';
const RAW_NVR = 'NVR upstream 502 Bad Gateway <html>nginx</html>';
const RAW_RAA = 'getaddrinfo ENOTFOUND kulturarvsdata.se';
vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: vi.fn(async () =>
    legacy.down
      ? {
          protectedAreaHits: [], protectedAreaAvailable: false, protectedAreaWarning: RAW_SQL_PROTECTED, isProtected: false,
          sgu: { manualReviewRequired: true, summary: RAW_SQL_SGU },
          distanceToWaterMeters: null, distanceToWaterAvailable: false, distanceToWaterWarning: RAW_SQL_WATER,
        }
      : {
          protectedAreaHits: [{ name: 'Testreservatet' }], protectedAreaAvailable: true, isProtected: true,
          sgu: { manualReviewRequired: false, summary: 'SGU-risk: låg' },
          distanceToWaterMeters: 40, distanceToWaterAvailable: true,
        },
  ),
}));
vi.mock('../../server/services/nvrService', () => ({
  fetchProtectedAreas: vi.fn(async () => {
    if (legacy.down) throw new Error(RAW_NVR);
    return [{ name: 'Testreservatet', type: 'Naturreservat' }];
  }),
}));
vi.mock('../../server/services/raaService', () => ({
  fetchAncientMonuments: vi.fn(async () => {
    if (legacy.down) throw new Error(RAW_RAA);
    return [{ name: 'Fornlämning 1' }, { name: 'Fornlämning 2' }, { name: 'Fornlämning 3' }];
  }),
}));
vi.mock('../../server/services/vissService', () => ({
  queryVissPoint: vi.fn(async () => ({ ok: true, primaryWaterStatus: { waterName: 'Testsjön' } })),
}));
vi.mock('../../server/services/sluService', () => ({
  searchSluByCoordinates: vi.fn(async () => ({ observations: [{ taxonName: 'Rana arvalis' }, { taxonName: 'Bufo bufo' }] })),
  getSpeciesInformation: vi.fn(async () => null),
}));
vi.mock('../../server/services/sguRiskService', () => ({ toGeologicalData: vi.fn(() => ({})) }));
vi.mock('../../server/services/complianceRuleEngine', () => ({
  // The legacy engine says HIGH / 0.1. If it could steer anything, the governed LOW below would move.
  evaluateComplianceRules: vi.fn(() => ({
    overallRisk: 'HIGH', permitProbability: 0.1,
    restrictions: ['Äldre regelmotor: skyddat område (test)'],
    rules: [{ ruleId: 'MB-7-LEGACY', chapter: '7', title: 'Legacy', risk: 'HIGH', description: 'd', recommendation: 'r' }],
    summary: 'legacy HIGH',
  })),
}));
vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: { logAction: vi.fn(async () => ({ id: 'audit-1' })) },
  getAuditTrail: vi.fn(async () => []),
}));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import express from 'express';
import request from 'supertest';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import { runSpatialAudit } from '../../server/services/spatialAuditService';
import { fetchProtectedAreas } from '../../server/services/nvrService';
import { fetchAncientMonuments } from '../../server/services/raaService';
import { queryVissPoint } from '../../server/services/vissService';
import { searchSluByCoordinates } from '../../server/services/sluService';
import { evaluateComplianceRules } from '../../server/services/complianceRuleEngine';
import { auditTrail } from '../../server/services/auditTrailService';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
const SPATIAL_REFS = LAYERS.map((layer) => ({ artifact_id: `evidence-${layer}-u20c`, artifact_type: 'SPATIAL_EVIDENCE' }));

function spatialEvidence(layer: string) {
  return {
    artifact_id: `evidence-${layer}-u20c`,
    artifact_type: 'SPATIAL_EVIDENCE',
    payload: {
      source_metadata: { dataset: layer },
      result_semantics: { kind: 'EXISTENCE_WITHIN_DISTANCE', result: { exists: false, match_count_observed: 0, max_features_per_layer: 50 } },
    },
  };
}

const app = express();
app.use(express.json());
app.use(localizationRoutes);
const token = createTokenPair({ id: 'user-u20c', organisationId: 'org-u20c', bankidId: 'bankid:u20c', role: 'ADMIN' }).accessToken;
const BODY = { projectId: 'proj-u20c', siteAlternatives: [{ id: 'ALT-1', name: 'Plats A', lat: 59.33, lng: 18.06 }] };

/** Strings that only the unbound reads can produce: raw SQL errors and raw provider failures. */
const RAW_ERROR_FRAGMENTS = ['does not exist', 'nvr_id', 'topo10', 'jy1', '42703', '42P01', 'ENOTFOUND', 'Bad Gateway', 'nginx'];
const INCOMPLETE = 'Låg risk i de kontroller som utfördes; underlaget är ofullständigt: 5 av 6 kontroller genomförda.';

async function post(path: string) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`).send(BODY);
}

beforeEach(() => {
  vi.clearAllMocks();
  hermeticPrismaTouches.length = 0;
  legacy.down = true;
  process.env.APP_ENV = 'staging'; // strict mode
  process.env.SLU_SPECIES_OBS_API_KEY = 'test-key'; // SLU "up": exactly two external sources down
  queryMock.mockResolvedValue({ evidence: LAYERS.map(spatialEvidence), unavailable_layers: [] });
  kernelMock.mockResolvedValue({
    admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1',
    findings: [], finding_ids: [],
    assessment: { artifact_id: 'assessment-u20c', payload: { evidence_refs: SPATIAL_REFS, findings: [] } },
  });
});

afterEach(() => {
  delete process.env.APP_ENV;
  delete process.env.SLU_SPECIES_OBS_API_KEY;
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('U20-C: unbound reads never steer the governed generate-report request', () => {
  it('strict mode, spatialAudit down and two external sources down -> still HTTP 200 and ASSESSED', async () => {
    const res = await post('/api/localization/generate-report');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.meta.strictMode).toBe(true);
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor.assessment_status).toBe('ASSESSED');
    expect(site.executionMotor.assessment_artifact_id).toBe('assessment-u20c');
    // The governed verdict, unchanged machine values: no findings -> LOW / 0.95, never the legacy HIGH / 0.1.
    expect(site.complianceAnalysis.overallRisk).toBe('LOW');
    expect(site.complianceAnalysis.permitProbability).toBe(0.95);
    expect(site.complianceAnalysis.unresolvedChecks).toEqual([]);
  });

  it('DP-04: the governed request performs no unbound read and carries no legacy field at all', async () => {
    const res = await post('/api/localization/generate-report');

    for (const spy of [runSpatialAudit, fetchProtectedAreas, fetchAncientMonuments, queryVissPoint, searchSluByCoordinates, evaluateComplianceRules]) {
      expect(spy).not.toHaveBeenCalled();
    }
    const site = res.body.siteAnalyses[0];
    for (const key of ['spatialAudit', 'spatialAuditProvenance', 'monuments', 'vissWaterStatus', 'distanceToWaterMeters', 'dataSources', 'sluObservationCount', 'legacyObservations']) {
      expect(Object.keys(site)).not.toContain(key);
    }
    expect(site.complianceAnalysis.restrictions).toEqual([]);
    expect(site.complianceAnalysis.rules).toEqual([]);
    expect(site.complianceAnalysis.legacyObservation).toBeUndefined();
    expect(site.warnings).toEqual([]);
  });

  it('DP-10: the reasoning has no percentage and no legacy count; low risk is never stated alone', async () => {
    const res = await post('/api/localization/generate-report');
    const reasoning: string = res.body.summary.reasoning;
    const summary: string = res.body.siteAnalyses[0].complianceAnalysis.summary;

    expect(reasoning).not.toMatch(/%|tillståndssannolikhet|kulturmiljö|SLU|fornl/i);
    expect(reasoning).toContain('ALT-1');
    // K0 verification finding 1 / OD-K0-1: the document check is NOT_CHECKED, so "low" carries the
    // owner-approved qualification (N = completed checks, M = all checks).
    for (const text of [reasoning, summary]) {
      expect(text).toContain(INCOMPLETE);
      expect(text).not.toMatch(/establish LOW risk/);
    }
    // The machine-readable level and score did NOT change (presentation only).
    expect(res.body.siteAnalyses[0].complianceAnalysis.overallRisk).toBe('LOW');
    expect(res.body.siteAnalyses[0].complianceAnalysis.permitProbability).toBe(0.95);
  });

  it.each([['strict (APP_ENV=staging)', 'staging'], ['non-strict', '']])(
    'no raw SQL or provider error string anywhere in the generate-report body (%s)',
    async (_label, appEnv) => {
      if (appEnv) process.env.APP_ENV = appEnv;
      else delete process.env.APP_ENV;
      const res = await post('/api/localization/generate-report');
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const fragment of RAW_ERROR_FRAGMENTS) expect(text).not.toContain(fragment);
    },
  );

  it('legacy sources up vs down: byte-identical governed result, reasoning and warnings', async () => {
    legacy.down = true;
    const down = (await post('/api/localization/generate-report')).body;
    legacy.down = false;
    const up = (await post('/api/localization/generate-report')).body;

    const governed = (body: typeof down) => ({
      complianceAnalysis: body.siteAnalyses[0].complianceAnalysis,
      executionMotor: body.siteAnalyses[0].executionMotor,
      warnings: body.siteAnalyses[0].warnings,
      summary: body.summary,
      reportWarnings: body.warnings,
    });
    expect(governed(up)).toEqual(governed(down));
  });

  it('the audit-log description qualifies the risk; the machine values in its details are unchanged', async () => {
    await post('/api/localization/generate-report');
    const call = vi.mocked(auditTrail.logAction).mock.calls[0]!;
    const description = String(call[5]);
    const details = (call[6] as { details: Record<string, unknown> }).details;

    expect(description).toContain(INCOMPLETE);
    expect(description).not.toMatch(/%|tillståndssannolikhet/);
    expect(details.overallRisk).toBe('LOW');
    expect(details.bestPermitProbability).toBe(0.95);
    expect(details.bestCheckCoverage).toEqual({
      checks_total: 6, checks_completed: 5, checks_not_completed: 1, not_completed_layers: ['document'],
    });
  });

  it('a kernel error is reported without its raw database text; a governed REJECT_* code is kept', async () => {
    kernelMock.mockRejectedValueOnce(new Error('Invalid `prisma.$queryRaw()` invocation: column "x" does not exist'));
    const raw = (await post('/api/localization/generate-report')).body;
    expect(raw.siteAnalyses[0].executionMotor.assessment_status).toBe('EXECUTION_FAILED');
    expect(raw.siteAnalyses[0].warnings).toEqual(['ExecutionKernel error: tekniskt fel (detaljer finns i serverloggen)']);
    expect(JSON.stringify(raw)).not.toMatch(/does not exist|queryRaw/);

    kernelMock.mockRejectedValueOnce(new Error('REJECT_SPATIAL_PROVIDER: missing canonical binding'));
    const coded = (await post('/api/localization/generate-report')).body;
    expect(coded.siteAnalyses[0].warnings).toEqual(['ExecutionKernel error: REJECT_SPATIAL_PROVIDER: missing canonical binding']);
  });
});

describe('U20CDF (U20CD verification F2): no check completed -> no risk level in any text', () => {
  // 0 of 6: the provider returned no evidence for any layer and the document check is NOT_CHECKED.
  // The machine verdict is unchanged (no findings -> LOW / 0.95), but no text may say "Låg risk".
  // Owner wording (2026-10-02): the word "låg risk" must not occur at all.
  const NONE_COMPLETED = 'Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.';
  beforeEach(() => {
    queryMock.mockResolvedValue({ evidence: [], unavailable_layers: [] });
  });

  it('generate-report: summary, reasoning and the audit description state that no assessment can be made', async () => {
    const res = await post('/api/localization/generate-report');
    expect(res.status).toBe(200);
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor.governed_layer_checks.map((c: { status: string }) => c.status)).toEqual(
      Array(6).fill('NOT_CHECKED'),
    );
    const description = String(vi.mocked(auditTrail.logAction).mock.calls[0]![5]);
    for (const text of [site.complianceAnalysis.summary, res.body.summary.reasoning, description]) {
      expect(text).toContain(NONE_COMPLETED);
      expect(text).not.toMatch(/låg risk|måttlig risk|hög risk|i de kontroller som utfördes/i);
    }
    // Presentation only: the machine-readable values are exactly as before.
    expect(site.complianceAnalysis.overallRisk).toBe('LOW');
    expect(site.complianceAnalysis.permitProbability).toBe(0.95);
    const details = (vi.mocked(auditTrail.logAction).mock.calls[0]![6] as { details: Record<string, unknown> }).details;
    expect(details.overallRisk).toBe('LOW');
    expect(details.bestCheckCoverage).toEqual({
      checks_total: 6, checks_completed: 0, checks_not_completed: 6,
      not_completed_layers: [...LAYERS, 'document'],
    });
  });

  it('generate-pdf-data: overall_statement_sv and the reasoning say the same, never "Låg risk"', async () => {
    const res = await post('/api/localization/generate-pdf-data');
    expect(res.status).toBe(200);
    const site = res.body.pdfData.sites[0];
    expect(site.overall_statement_sv).toBe(NONE_COMPLETED);
    expect(res.body.pdfData.summary.reasoning).toContain(NONE_COMPLETED);
    expect(JSON.stringify([site.overall_statement_sv, res.body.pdfData.summary.reasoning])).not.toMatch(/låg risk/i);
    expect(site.overallRisk).toBe('LOW');
  });
});

describe('U20-C: the older generate-pdf-data route -- legacy only in a labelled, ungoverned block', () => {
  it('strict mode with the same outage -> HTTP 200; no gating, no raw errors, governed document check present', async () => {
    const res = await post('/api/localization/generate-pdf-data');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const text = JSON.stringify(res.body);
    for (const fragment of RAW_ERROR_FRAGMENTS) expect(text).not.toContain(fragment);

    const pdf = res.body.pdfData;
    // The route says in its own answer that the legacy part is not governed.
    expect(pdf.governance_note_sv).toMatch(/inte är styrd evidens/);
    const site = pdf.sites[0];
    expect(site.assessment_status).toBe('ASSESSED');
    expect(site.overallRisk).toBe('LOW');
    expect(site.overall_statement_sv).toContain(INCOMPLETE);
    // The governed checks, document check included (K0), reach this route too.
    expect(site.governed_layer_checks.map((c: { layer: string }) => c.layer)).toEqual([...LAYERS, 'document']);
    expect(site.governed_layer_checks.at(-1)).toMatchObject({ layer: 'document', status: 'NOT_CHECKED' });
    // The legacy observations are still available to this route, labelled and sanitized.
    expect(site.legacyObservationLabel).toMatch(/ej del av den styrda bedömningen/);
    const nvr = site.dataSources.find((d: { source: string }) => d.source === 'NVR API');
    expect(nvr).toMatchObject({ status: 'unavailable' });
    expect(fetchProtectedAreas).toHaveBeenCalledTimes(1);
  });

  it('the summary reasoning in the legacy PDF data carries the same qualification and no percentage', async () => {
    const res = await post('/api/localization/generate-pdf-data');
    expect(res.body.pdfData.summary.reasoning).toContain(INCOMPLETE);
    expect(res.body.pdfData.summary.reasoning).not.toMatch(/%|tillståndssannolikhet/);
  });
});
