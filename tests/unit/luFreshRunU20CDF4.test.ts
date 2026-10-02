/**
 * U20CDF4 (U20CDF3 verification L1-L3; owner decisions 2026-10-03 night (4), points 1, 3 and 4) -- the
 * FRESH generate-report run.
 *
 * Path under test: real router + requireAuth -> real localizationOrchestrator -> real
 * localizationReportService -> real GenerateLocalizationReportUseCase. Hermetic: server/db/prisma is
 * the throwing guard, the spatial runtime is an in-memory fake, the kernel is a stub (so a record no
 * real producer writes can be returned on purpose), the older sources are stubs that can fail with
 * invented secret-bearing texts.
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
const token = createTokenPair({ id: 'user-u20cdf4', organisationId: 'org-u20cdf4', bankidId: 'bankid:u20cdf4', role: 'ADMIN' }).accessToken;
const SITE_A = { id: 'ALT-A', name: 'Plats A', lat: 59.33, lng: 18.06 };
const SITE_B = { id: 'ALT-B', name: 'Plats B', lat: 59.34, lng: 18.07 };

async function post(path: string, sites: readonly { id: string; name: string; lat: number; lng: number }[] = [SITE_A]) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`).send({ projectId: 'proj-u20cdf4', siteAlternatives: sites });
}

/** The admitted kernel answer for a record with these findings over these stored evidences. */
function admitted(artifactId: string, findings: readonly unknown[], evidence: readonly { artifact_id: string; artifact_type: string }[]) {
  return {
    admitted: true, reason_codes: [], attempt_id: `attempt-${artifactId}`, outcome_id: `outcome-${artifactId}`, manifest_id: `manifest-${artifactId}`,
    findings, finding_ids: findings.map((f) => (f as { finding_id?: string } | null)?.finding_id ?? 'x'),
    assessment: { artifact_id: artifactId, payload: { evidence_refs: evidence.map(refOf), findings } },
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

function warnCalls(message: string) {
  return vi.mocked(logger.warn).mock.calls.filter((call) => call[0] === message);
}

describe('U20CDF4 (U20CDF3 verification L1): a malformed unavailable entry is the gate\'s typed violation, never an ExecutionKernel error', () => {
  const ANSWERED = LAYERS.filter((layer) => layer !== 'water').map((layer) => spatialEvidence(layer));

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'water'],
    ['a boolean', true],
  ])('an unavailable entry that is %s -> REJECT_SPATIAL_EVIDENCE_FORM / UNAVAILABLE_WITHOUT_DATASET, no kernel, no assessment', async (_label, junk) => {
    queryMock.mockResolvedValue({ evidence: ANSWERED, unavailable_layers: [{ dataset: 'water', reason: 'SOURCE_UNAVAILABLE' }, junk] });
    const res = await post('/api/localization/generate-report');
    expect(res.status).toBe(200);
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor).toMatchObject({
      admitted: false, assessment_status: 'EXECUTION_FAILED', assessment_artifact_id: null,
      reason_codes: ['REJECT_SPATIAL_EVIDENCE_FORM', 'UNAVAILABLE_WITHOUT_DATASET'],
    });
    expect(kernelMock).not.toHaveBeenCalled();
    expect(site.warnings).toEqual([
      'Spatialt underlag avvisat: en uppgift om otillgängligt lager saknar lagernamn (REJECT_SPATIAL_EVIDENCE_FORM: UNAVAILABLE_WITHOUT_DATASET). ' +
        'Ingen bedömning gjordes; regelmotorn nåddes aldrig.',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/ExecutionKernel error|EXECUTION_KERNEL_ERROR/);
  });

  it('the not yet validated layer, reason and diagnostic of an unavailable entry are logged redacted (the gate has not admitted them)', async () => {
    queryMock.mockResolvedValue({
      evidence: ANSWERED,
      unavailable_layers: [
        { dataset: 'water', reason: 'SOURCE_UNAVAILABLE', diagnostic: 'ECONNREFUSED password=hemligtL1a' },
        { dataset: 'postgresql://mimer:hemligtL1b@10.0.0.5:5432/lu', reason: 'PGPASSWORD=hemligtL1c', diagnostic: 'x' },
      ],
    });
    const res = await post('/api/localization/generate-report');
    // The second entry names a dataset that was not requested: the gate rejects the outcome.
    expect(res.body.siteAnalyses[0].executionMotor.reason_codes).toEqual(['REJECT_SPATIAL_EVIDENCE_FORM', 'DATASET_NOT_REQUESTED']);
    const logged = warnCalls('Governed LU layer query failed (internal diagnostic)').map((call) => call[1] as Record<string, unknown>);
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({ site: 'ALT-A', layer: 'water', reason: 'SOURCE_UNAVAILABLE' });
    expect(String(logged[0]!.diagnostic)).toContain('ECONNREFUSED');
    const text = JSON.stringify(logged);
    for (const secret of ['hemligtL1a', 'hemligtL1b', 'hemligtL1c']) expect(text, text).not.toContain(secret);
    expect(String(logged[1]!.layer)).toContain('10.0.0.5:5432/lu');
    expect(JSON.stringify(res.body)).not.toMatch(/hemligt|10\.0\.0\.5/);
  });
});

describe('U20CDF4 (U20CDF3 verification L2): the seven log lines of the older, ungoverned path are redacted like every other diagnostic', () => {
  beforeEach(() => {
    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key'; // SLU configured, so its search and enrich steps run
  });
  afterEach(() => {
    delete process.env.SLU_SPECIES_OBS_API_KEY;
  });

  /** [log message, the source's invented failure text] -- the secret is the masked part, the context the rest. */
  const LINES: ReadonlyArray<readonly [string, string, string, string]> = [
    ['fetchProtectedAreas failed for localization', LEGACY_SECRET_TEXT.nvr!, 'nvrT0kenSecret1', '(nvr)'],
    ['fetchAncientMonuments failed for localization', LEGACY_SECRET_TEXT.raa!, 'hemligtRAA2', '(raa)'],
    ['queryVissPoint failed for localization', LEGACY_SECRET_TEXT.viss!, 'vissKey3secret', '(viss)'],
    ['Failed to enrich SLU observations with Artfakta facts', LEGACY_SECRET_TEXT.sluEnrich!, 'artfaktaTok5', '(artfakta)'],
    ['runSpatialAudit failed (legacy observation)', LEGACY_SECRET_TEXT.spatialAudit!, 'hemligtSA1', '10.0.0.5:5432/lu (spatialAudit)'],
    ['evaluateComplianceRules failed (legacy observation)', LEGACY_SECRET_TEXT.rules!, 'hemligtRULES6', '(rules)'],
  ];

  it('generate-pdf-data with every older source failing: each failure is logged with its context, never with its secret', async () => {
    legacy.failWithSecrets = true;
    const res = await post('/api/localization/generate-pdf-data');
    expect(res.status).toBe(200);
    for (const [message, , secret, context] of LINES) {
      const calls = warnCalls(message);
      expect(calls, message).toHaveLength(1);
      const err = String((calls[0]![1] as Record<string, unknown>).err);
      expect(err, `${message}: ${err}`).not.toContain(secret);
      expect(err, `${message}: ${err}`).toContain(context);
      expect(err).toContain('***');
    }
    // Nothing of it in the answer either (unchanged: the older sources answer "ej tillgänglig").
    const body = JSON.stringify(res.body);
    for (const [, , secret] of LINES) expect(body).not.toContain(secret);
  });

  it('the seventh line: a failing SLU search is logged with its context, never with its secret', async () => {
    legacy.failWithSecrets = true;
    legacy.sluSearchFails = true;
    await post('/api/localization/generate-pdf-data');
    const calls = warnCalls('searchSluByCoordinates failed for localization');
    expect(calls).toHaveLength(1);
    const err = String((calls[0]![1] as Record<string, unknown>).err);
    expect(err, err).not.toContain('hemligtSLU4');
    expect(err, err).toContain('SLU search failed');
  });
});

describe('U20CDF4 (U20CDF3 verification L3): a semicolon inside an unquoted secret value never lets the rest of the secret through', () => {
  // All values invented. [label, text, fragments that must be masked, fragments that must stay].
  it.each<[string, string, readonly string[], readonly string[]]>([
    ['the verifier probe: Password=Semi;Colon34;Host=db', 'Password=Semi;Colon34;Host=db', ['Semi', 'Colon34'], ['Host=db']],
    ['the secret last in the string', 'connect failed Pwd=Semi;Colon34', ['Semi', 'Colon34'], ['connect failed']],
    ['an ADO.NET connection string with keys containing spaces', 'Server=db;User ID=mimer;Password=Semi;Colon34;Initial Catalog=lu', ['Semi', 'Colon34'], ['Server=db', 'User ID=mimer', 'Catalog=lu']],
    ['an ODBC braced value with semicolons in it', 'Driver={PostgreSQL};Pwd={Semi;Colon;34};Server=db', ['Semi', 'Colon;34'], ['Driver={PostgreSQL}', 'Server=db']],
    ['an env form followed by ordinary words', 'env PGPASSWORD=Semi;Colon34 psql -h x', ['Semi', 'Colon34'], ['psql -h x']],
    ['two semicolons in a row of the value', 'api_key=ab;cd;ef;Host=db', ['ab;cd', 'cd;ef'], ['Host=db']],
    ['a key=value secret followed by ordinary error text', 'token=abc123x; connection refused', ['abc123x'], ['connection refused']],
    ['"password <value>" with a semicolon in the value', 'login password Semi;Colon34 rejected', ['Semi', 'Colon34'], ['login', 'rejected']],
    ['a quoted value keeps working', "password='Semi;Colon34' host=db", ['Semi', 'Colon34'], ['host=db']],
  ])('redactInternalDiagnostic: %s', (_label, text, secrets, kept) => {
    const redacted = redactInternalDiagnostic(text)!;
    for (const secret of secrets) expect(redacted, redacted).not.toContain(secret);
    for (const fragment of kept) expect(redacted, redacted).toContain(fragment);
    expect(redacted).toContain('***');
  });

  it.each([
    'password authentication failed for user "postgres"; retrying in 5 s',
    'relation "env.protected_area" does not exist; hint: check the search_path',
    'statement timeout; query canceled after 5000 ms',
  ])('ordinary diagnostics with semicolons stay as they are: %j', (text) => {
    expect(redactInternalDiagnostic(text)).toBe(text);
  });
});

describe('U20CDF4 (owner decisions (4) points 1 and 3; coordinator clarification 5): a fresh site whose record is not established is never ranked, carries no verdict, and says why', () => {
  const EBH_HIT = spatialEvidence('ebh', true);
  const WITH_EBH_HIT = LAYERS.map((layer) => (layer === 'ebh' ? EBH_HIT : spatialEvidence(layer)));
  const ebhHigh = { finding_id: 'finding-ebh-high', rule_id: RULE.ebh, rule_version: '2.0', risk_level: 'HIGH', explanation: 'x', evidence_refs: [refOf(EBH_HIT)] };
  const waterCritical = { finding_id: 'finding-water-critical', rule_id: RULE.water, rule_version: '2.0', risk_level: 'CRITICAL', explanation: 'x', evidence_refs: [] };
  const INTEGRITY_SV =
    'Integritetsfel: bedömningens lagrade underlag är motsägelsefullt eller ligger utanför det styrda formatet. ' +
    'Täckningsgrad och samlad risknivå kan därför inte fastställas.';
  const integritySentence = (label: string, summary: string) =>
    `${label} har en sparad styrd bedömning men rangordnas inte: bedömningens lagrade post har ett integritetsfel ` +
    '(underlaget är motsägelsefullt eller ligger utanför det styrda formatet), så ingen risknivå och ingen sannolikhet anges ' +
    `för den och den jämförs inte med de rangordnade alternativen. Bedömningens sammanfattning: ${summary}`;

  it('a record with an unknown severity next to a stored HIGH -> status RECORD_INTEGRITY_ERROR, no verdict, the artifact kept, the HIGH named, never ranked', async () => {
    queryMock.mockResolvedValue({ evidence: WITH_EBH_HIT, unavailable_layers: [] });
    kernelMock.mockResolvedValue(admitted('assessment-integrity', [ebhHigh, waterCritical], WITH_EBH_HIT));
    const res = await post('/api/localization/generate-report');
    expect(res.status).toBe(200);
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor).toMatchObject({
      admitted: true, assessment_status: 'RECORD_INTEGRITY_ERROR', assessment_artifact_id: 'assessment-integrity',
      governed_coverage_state: 'RECORD_INTEGRITY_ERROR', governed_coverage_basis: ['UNKNOWN_SEVERITY:finding-water-critical'],
    });
    const summary = `${INTEGRITY_SV} Bedömningens lagrade fynd redovisas var för sig: risknivå hög – Potentiellt förorenade områden (EBH); okänd allvarlighetsgrad – Brunnar.`;
    expect(site.complianceAnalysis).toEqual({ restrictions: [], rules: [], summary, assessment_status: 'RECORD_INTEGRITY_ERROR' });
    for (const key of ['overallRisk', 'permitProbability', 'unresolvedChecks']) expect(site.complianceAnalysis).not.toHaveProperty(key);
    expect(site.warnings).toEqual([
      'Integritetsfel: den styrda bedömning som körningen sparade (assessment-integrity) har ett lagrat underlag som är motsägelsefullt ' +
        'eller ligger utanför det styrda formatet (RECORD_INTEGRITY_ERROR). Ingen risknivå och ingen sannolikhet anges, och alternativet rangordnas inte.',
    ]);
    expect(res.body.summary.bestAlternativeId).toBeUndefined();
    expect(res.body.summary.comparison_status).toBe('UNAVAILABLE');
    expect(res.body.summary.assessed_site_ids).toEqual([]);
    expect(res.body.summary.reasoning).toBe(
      `Ingen rangordning tillgänglig: inget av 1 alternativ kan rangordnas. ${integritySentence('Alternativ ALT-A (Plats A)', summary)}`,
    );
    expect(JSON.stringify([site.complianceAnalysis, res.body.summary])).not.toMatch(/låg risk|\b\d+ av \d+ kontroller/i);
  });

  it('coordinator clarification 5: an integrity error never becomes the best site -- not even when its machine probability (0.95) beats every other site', async () => {
    // ALT-A: only a finding of unknown severity -> the machine derivation would say LOW / 0.95, the
    // highest possible. ALT-B: a valid MEDIUM record -> 0.5. Before U20CDF4 ALT-A was ranked first.
    const WATER_HIT = spatialEvidence('water', true);
    const WITH_WATER_HIT = LAYERS.map((layer) => (layer === 'water' ? WATER_HIT : spatialEvidence(layer)));
    const NEGATIVES_ONLY = LAYERS.map((layer) => spatialEvidence(layer));
    const waterMedium = { finding_id: 'finding-water-medium', rule_id: RULE.water, rule_version: '2.0', risk_level: 'MEDIUM', explanation: 'x', evidence_refs: [refOf(WATER_HIT)] };
    queryMock
      .mockResolvedValueOnce({ evidence: NEGATIVES_ONLY, unavailable_layers: [] })
      .mockResolvedValueOnce({ evidence: WITH_WATER_HIT, unavailable_layers: [] });
    kernelMock.mockImplementation(async (input: { assessment_draft: { site_id: string } }) =>
      input.assessment_draft.site_id === 'ALT-A'
        ? admitted('assessment-a', [{ ...waterCritical, risk_level: 'high' }], NEGATIVES_ONLY)
        : admitted('assessment-b', [waterMedium], WITH_WATER_HIT),
    );
    const res = await post('/api/localization/generate-report', [SITE_A, SITE_B]);
    const [a, b] = res.body.siteAnalyses;
    expect(a.executionMotor.assessment_status).toBe('RECORD_INTEGRITY_ERROR');
    expect(a.complianceAnalysis).not.toHaveProperty('permitProbability');
    expect(b.executionMotor.assessment_status).toBe('ASSESSED');
    expect(b.complianceAnalysis).toMatchObject({ overallRisk: 'MEDIUM', permitProbability: 0.5 });
    expect(res.body.summary.bestAlternativeId).toBe('ALT-B');
    expect(res.body.summary.assessed_site_ids).toEqual(['ALT-B']);
    expect(res.body.summary.comparison_status).toBe('PARTIAL');
    expect(res.body.summary.reasoning).toBe(
      'Alternativ ALT-B (Plats B) rangordnas först bland de rangordnade alternativen enligt de styrda fynden. ' +
        `${b.complianceAnalysis.summary} Jämförelsen är partiell: 1 av 2 alternativ ingår i rangordningen. ` +
        integritySentence('Alternativ ALT-A (Plats A)', a.complianceAnalysis.summary),
    );
    const details = (vi.mocked(auditTrail.logAction).mock.calls.at(-1)![6] as { details: Record<string, unknown> }).details;
    expect(details).toMatchObject({ bestAlternativeId: 'ALT-B', bestAssessmentArtifactId: 'assessment-b', bestPermitProbability: 0.5, overallRisk: 'MEDIUM' });
  });

  it('a fresh record of a shape no current producer writes (a hit without its finding) is an integrity error of THIS run -- never "historisk", never ranked', async () => {
    queryMock.mockResolvedValue({ evidence: WITH_EBH_HIT, unavailable_layers: [] });
    kernelMock.mockResolvedValue(admitted('assessment-hit-no-finding', [], WITH_EBH_HIT));
    const res = await post('/api/localization/generate-report');
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor).toMatchObject({
      assessment_status: 'RECORD_INTEGRITY_ERROR', governed_coverage_state: 'RECORD_INTEGRITY_ERROR', governed_coverage_basis: ['HIT_WITHOUT_FINDING:ebh'],
    });
    expect(site.complianceAnalysis.summary).toBe(INTEGRITY_SV);
    expect(res.body.summary.bestAlternativeId).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/historisk|Låg risk|\b\d+ av \d+ kontroller/i);
  });

  it('generate-pdf-data: the integrity site carries no verdict keys, but its status, coverage state and the statement naming the stored findings', async () => {
    queryMock.mockResolvedValue({ evidence: WITH_EBH_HIT, unavailable_layers: [] });
    kernelMock.mockResolvedValue(admitted('assessment-integrity', [ebhHigh, waterCritical], WITH_EBH_HIT));
    const res = await post('/api/localization/generate-pdf-data');
    expect(res.status).toBe(200);
    const site = res.body.pdfData.sites[0];
    expect(site).toMatchObject({
      assessment_status: 'RECORD_INTEGRITY_ERROR', assessment_artifact_id: 'assessment-integrity', overall_coverage_state: 'RECORD_INTEGRITY_ERROR',
    });
    expect(site.overall_statement_sv).toContain('risknivå hög – Potentiellt förorenade områden (EBH); okänd allvarlighetsgrad – Brunnar');
    for (const key of ['overallRisk', 'permitProbability', 'permitProbabilityStatus', 'unresolvedChecks']) expect(site).not.toHaveProperty(key);
    expect(res.body.pdfData.summary.bestAlternativeId).toBeUndefined();
  });

  it('control: a valid fresh record is still ASSESSED, DETERMINED, ranked and carries its verdict', async () => {
    const res = await post('/api/localization/generate-report');
    const site = res.body.siteAnalyses[0];
    expect(site.executionMotor).toMatchObject({ assessment_status: 'ASSESSED', governed_coverage_state: 'DETERMINED' });
    expect(site.complianceAnalysis).toMatchObject({ overallRisk: 'LOW', permitProbability: 0.95 });
    expect(res.body.summary.bestAlternativeId).toBe('ALT-A');
    expect(res.body.summary.comparison_status).toBe('COMPLETE');
  });
});
