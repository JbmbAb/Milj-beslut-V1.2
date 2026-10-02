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
import { redactInternalDiagnostic, sanitizeGovernedErrorMessage } from '../../src/application/generate-localization-report.usecase';
import { logger } from '../../server/logger';
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
      // U20CDF (F6): this fixture's evidence names no ADMIT dataset version -> no known gaps.
      checks_completed_with_limited_coverage: 0, limited_coverage_layers: [],
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
    // U20CDF (F7): only the governed code itself, never the free text after it.
    expect(coded.siteAnalyses[0].warnings).toEqual(['ExecutionKernel error: REJECT_SPATIAL_PROVIDER']);
  });

  // U20CDF3 (U20CDF2 verification H4 / low 2): evidence for a dataset that was not requested -- an
  // unknown layer or a mis-cased governed one -- used to pass the gate and add a seventh row ("6 av 7",
  // "Låg risk"). It now fails the run closed with a typed class; the provider's string is not echoed.
  it.each([['flood'], ['WATER']])('U20CDF3 (low 2): evidence for "%s" (not a requested layer) fails the run closed, never a seventh row', async (dataset) => {
    const outside = {
      artifact_id: 'evidence-outside-u20c',
      artifact_type: 'SPATIAL_EVIDENCE',
      payload: {
        source_metadata: { dataset },
        result_semantics: { kind: 'EXISTENCE_WITHIN_DISTANCE', result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 } },
      },
    };
    queryMock.mockResolvedValue({ evidence: [...LAYERS.map(spatialEvidence), outside], unavailable_layers: [] });
    const res = await post('/api/localization/generate-report');
    expect(res.status).toBe(200);
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor).toMatchObject({
      admitted: false, assessment_status: 'EXECUTION_FAILED', assessment_artifact_id: null,
      reason_codes: ['REJECT_SPATIAL_EVIDENCE_FORM', 'DATASET_NOT_REQUESTED'],
    });
    expect(site.executionMotor.governed_layer_checks).toBeUndefined();
    expect(kernelMock).not.toHaveBeenCalled();
    expect(site.warnings).toEqual([
      'Spatialt underlag avvisat: svaret gäller ett lager som inte efterfrågades (REJECT_SPATIAL_EVIDENCE_FORM: DATASET_NOT_REQUESTED). ' +
        'Ingen bedömning gjordes; regelmotorn nåddes aldrig.',
    ]);
    expect(JSON.stringify(res.body)).not.toContain(dataset);
    expect(JSON.stringify(res.body)).not.toMatch(/6 av 7|låg risk/i);
  });

  it.each<[string, string]>([
    ['REJECT_SPATIAL_PROVIDER: missing canonical binding', 'REJECT_SPATIAL_PROVIDER'],
    ['REJECT_CAS_READ: C:/data/cas/objects/ab/cd could not be opened', 'REJECT_CAS_READ'],
    ['LU_CONFIG_INVALID: password authentication failed for user "mimer"', 'LU_CONFIG_INVALID'],
    ['LU_KERNEL_DENIED', 'LU_KERNEL_DENIED'],
    ['ERROR: password authentication failed for user "postgres"', 'tekniskt fel (detaljer finns i serverloggen)'],
    ['ENOENT: no such file or directory, open "D:/data/key.pem"', 'tekniskt fel (detaljer finns i serverloggen)'],
    ['CASIntegrityError: digest mismatch', 'tekniskt fel (detaljer finns i serverloggen)'],
    ['reject_lowercase: x', 'tekniskt fel (detaljer finns i serverloggen)'],
    ['REJECTED_BY_SOMETHING: x', 'tekniskt fel (detaljer finns i serverloggen)'],
    ['', 'tekniskt fel (detaljer finns i serverloggen)'],
  ])('U20CDF (F7): sanitizeGovernedErrorMessage is an allowlist -- %j -> %j', (message, expected) => {
    expect(sanitizeGovernedErrorMessage(message)).toBe(expected);
  });
});

describe('U20CDF (U30-R2 follow-up): the raw diagnostic of a failed layer query is logged internally, redacted, and goes nowhere else', () => {
  const DIAGNOSTIC =
    'PrismaClientKnownRequestError: connect ECONNREFUSED postgresql://mimer:hemligt-losen@10.0.0.5:5432/lu ' +
    '(relation "env.protected_area" does not exist) password=hemligt2 Authorization: Bearer abc.def.ghi';

  it('logged as structured internal diagnostics with secrets redacted; never in the HTTP body, warnings or the kernel input', async () => {
    queryMock.mockResolvedValue({
      evidence: LAYERS.filter((l) => l !== 'protected_area').map(spatialEvidence),
      unavailable_layers: [{ dataset: 'protected_area', reason: 'SOURCE_UNAVAILABLE', diagnostic: DIAGNOSTIC }],
    });
    const res = await post('/api/localization/generate-report');
    expect(res.status).toBe(200);

    const call = vi.mocked(logger.warn).mock.calls.find((c) => c[0] === 'Governed LU layer query failed (internal diagnostic)');
    expect(call, 'the diagnostic must be logged').toBeDefined();
    const meta = call![1] as Record<string, unknown>;
    expect(meta).toMatchObject({ site: 'ALT-1', layer: 'protected_area', reason: 'SOURCE_UNAVAILABLE' });
    expect(meta.diagnostic).toContain('ECONNREFUSED');
    expect(meta.diagnostic).toContain('relation "env.protected_area" does not exist');
    expect(String(meta.diagnostic)).not.toMatch(/hemligt|abc\.def\.ghi/);

    // Nowhere else: not in the answer, not in a warning, not handed to the kernel.
    const body = JSON.stringify(res.body);
    for (const fragment of ['ECONNREFUSED', 'hemligt', 'PrismaClientKnownRequestError', 'does not exist']) {
      expect(body).not.toContain(fragment);
    }
    const kernelInput = kernelMock.mock.calls[0]![0] as { unavailable_layers: unknown[] };
    expect(kernelInput.unavailable_layers).toEqual([{ dataset: 'protected_area', reason: 'SOURCE_UNAVAILABLE' }]);
  });

  it('redactInternalDiagnostic: credentials, key=value secrets and bearer tokens are masked; null for nothing', () => {
    expect(redactInternalDiagnostic('postgres://u:p@h/db x')).toBe('postgres://***@h/db x');
    expect(redactInternalDiagnostic('token: abc123 api_key=xyz secret="s p"')).toBe('token: *** api_key=*** secret=***');
    expect(redactInternalDiagnostic('Bearer eyJhbGciOi.x.y rest')).toBe('Bearer *** rest');
    expect(redactInternalDiagnostic('x'.repeat(5000))!.length).toBe(1000);
    expect(redactInternalDiagnostic(undefined)).toBeNull();
    expect(redactInternalDiagnostic('')).toBeNull();
  });

  // U20CDF2 (U20CDF verification G4 / owner: rich internal logging, never a leaked secret). The
  // verifier's probe R1 found four forms that leaked; these and their relatives. All values invented.
  it.each<[string, string, readonly string[], readonly string[]]>([
    ['URI password containing @ (probe R1)', 'connect ECONNREFUSED postgresql://mimer:ke@ke@10.0.0.5:5432/lu', ['ke@ke', 'mimer:'], ['ECONNREFUSED', '10.0.0.5:5432/lu']],
    ['URI password containing / (probe R1)', 'postgres://mimer:pa/ss/word@db.local/lu failed', ['pa/ss', 'ss/word'], ['db.local/lu failed']],
    ['URI password %-encoded', 'postgresql://mimer:p%40ss%2Fw0rd@host:5432/db', ['p%40ss', '%2Fw0rd'], ['host:5432/db']],
    ['URI with a token as user', 'fetch https://ghp_FAKE0TOKEN0VALUE@github.com/org/repo failed', ['ghp_FAKE0TOKEN0VALUE'], ['github.com/org/repo failed']],
    ['PGPASSWORD (probe R1)', 'env PGPASSWORD=hemligt1 psql -h x', ['hemligt1'], ['PGPASSWORD=', 'psql -h x']],
    ['other env forms', 'DB_PASSWORD: hemligt2 MIMERS_API_TOKEN=tok-abc AWS_SECRET_ACCESS_KEY=Zsecretvalue', ['hemligt2', 'tok-abc', 'Zsecretvalue'], ['DB_PASSWORD', 'MIMERS_API_TOKEN']],
    ['JSON "password" (probe R1)', '{"user":"mimer","password":"hemligt3","host":"h"}', ['hemligt3'], ['"user":"mimer"', '"host":"h"']],
    ['JSON passwd/pwd/secret/token/apikey/client_secret', '{"passwd":"a1x","pwd":"a2x","secret":"a3x","token":"a4x","apiKey":"a5x","api_key":"a6x","client_secret":"a7x"}', ['a1x', 'a2x', 'a3x', 'a4x', 'a5x', 'a6x', 'a7x'], []],
    ['JSON with spaces and a space in the value', '{ "password" : "hem ligt4" }', ['hem ligt4', 'ligt4'], []],
    ['single-quoted fields', "{'password': 'hemligt5', 'secret':'s5x'}", ['hemligt5', 's5x'], []],
    ['libpq connection string', "host=10.0.0.5 user=mimer password='hem ligt7' dbname=lu", ['hem ligt7', 'ligt7'], ['host=10.0.0.5', 'dbname=lu']],
    ['Authorization: Basic', 'Authorization: Basic dXNlcjpwYXNzd29yZA== next', ['dXNlcjpwYXNzd29yZA'], ['next']],
    ['Authorization with another scheme, and Proxy-Authorization', 'Authorization: Token t0k3nv4lue and Proxy-Authorization: Negotiate YIIneg0tiate end', ['t0k3nv4lue', 'YIIneg0tiate'], ['and', 'end']],
    ['authorization=Bearer', 'authorization=Bearer abc.def.ghi rest', ['abc.def.ghi'], ['rest']],
    ['a bare JWT', 'got eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl back', ['eyJzdWIiOiIxIn0', 'c2lnbmF0dXJl'], ['got', 'back']],
    ['CLI flags', 'psql --password hemligt6 --token=t6x -h x', ['hemligt6', 't6x'], ['-h x']],
    ['query string key', 'GET https://api.example/x?api_key=k123&x=1', ['k123'], ['https://api.example/x?']],
    ['PEM private key', 'key -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY----- end', ['MIIEvQIBADANBg'], ['end']],
  ])('redactInternalDiagnostic: %s', (_label, text, secrets, kept) => {
    const redacted = redactInternalDiagnostic(text)!;
    for (const secret of secrets) expect(redacted, redacted).not.toContain(secret);
    for (const fragment of kept) expect(redacted, redacted).toContain(fragment);
    expect(redacted).toContain('***');
  });
});

describe('U20CDF (U20CD verification F2): no check completed -> no risk level in any text', () => {
  // 0 of 6: every layer's governed query failed and the document check is NOT_CHECKED.
  // Owner wording (2026-10-02): the word "låg risk" must not occur at all.
  // U20CDF2 (G1): the provider now reports each layer as unavailable and the kernel returns the rule
  // engine's NOT_CHECKED finding for each -- a current record that accounts for every layer, so "0 av
  // 6" is the established count. (Before, the provider said nothing about any layer: a record whose
  // coverage cannot be established, which is never presented as "0 av 6" -- see the last case.)
  const NONE_COMPLETED = 'Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.';
  const NOT_CHECKED_FINDINGS = LAYERS.map((layer, i) => ({
    finding_id: `finding-notchecked-${layer}`,
    rule_id: ['LU-WATER-001', 'LU-EBH-001', 'LU-PROTECTED-001', 'LU-NATURA2000-001', 'LU-WATERPROTECTION-001'][i]!,
    rule_version: '2.0', risk_level: 'NOT_CHECKED',
    explanation: `Lagret "${layer}" kunde inte kontrolleras: källan kunde inte frågas vid bedömningen. Ej kontrollerbart - underlag saknas.`,
    evidence_refs: [],
  }));
  beforeEach(() => {
    queryMock.mockResolvedValue({ evidence: [], unavailable_layers: LAYERS.map((dataset) => ({ dataset, reason: 'SOURCE_UNAVAILABLE' })) });
    kernelMock.mockResolvedValue({
      admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1',
      findings: NOT_CHECKED_FINDINGS, finding_ids: NOT_CHECKED_FINDINGS.map((f) => f.finding_id),
      assessment: { artifact_id: 'assessment-u20c', payload: { evidence_refs: [], findings: NOT_CHECKED_FINDINGS } },
    });
  });

  // U20CDF2: with the record a current run writes, NOT_CHECKED findings withhold permitProbability
  // (SEM-1 / K-35 M5), so the site is not ranked. No text may name a risk level.
  // U20CDF3 (U20CDF2 verification H2): the reasoning used to say "inget av 1 alternativ har en governad
  // bedömning (LocalizationAssessmentArtifact saknas)" -- false: the site IS assessed and HAS the
  // artifact. It now says what is true: assessed, not ranked, incomplete, no probability, and the
  // assessment's own coverage statement (0 of 6 here, so no risk level at all).
  it('generate-report: the summary states that no assessment can be made; no text names a risk level', async () => {
    const res = await post('/api/localization/generate-report');
    expect(res.status).toBe(200);
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor.governed_layer_checks.map((c: { status: string }) => c.status)).toEqual(
      Array(6).fill('NOT_CHECKED'),
    );
    expect(site.complianceAnalysis.summary).toBe(NONE_COMPLETED);
    expect(site.executionMotor.assessment_status).toBe('ASSESSED');
    expect(site.executionMotor.assessment_artifact_id).toBe('assessment-u20c');
    expect(res.body.summary.reasoning).toBe(
      'Ingen rangordning tillgänglig: inget av 1 alternativ kan rangordnas. ' +
        'Alternativ ALT-1 (Plats A) har en styrd bedömning men rangordnas inte: bedömningen är ofullständig ' +
        '(minst en styrd kontroll kunde inte genomföras) och ingen sannolikhet anges för den. ' +
        `Bedömningens sammanfattning: ${NONE_COMPLETED}`,
    );
    // Never the false absence claim for an assessed site.
    expect(res.body.summary.reasoning).not.toMatch(/saknas|ingen styrd bedömning|utan styrd bedömning|har en governad bedömning/i);
    const description = String(vi.mocked(auditTrail.logAction).mock.calls[0]![5]);
    for (const text of [site.complianceAnalysis.summary, res.body.summary.reasoning, description]) {
      expect(text).not.toMatch(/låg risk|måttlig risk|hög risk|i de kontroller som utfördes/i);
    }
    // Presentation only: the machine-readable values are the governed verdict's (NOT_CHECKED findings ->
    // LOW with permitProbability withheld, SEM-1 / K-35 M5).
    expect(site.complianceAnalysis.overallRisk).toBe('LOW');
    expect(site.complianceAnalysis.permitProbability).toBeNull();
    expect(site.complianceAnalysis.unresolvedChecks).toHaveLength(5);
    expect(site.executionMotor.governed_coverage_state).toBe('DETERMINED');
    expect(site.executionMotor.governed_coverage_basis).toEqual([]);
    const details = (vi.mocked(auditTrail.logAction).mock.calls[0]![6] as { details: Record<string, unknown> }).details;
    // Not ranked -> audited by status only (RED-8): no risk, no coverage, no probability for it.
    for (const key of ['overallRisk', 'bestCoverageState', 'bestCheckCoverage', 'bestPermitProbability']) {
      expect(Object.prototype.hasOwnProperty.call(details, key)).toBe(false);
    }
  });

  it('U20CDF3 (H2): a PARTIAL comparison never calls an assessed but unranked site "ej bedömd"', async () => {
    // ALT-1: every layer answered negative, no finding -> ranked. ALT-2: every layer unavailable, the
    // rule engine's NOT_CHECKED finding for each -> assessed, probability withheld, not ranked.
    // The provider is called once per site, in site order (same construction as P3's kernelPerSite).
    queryMock
      .mockResolvedValueOnce({ evidence: LAYERS.map(spatialEvidence), unavailable_layers: [] })
      .mockResolvedValueOnce({ evidence: [], unavailable_layers: LAYERS.map((dataset) => ({ dataset, reason: 'SOURCE_UNAVAILABLE' })) });
    kernelMock.mockImplementation(async (input: { assessment_draft: { site_id: string } }) =>
      input.assessment_draft.site_id === 'ALT-1'
        ? {
            admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1', findings: [], finding_ids: [],
            assessment: { artifact_id: 'assessment-alt-1', payload: { evidence_refs: SPATIAL_REFS, findings: [] } },
          }
        : {
            admitted: true, reason_codes: [], attempt_id: 'a2', outcome_id: 'o2', manifest_id: 'm2',
            findings: NOT_CHECKED_FINDINGS, finding_ids: NOT_CHECKED_FINDINGS.map((f) => f.finding_id),
            assessment: { artifact_id: 'assessment-alt-2', payload: { evidence_refs: [], findings: NOT_CHECKED_FINDINGS } },
          },
    );
    const res = await request(app)
      .post('/api/localization/generate-report')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, siteAlternatives: [...BODY.siteAlternatives, { id: 'ALT-2', name: 'Plats B', lat: 59.34, lng: 18.07 }] });
    expect(res.status).toBe(200);
    const [alt1, alt2] = res.body.siteAnalyses;
    expect(alt2.executionMotor.assessment_status).toBe('ASSESSED');
    expect(alt2.executionMotor.assessment_artifact_id).toBe('assessment-alt-2');
    expect(res.body.summary.comparison_status).toBe('PARTIAL');
    expect(res.body.summary.bestAlternativeId).toBe('ALT-1');
    expect(res.body.summary.reasoning).toBe(
      'Alternativ ALT-1 (Plats A) rangordnas först bland de rangordnade alternativen enligt de styrda fynden. ' +
        `${alt1.complianceAnalysis.summary} ` +
        'Jämförelsen är partiell: 1 av 2 alternativ ingår i rangordningen. ' +
        'Alternativ ALT-2 (Plats B) har en styrd bedömning men rangordnas inte: bedömningen är ofullständig ' +
        '(minst en styrd kontroll kunde inte genomföras) och ingen sannolikhet anges för den. ' +
        `Bedömningens sammanfattning: ${NONE_COMPLETED}`,
    );
    expect(alt1.complianceAnalysis.summary).toBe(INCOMPLETE);
    expect(res.body.summary.reasoning).not.toMatch(/Ej bedömda|har en governad bedömning|saknas/i);
  });

  it('U20CDF3 (H2): an assessed-but-unranked site and a site without an assessment are told apart', async () => {
    queryMock.mockResolvedValue({ evidence: [], unavailable_layers: LAYERS.map((dataset) => ({ dataset, reason: 'SOURCE_UNAVAILABLE' })) });
    kernelMock.mockImplementation(async (input: { assessment_draft: { site_id: string } }) => {
      if (input.assessment_draft.site_id === 'ALT-2') throw new Error('kernel exploded');
      return {
        admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1',
        findings: NOT_CHECKED_FINDINGS, finding_ids: NOT_CHECKED_FINDINGS.map((f) => f.finding_id),
        assessment: { artifact_id: 'assessment-u20c', payload: { evidence_refs: [], findings: NOT_CHECKED_FINDINGS } },
      };
    });
    const res = await request(app)
      .post('/api/localization/generate-report')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, siteAlternatives: [...BODY.siteAlternatives, { id: 'ALT-2', name: 'Plats B', lat: 59.34, lng: 18.07 }] });
    expect(res.status).toBe(200);
    expect(res.body.siteAnalyses.map((a: { executionMotor: { assessment_status: string } }) => a.executionMotor.assessment_status)).toEqual([
      'ASSESSED', 'EXECUTION_FAILED',
    ]);
    expect(res.body.summary.comparison_status).toBe('UNAVAILABLE');
    expect(res.body.summary.reasoning).toBe(
      'Ingen rangordning tillgänglig: inget av 2 alternativ kan rangordnas. ' +
        'Alternativ ALT-1 (Plats A) har en styrd bedömning men rangordnas inte: bedömningen är ofullständig ' +
        '(minst en styrd kontroll kunde inte genomföras) och ingen sannolikhet anges för den. ' +
        `Bedömningens sammanfattning: ${NONE_COMPLETED} ` +
        'Alternativ utan styrd bedömning ingår inte i rangordningen: ALT-2.',
    );
    expect(res.body.summary.reasoning).not.toMatch(/låg risk|måttlig risk|hög risk|saknas/i);
  });

  it('generate-pdf-data: overall_statement_sv says no assessment can be made, with its coverage state; never "Låg risk"', async () => {
    const res = await post('/api/localization/generate-pdf-data');
    expect(res.status).toBe(200);
    const site = res.body.pdfData.sites[0];
    expect(site.overall_statement_sv).toBe(NONE_COMPLETED);
    expect(site.overall_coverage_state).toBe('DETERMINED');
    expect(JSON.stringify([site.overall_statement_sv, res.body.pdfData.summary.reasoning])).not.toMatch(/låg risk/i);
    expect(site.overallRisk).toBe('LOW');
  });

  // U20CDF3 (U20CDF2 verification H5.2 / low 5): this case used to let a silent provider through,
  // which gave a FRESH record the text "... för denna historiska bedömning". Silence is now an invalid
  // outcome form in the fresh run: fail-closed before the kernel, no assessment, no coverage text at
  // all (so neither "historisk" nor "0 av 6" nor a risk level). The historical classification itself
  // stays for stored records (read-back), where an older producer can have left a layer unrecorded.
  it.each<[string, { evidence: unknown[]; unavailable_layers: unknown[] }, string]>([
    ['says nothing about any layer', { evidence: [], unavailable_layers: [] }, 'Brunnar'],
    ['is silent about one layer', { evidence: LAYERS.filter((l) => l !== 'natura2000').map(spatialEvidence), unavailable_layers: [] }, 'Natura 2000'],
  ])('U20CDF3 (low 5): a fresh run whose provider %s fails closed -- never the "historiska bedömning" text', async (_label, outcome, layerSv) => {
    queryMock.mockResolvedValue(outcome);
    const res = await post('/api/localization/generate-report');
    expect(res.status).toBe(200);
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor).toMatchObject({
      admitted: false, assessment_status: 'EXECUTION_FAILED', assessment_artifact_id: null,
      reason_codes: ['REJECT_SPATIAL_EVIDENCE_FORM', 'LAYER_NOT_ANSWERED'],
    });
    expect(kernelMock).not.toHaveBeenCalled();
    expect(site.warnings).toEqual([
      'Spatialt underlag avvisat: ett efterfrågat lager redovisas varken med evidens eller som otillgängligt ' +
        `för lagret ${layerSv} (REJECT_SPATIAL_EVIDENCE_FORM: LAYER_NOT_ANSWERED). Ingen bedömning gjordes; regelmotorn nåddes aldrig.`,
    ]);
    expect(site.executionMotor.governed_coverage_state).toBeUndefined();
    const description = String(vi.mocked(auditTrail.logAction).mock.calls[0]![5]);
    for (const text of [JSON.stringify(res.body), description]) {
      expect(text).not.toMatch(/historisk|Täckningsgrad|\b0 av \d|låg risk|måttlig risk|hög risk|i de kontroller som utfördes/i);
    }
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
    const nvr = site.legacyObservations.dataSources.find((d: { source: string }) => d.source === 'NVR API');
    expect(nvr).toMatchObject({ status: 'unavailable' });
    expect(fetchProtectedAreas).toHaveBeenCalledTimes(1);
  });

  it('U20CDF (F4): the outage reads as "ej tillgänglig" per source in a governed:false block, never as "not protected" / 0', async () => {
    const res = await post('/api/localization/generate-pdf-data');
    const site = res.body.pdfData.sites[0];
    expect(site.legacyObservations).toMatchObject({
      governed: false,
      // spatialAudit's protected-area read failed, RAÄ is down; VISS and SLU answered.
      protectedArea: { available: false, status_sv: 'ej tillgänglig', isProtected: null, names: [] },
      monuments: { available: false, status_sv: 'ej tillgänglig', count: null, names: [] },
      distanceToWater: { available: false, status_sv: 'ej tillgänglig', meters: null },
      viss: { available: true, status_sv: 'tillgänglig', waterName: 'Testsjön' },
      slu: { available: true, status_sv: 'tillgänglig', observationCount: 2 },
    });
    for (const key of ['isProtected', 'protectedAreaNames', 'monumentCount', 'monumentNames', 'sluObservationCount', 'dataSources', 'distanceToWaterMeters']) {
      expect(Object.keys(site)).not.toContain(key);
    }
    // Sources up: the same block carries the read values.
    legacy.down = false;
    const up = (await post('/api/localization/generate-pdf-data')).body.pdfData.sites[0].legacyObservations;
    expect(up.protectedArea).toMatchObject({ available: true, isProtected: true, names: ['Testreservatet'] });
    expect(up.monuments).toMatchObject({ available: true, count: 3 });
  });

  it('the summary reasoning in the legacy PDF data carries the same qualification and no percentage', async () => {
    const res = await post('/api/localization/generate-pdf-data');
    expect(res.body.pdfData.summary.reasoning).toContain(INCOMPLETE);
    expect(res.body.pdfData.summary.reasoning).not.toMatch(/%|tillståndssannolikhet/);
  });
});
