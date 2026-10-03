/**
 * W-U20CDF5 (U20CDF4 verification L1; OWNER DECISION 2026-10-02, point 2: a fresh integrity record must NOT be
 * serialised in the form of a valid assessment ANYWHERE -- generate-report, PDF data, map, verify answer,
 * lists -- every serialisation site inventoried and locked by a test).
 *
 * A FRESH generate-report site whose record is a RECORD_INTEGRITY_ERROR carries its stored findings only as the
 * same non-authoritative, whitelisted diagnostic as the 424 (record_integrity) -- never as `findings`,
 * `finding_ids`, `governed_layer_checks`, `evidence_details`, `property_root`, `evidence_integrity`, never with
 * basis entries that carry record ids. The statement still names every stored finding (a known risk never
 * disappears). The stored-record paths (read-back, export-assessment-pdf, verify, map) answer 424 -- locked in
 * luRecordIntegrityFailClosedU20CDF4 / luPinnedEvidenceReadFaultU20CDF5 / luRecordIntegrityEpochU20CDF5.
 *
 * Same hermetic chain as luFreshRunU20CDF4: real router + requireAuth -> real localizationOrchestrator -> real
 * localizationReportService -> real GenerateLocalizationReportUseCase; the kernel is a stub (a record no real
 * producer writes is returned on purpose), the spatial runtime an in-memory fake.
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

// ---- the older, ungoverned sources: answer normally, or fail with invented secret-bearing texts ----
const legacy = vi.hoisted(() => ({ failWithSecrets: false, sluSearchFails: false }));
/** Invented values only. Each legacy failure text carries one secret and one piece of context. */
const LEGACY_SECRET_TEXT: Readonly<Record<string, string>> = {
  spatialAudit: 'connect ECONNREFUSED postgresql://mimer:hemligtSA1@10.0.0.5:5432/lu (spatialAudit)',
  nvr: 'NVR upstream 401 Authorization: Bearer nvrT0kenSecret1 (nvr)',
  raa: 'RAA proxy failed PGPASSWORD=hemligtRAA2 (raa)',
  viss: 'VISS fetch https://api.example/x?api_key=vissKey3secret (viss)',
  slu: 'SLU search failed password=hemligtSLU4 (slu)',
  sluEnrich: 'Artfakta enrich failed {"token":"artfaktaTok5"} (artfakta)',
  rules: 'legacy engine crashed secret=hemligtRULES6 (rules)',
};
vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: vi.fn(async () => {
    if (legacy.failWithSecrets) throw new Error(LEGACY_SECRET_TEXT.spatialAudit);
    return {
      protectedAreaHits: [], protectedAreaAvailable: true, isProtected: false,
      sgu: { manualReviewRequired: false, summary: 'SGU-risk: låg' },
      distanceToWaterMeters: 40, distanceToWaterAvailable: true,
    };
  }),
}));
vi.mock('../../server/services/nvrService', () => ({
  fetchProtectedAreas: vi.fn(async () => {
    if (legacy.failWithSecrets) throw new Error(LEGACY_SECRET_TEXT.nvr);
    return [];
  }),
}));
vi.mock('../../server/services/raaService', () => ({
  fetchAncientMonuments: vi.fn(async () => {
    if (legacy.failWithSecrets) throw new Error(LEGACY_SECRET_TEXT.raa);
    return [];
  }),
}));
vi.mock('../../server/services/vissService', () => ({
  queryVissPoint: vi.fn(async () => {
    if (legacy.failWithSecrets) throw new Error(LEGACY_SECRET_TEXT.viss);
    return { ok: true, primaryWaterStatus: { waterName: 'Testsjön' } };
  }),
}));
vi.mock('../../server/services/sluService', () => ({
  // When failing: the search itself answers (so the enrich step runs and fails), unless the search is
  // the failing step (`sluSearchFails`).
  searchSluByCoordinates: vi.fn(async () => {
    if (legacy.sluSearchFails) throw new Error(LEGACY_SECRET_TEXT.slu);
    return { observations: [{ taxonName: 'Rana arvalis', taxonId: 101 }] };
  }),
  getSpeciesInformation: vi.fn(async () => {
    if (legacy.failWithSecrets) throw new Error(LEGACY_SECRET_TEXT.sluEnrich);
    return null;
  }),
}));
vi.mock('../../server/services/sguRiskService', () => ({ toGeologicalData: vi.fn(() => ({})) }));
vi.mock('../../server/services/complianceRuleEngine', () => ({
  evaluateComplianceRules: vi.fn(() => {
    if (legacy.failWithSecrets) throw new Error(LEGACY_SECRET_TEXT.rules);
    return { overallRisk: 'HIGH', permitProbability: 0.1, restrictions: [], rules: [], summary: 'legacy HIGH' };
  }),
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
import { logger } from '../../server/logger';
import { auditTrail } from '../../server/services/auditTrailService';
import { redactInternalDiagnostic } from '../../src/application/generate-localization-report.usecase';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import { recordIntegrityDiagnosticWire } from '../../server/modules/localization/recordIntegrityDiagnostic';

const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
const RULE: Readonly<Record<string, string>> = {
  water: 'LU-WATER-001',
  ebh: 'LU-EBH-001',
  protected_area: 'LU-PROTECTED-001',
  natura2000: 'LU-NATURA2000-001',
  water_protection_area: 'LU-WATERPROTECTION-001',
};

function spatialEvidence(layer: string, exists = false) {
  return {
    artifact_id: `evidence-${layer}-${exists ? 'hit' : 'neg'}-u20cdf4`,
    artifact_type: 'SPATIAL_EVIDENCE',
    payload: {
      source_metadata: { dataset: layer },
      result_semantics: {
        kind: 'EXISTENCE_WITHIN_DISTANCE',
        result: { exists, match_count_observed: exists ? 2 : 0, max_features_per_layer: 50 },
      },
    },
  };
}
const refOf = (e: { artifact_id: string; artifact_type: string }) => ({ artifact_id: e.artifact_id, artifact_type: e.artifact_type });

const app = express();
app.use(express.json());
app.use(localizationRoutes);
const token = createTokenPair({ id: 'user-u20cdf5-l1', organisationId: 'org-u20cdf4', bankidId: 'bankid:u20cdf4', role: 'ADMIN' }).accessToken;
const SITE_A = { id: 'ALT-A', name: 'Plats A', lat: 59.33, lng: 18.06 };
const SITE_B = { id: 'ALT-B', name: 'Plats B', lat: 59.34, lng: 18.07 };

async function post(path: string, sites: readonly { id: string; name: string; lat: number; lng: number }[] = [SITE_A]) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`).send({ projectId: 'proj-u20cdf5-l1', siteAlternatives: sites });
}

/**
 * The draft's property_ref -- the run's canonical property context (resolveCanonicalProjectContext above), which the
 * real producer (createGovernedLocalizationAssessment) copies into every record. W-U20CDF6: the stub record carries it
 * too, as the producer writes it (before, the stub omitted it, which no producer does).
 */
const PROPERTY_CONTEXT_REF = { artifact_id: 'property-context-1', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;

/** The admitted kernel answer for a record with these findings over these stored evidences. */
function admitted(
  artifactId: string,
  findings: readonly unknown[],
  evidence: readonly { artifact_id: string; artifact_type: string }[],
  editPayload: (payload: Record<string, unknown>) => void = () => undefined,
) {
  const payload: Record<string, unknown> = { property_ref: PROPERTY_CONTEXT_REF, evidence_refs: evidence.map(refOf), findings };
  editPayload(payload);
  return {
    admitted: true, reason_codes: [], attempt_id: `attempt-${artifactId}`, outcome_id: `outcome-${artifactId}`, manifest_id: `manifest-${artifactId}`,
    findings, finding_ids: findings.map((f) => (f as { finding_id?: string } | null)?.finding_id ?? 'x'),
    assessment: { artifact_id: artifactId, payload },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hermeticPrismaTouches.length = 0;
  legacy.failWithSecrets = false;
  legacy.sluSearchFails = false;
  queryMock.mockResolvedValue({ evidence: LAYERS.map((layer) => spatialEvidence(layer)), unavailable_layers: [] });
  kernelMock.mockResolvedValue(admitted('assessment-u20cdf4', [], LAYERS.map((layer) => spatialEvidence(layer))));
});

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});


// ---------------------------------------------------------------------------------------------------------
// W-U20CDF5 (L1 / owner decision point 2)
// ---------------------------------------------------------------------------------------------------------

const SENTINEL_EXPLANATION = 'Lagrad förklaring U20CDF5 med SELECT * FROM env.secret';
const EBH_HIT = spatialEvidence('ebh', true);
const WITH_EBH_HIT = LAYERS.map((layer) => (layer === 'ebh' ? EBH_HIT : spatialEvidence(layer)));
const ebhHigh = { finding_id: 'finding-ebh-high-u20cdf5', rule_id: RULE.ebh, rule_version: '2.0', risk_level: 'HIGH', explanation: SENTINEL_EXPLANATION, evidence_refs: [refOf(EBH_HIT)] };
const waterCritical = { finding_id: 'finding-water-critical-u20cdf5', rule_id: RULE.water, rule_version: '2.0', risk_level: 'CRITICAL', explanation: SENTINEL_EXPLANATION, evidence_refs: [] };

/** Every key path in a JSON value (arrays as []), for a whole-body scan. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [`${prefix}.${key}`, ...keyPaths(child, `${prefix}.${key}`)]);
  }
  return [];
}

/** A key that belongs to a valid assessment's or a finding's form -- never in the answer for an integrity-only report. */
const VALID_FORM_KEY = /\.(finding_id|explanation|risk_level|evidence_refs|overallRisk|permitProbability|unresolvedChecks|evidence_details|property_root|evidence_integrity|cited_by_finding_ids)$/;

function expectIntegrityOnlyBody(body: unknown) {
  const text = JSON.stringify(body);
  for (const raw of [SENTINEL_EXPLANATION, 'secret', 'finding-ebh-high-u20cdf5', 'finding-water-critical-u20cdf5', 'CRITICAL']) {
    expect(text, raw).not.toContain(raw);
  }
  const offending = keyPaths(body).filter((p) => VALID_FORM_KEY.test(p));
  expect(offending).toEqual([]);
}

describe('W-U20CDF5 L1 (owner decision point 2): a FRESH integrity site is never serialised in the form of a valid assessment', () => {
  beforeEach(() => {
    queryMock.mockResolvedValue({ evidence: WITH_EBH_HIT, unavailable_layers: [] });
    kernelMock.mockResolvedValue(admitted('assessment-integrity-u20cdf5', [ebhHigh, waterCritical], WITH_EBH_HIT));
  });

  it('generate-report: executionMotor holds no findings, finding ids, layer rows, evidence details, root or integrity in valid form -- only the whitelisted record_integrity', async () => {
    const res = await post('/api/localization/generate-report');
    expect(res.status).toBe(200);
    const motor = res.body.siteAnalyses[0].executionMotor;
    expect(motor).toMatchObject({
      admitted: true, assessment_status: 'RECORD_INTEGRITY_ERROR', assessment_artifact_id: 'assessment-integrity-u20cdf5',
      governed_coverage_state: 'RECORD_INTEGRITY_ERROR', governed_coverage_basis: ['UNKNOWN_SEVERITY'], findings: [], finding_ids: [],
    });
    for (const key of ['governed_layer_checks', 'evidence_details', 'evidence_details_error', 'property_root', 'evidence_integrity']) {
      expect(motor, key).not.toHaveProperty(key);
    }
    // The same non-authoritative envelope as the 424 -- and exactly what its own wire whitelist lets through.
    expect(motor.record_integrity).toEqual(recordIntegrityDiagnosticWire(motor.record_integrity));
    expect(motor.record_integrity).toMatchObject({
      authoritative: false, verified: false, assessment_artifact_id: 'assessment-integrity-u20cdf5', basis_codes: ['UNKNOWN_SEVERITY'],
      stored_findings_unverified: { total: 2, highest_level: 'HIGH', counts: { high: 1, unknown_level: 1 }, truncated: false },
    });
    // A known risk never disappears: the statement still names every stored finding.
    expect(res.body.siteAnalyses[0].complianceAnalysis.summary).toContain(
      'risknivå hög – Potentiellt förorenade områden (EBH); okänd allvarlighetsgrad – Brunnar',
    );
    expectIntegrityOnlyBody(res.body);
  });

  it('generate-pdf-data: the integrity site has no layer rows and no finding form -- the statement, the state and the whitelisted record_integrity', async () => {
    const res = await post('/api/localization/generate-pdf-data');
    expect(res.status).toBe(200);
    const site = res.body.pdfData.sites[0];
    expect(site).toMatchObject({ assessment_status: 'RECORD_INTEGRITY_ERROR', governed_layer_checks: null, overall_coverage_state: 'RECORD_INTEGRITY_ERROR' });
    expect(site.record_integrity).toEqual(recordIntegrityDiagnosticWire(site.record_integrity));
    expect(site.record_integrity).toMatchObject({ authoritative: false, verified: false, stored_findings_unverified: { total: 2 } });
    expect(site.overall_statement_sv).toContain('risknivå hög – Potentiellt förorenade områden (EBH)');
    expectIntegrityOnlyBody({ sites: res.body.pdfData.sites, summary: res.body.pdfData.summary });
  });

  it('lists and audit: the integrity site is listed by id and status only', async () => {
    const res = await post('/api/localization/generate-report');
    expect(res.body.summary).toMatchObject({ assessed_site_ids: [], not_ranked_site_ids: ['ALT-A'], unassessed_site_ids: [] });
    const details = (vi.mocked(auditTrail.logAction).mock.calls.at(-1)![6] as { details: Record<string, unknown> }).details;
    expect(details.not_ranked_sites).toEqual([
      { site_id: 'ALT-A', assessment_status: 'RECORD_INTEGRITY_ERROR', assessment_artifact_id: 'assessment-integrity-u20cdf5', governed_coverage_state: 'RECORD_INTEGRITY_ERROR' },
    ]);
    expectIntegrityOnlyBody(details);
  });

  it('control: a valid fresh site keeps its findings, layer rows and evidence details, and carries no record_integrity', async () => {
    const valid = { ...ebhHigh, explanation: 'x' };
    kernelMock.mockResolvedValue(admitted('assessment-valid-u20cdf5', [valid], WITH_EBH_HIT));
    const res = await post('/api/localization/generate-report');
    const motor = res.body.siteAnalyses[0].executionMotor;
    expect(motor.assessment_status).toBe('ASSESSED');
    expect(motor.findings).toHaveLength(1);
    expect(motor.finding_ids).toEqual(['finding-ebh-high-u20cdf5']);
    expect(motor.governed_layer_checks).toHaveLength(6);
    expect(motor).toHaveProperty('evidence_details');
    expect(motor).not.toHaveProperty('record_integrity');
  });
});

// ---------------------------------------------------------------------------------------------------------
// W-U20CDF6 (owner decision R2-5, 2026-10-03): a record without a well-formed property_ref is a RECORD_INTEGRITY_ERROR
// on every path -- also the fresh run that wrote it: its own status, no verdict, never ranked, listed by id and status
// ---------------------------------------------------------------------------------------------------------

const PROPERTY_REF_EDITS: ReadonlyArray<readonly [string, (payload: Record<string, unknown>) => void]> = [
  ['removed', (p) => { delete p.property_ref; }],
  ['an empty id', (p) => { p.property_ref = { artifact_id: '', artifact_type: 'LU_PROPERTY_CONTEXT' }; }],
  ['without a type', (p) => { p.property_ref = { artifact_id: 'property-context-1' }; }],
  ['a string', (p) => { p.property_ref = 'property-context-1'; }],
];

describe('W-U20CDF6 R2-5: a FRESH record without a well-formed property_ref is a RECORD_INTEGRITY_ERROR -- never ASSESSED, never ranked', () => {
  for (const [variant, edit] of PROPERTY_REF_EDITS) {
    it(`property_ref ${variant}: RECORD_INTEGRITY_ERROR (MALFORMED_RECORD_ENTRY), no verdict, not ranked; only the whitelisted record_integrity`, async () => {
      const valid = { ...ebhHigh, explanation: 'x' };
      kernelMock.mockResolvedValue(admitted('assessment-noprop-u20cdf6', [valid], WITH_EBH_HIT, edit));
      queryMock.mockResolvedValue({ evidence: WITH_EBH_HIT, unavailable_layers: [] });
      const res = await post('/api/localization/generate-report');
      expect(res.status).toBe(200);
      const analysis = res.body.siteAnalyses[0];
      expect(analysis.executionMotor).toMatchObject({
        assessment_status: 'RECORD_INTEGRITY_ERROR', governed_coverage_state: 'RECORD_INTEGRITY_ERROR',
        governed_coverage_basis: ['MALFORMED_RECORD_ENTRY'], findings: [], finding_ids: [],
      });
      expect(analysis.executionMotor.record_integrity).toMatchObject({ authoritative: false, verified: false, basis_codes: ['MALFORMED_RECORD_ENTRY'] });
      expect(analysis.complianceAnalysis).not.toHaveProperty('overallRisk');
      expect(analysis.complianceAnalysis).not.toHaveProperty('permitProbability');
      // The statement is the integrity statement and still names the stored finding.
      expect(analysis.complianceAnalysis.summary).toMatch(/^Integritetsfel: /);
      expect(analysis.complianceAnalysis.summary).toContain('risknivå hög – Potentiellt förorenade områden (EBH)');
      expect(res.body.summary).toMatchObject({ assessed_site_ids: [], not_ranked_site_ids: ['ALT-A'], unassessed_site_ids: [] });
      expect(res.body.summary.bestAlternativeId ?? null).toBeNull();
    });
  }

  it('ranking with two sites: the site without property_ref is not ranked and never best; the valid site is ranked', async () => {
    // Both records are otherwise the same consistent all-negative record (each would be ASSESSED and ranked).
    const negatives = LAYERS.map((layer) => spatialEvidence(layer));
    kernelMock.mockImplementation(async (input: { assessment_draft: { site_id: string } }) =>
      input.assessment_draft.site_id === 'ALT-A'
        ? admitted('assessment-noprop-a-u20cdf6', [], negatives, (p) => { delete p.property_ref; })
        : admitted('assessment-valid-b-u20cdf6', [], negatives),
    );
    const res = await post('/api/localization/generate-report', [SITE_A, SITE_B]);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ assessed_site_ids: ['ALT-B'], not_ranked_site_ids: ['ALT-A'] });
    const statusOf = (id: string) => res.body.siteAnalyses.find((s: { site: { id: string } }) => s.site.id === id).executionMotor.assessment_status;
    expect(statusOf('ALT-A')).toBe('RECORD_INTEGRITY_ERROR');
    expect(statusOf('ALT-B')).toBe('ASSESSED');
    expect(JSON.stringify(res.body.summary)).not.toMatch(/"bestAlternativeId":"ALT-A"/);
  });

  it('control (no over-closing): the same record WITH its property_ref is ASSESSED and ranked', async () => {
    const valid = { ...ebhHigh, explanation: 'x' };
    kernelMock.mockResolvedValue(admitted('assessment-withprop-u20cdf6', [valid], WITH_EBH_HIT));
    queryMock.mockResolvedValue({ evidence: WITH_EBH_HIT, unavailable_layers: [] });
    const res = await post('/api/localization/generate-report');
    expect(res.body.siteAnalyses[0].executionMotor.assessment_status).toBe('ASSESSED');
    expect(res.body.summary).toMatchObject({ assessed_site_ids: ['ALT-A'], not_ranked_site_ids: [] });
  });
});
