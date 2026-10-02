/**
 * DEMO M1a -- D9(a) + U12 through the real GenerateLocalizationReportUseCase (generate-report).
 *
 * Mock layout follows src/application/unit/P3LuVerdictAuthority.red.test.ts, except that the
 * legacy compliance mock returns the full SiteAnalysis shape (restrictions/rules) -- that file's
 * mock lacks them and fails at legacyObservationTag on this branch's HEAD (pre-existing, not
 * changed by M1a).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kernelMock = vi.fn();
const resolveOrDeriveMock = vi.fn();

vi.mock('@miljobeslut/mps-lu', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LU_SPATIAL_CAPABILITY_KEY: 'lu.spatial',
  orchestrator: { generateDocumentEvidence: vi.fn(async () => []) },
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
    protectedAreaHits: [],
    protectedAreaAvailable: false,
    protectedAreaWarning: 'Skyddad natur kunde inte verifieras i lokal databas: column "nvr_id" does not exist',
    isProtected: false,
    sgu: { manualReviewRequired: false, summary: 'ok' },
    distanceToWaterMeters: null,
    distanceToWaterAvailable: false,
    distanceToWaterWarning: 'Kunde inte beräkna avstånd till vatten',
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
vi.mock('../../server/modules/localization/localizationGeometryService', () => ({
  resolveOrDeriveCurrentLocalizationGeometry: (...args: unknown[]) => resolveOrDeriveMock(...args),
}));

import {
  LocalizationGeometryCurrentnessError,
  resolvedGeometryProvenanceRecord,
  type LocalizationGeometryCurrentnessFailureClass,
} from '../../server/modules/localization/localizationGeometryCurrentness';
import { computeGovernedLayerChecks } from '../../server/modules/localization/governedLayerChecks';
import { GenerateLocalizationReportUseCase, LEGACY_SPATIAL_AUDIT_PREFIX_SV } from '../../src/application/generate-localization-report.usecase';

const SITE = { id: 'site-a', name: 'Alternativ A', lat: 59.33, lng: 18.06 };

function evidence(layer: string, exists: boolean) {
  return {
    artifact_id: `evidence-${layer}-x`,
    artifact_type: 'SPATIAL_EVIDENCE',
    payload: { source_metadata: { dataset: layer }, result_semantics: { result: { exists } } },
  };
}

const queryMock = vi.fn();
function runtime() {
  return {
    artifactRepository: { put: vi.fn(async () => undefined), resolve: vi.fn(async () => { throw new Error('nope'); }) },
    resolveSpatialProvider: vi.fn(() => ({ query: queryMock })),
    sweref99ToWgs84: vi.fn(async () => [59.33, 18.06] as const),
    close: vi.fn(async () => undefined),
  };
}

async function runReport() {
  return new GenerateLocalizationReportUseCase(async () => runtime() as never).execute({ projectId: 'proj-1', siteAlternatives: [SITE] });
}

const WATER_HIT = { finding_id: 'f-water', rule_id: 'LU-WATER-001', rule_version: '2.0', risk_level: 'MEDIUM', explanation: 'x', evidence_refs: [] };
const PROTECTED_NOT_CHECKED = { finding_id: 'finding-notchecked-protected_area', rule_id: 'LU-PROTECTED-001', rule_version: '2.0', risk_level: 'NOT_CHECKED', explanation: 'y', evidence_refs: [] };

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockResolvedValue({
    evidence: [evidence('water', true), evidence('ebh', false), evidence('natura2000', false)],
    unavailable_layers: [{ dataset: 'protected_area', reason: 'TABLE_MISSING' }],
  });
  kernelMock.mockResolvedValue({
    admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1',
    findings: [WATER_HIT, PROTECTED_NOT_CHECKED], finding_ids: ['f-water', 'finding-notchecked-protected_area'],
    assessment: { artifact_id: 'assessment-1' },
  });
});

describe('D9(a) through generate-report: every non-NOT_FOUND currentness class fails closed', () => {
  it.each<[LocalizationGeometryCurrentnessFailureClass, string]>([
    ['AMBIGUOUS_CURRENT_GEOMETRY', 'GOVERNANCE_DENIED'],
    ['INVALID_SUPERSESSION_GRAPH', 'GOVERNANCE_DENIED'],
    ['NO_VERIFIED_GEOMETRY_CANDIDATE', 'GOVERNANCE_DENIED'],
    ['INVALID_GEOMETRY_HEAD', 'GOVERNANCE_DENIED'],
    ['VERIFIER_CONFIGURATION', 'EXECUTION_FAILED'],
    ['DERIVED_GEOMETRY_PERSISTENCE_FAILED', 'EXECUTION_FAILED'],
    ['CURRENTNESS_RESOLUTION_ERROR', 'EXECUTION_FAILED'],
  ])('%s -> no kernel run, no verdict, class kept, Swedish reason (%s)', async (failureClass, expectedStatus) => {
    resolveOrDeriveMock.mockRejectedValue(new LocalizationGeometryCurrentnessError(failureClass, 'technical detail'));
    const report = await runReport();
    const analysis = report.siteAnalyses[0]!;

    expect(kernelMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(analysis.executionMotor).toMatchObject({
      admitted: false,
      assessment_artifact_id: null,
      assessment_status: expectedStatus,
      reason_codes: ['LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED', `LOCALIZATION_GEOMETRY_${failureClass}`],
      localization_geometry: {
        status: 'FAILED_CLOSED', artifact_id: null, provenance: null,
        failure_class: failureClass, reason_code: `LOCALIZATION_GEOMETRY_${failureClass}`,
      },
    });
    expect(analysis.executionMotor?.localization_geometry?.message_sv).toMatch(/ingen bedömning görs/i);
    expect(analysis.executionMotor?.governed_layer_checks).toBeUndefined();
    // No verdict: the verdict-bearing fields are absent, not zeroed.
    expect('overallRisk' in analysis.complianceAnalysis).toBe(false);
    expect('permitProbability' in analysis.complianceAnalysis).toBe(false);
    expect(analysis.warnings.some((w) => w.startsWith('Lokalisering: ') && /ingen bedömning görs/i.test(w))).toBe(true);
    expect(report.summary.bestAlternativeId).toBeUndefined();
  });
});

describe('D9(a) + U12 through generate-report: successful run keeps provenance and honest coverage', () => {
  it('derived-on-NOT_FOUND geometry -> provenance carried; governed layer checks distinguish hit / no hit / not checked; legacy block labelled', async () => {
    resolveOrDeriveMock.mockResolvedValue({
      geometry: { artifact_id: 'localization-geometry-derived', artifact_type: 'localization_geometry', payload: { provenance: 'derived_from_property_boundary' } },
      wasDerived: true,
      provenanceRecord: resolvedGeometryProvenanceRecord({
        artifactId: 'localization-geometry-derived', provenance: 'derived_from_property_boundary', derivedInThisRequest: true,
      }),
    });
    const report = await runReport();
    const analysis = report.siteAnalyses[0]!;

    expect(analysis.executionMotor).toMatchObject({
      assessment_status: 'ASSESSED',
      localization_geometry: {
        status: 'RESOLVED', artifact_id: 'localization-geometry-derived',
        provenance: 'derived_from_property_boundary', derived_in_this_request: true, failure_class: null,
      },
    });
    expect(analysis.executionMotor?.governed_layer_checks).toEqual([
      { layer: 'water', rule_id: 'LU-WATER-001', status: 'CHECKED_HIT', evidence_artifact_id: 'evidence-water-x', reason: null },
      { layer: 'ebh', rule_id: 'LU-EBH-001', status: 'CHECKED_NO_HIT', evidence_artifact_id: 'evidence-ebh-x', reason: null },
      { layer: 'protected_area', rule_id: 'LU-PROTECTED-001', status: 'NOT_CHECKED', evidence_artifact_id: null, reason: 'TABLE_MISSING' },
      { layer: 'natura2000', rule_id: 'LU-NATURA2000-001', status: 'CHECKED_NO_HIT', evidence_artifact_id: 'evidence-natura2000-x', reason: null },
      { layer: 'water_protection_area', rule_id: 'LU-WATERPROTECTION-001', status: 'NOT_CHECKED', evidence_artifact_id: null, reason: 'NO_EVIDENCE' },
      // K0: the document check is appended. This file's kernel mock returns an assessment without a
      // payload, so its pinned evidence refs cannot be read -> NOT_CHECKED, never a no-hit.
      expect.objectContaining({ layer: 'document', rule_id: 'LU-DOC-BESLUT-001', status: 'NOT_CHECKED', evidence_artifact_id: null, reason: 'PINNED_EVIDENCE_REFS_UNREADABLE' }),
    ]);
    // NOT_CHECKED stays structured data, untouched: the finding and unresolvedChecks are still there.
    expect(analysis.executionMotor?.findings.some((f) => f.risk_level === 'NOT_CHECKED')).toBe(true);
    expect((analysis.complianceAnalysis as { unresolvedChecks?: unknown[] }).unresolvedChecks).toEqual([
      { rule_id: 'LU-PROTECTED-001', finding_id: 'finding-notchecked-protected_area' },
    ]);
    // U12 (2): the older spatialAudit observation is explicitly labelled as legacy, never as governed.
    expect(analysis.spatialAuditProvenance).toMatchObject({ source: 'legacy_observation', governed: false });
    const legacyWarnings = analysis.warnings.filter((w) => w.includes('kunde inte verifieras i lokal databas'));
    expect(legacyWarnings.length).toBeGreaterThan(0);
    expect(legacyWarnings.every((w) => w.startsWith(LEGACY_SPATIAL_AUDIT_PREFIX_SV))).toBe(true);
  });
});

describe('U12 computeGovernedLayerChecks (pure)', () => {
  it('silence is never "checked": a requested layer with no evidence and no unavailable entry is NOT_CHECKED', () => {
    expect(computeGovernedLayerChecks({ requestedLayers: ['water'], evidence: [], unavailableLayers: [], findings: [] })).toEqual([
      { layer: 'water', rule_id: 'LU-WATER-001', status: 'NOT_CHECKED', evidence_artifact_id: null, reason: 'NO_EVIDENCE' },
    ]);
  });

  it('a NOT_CHECKED finding for the layer rule wins over evidence', () => {
    const [check] = computeGovernedLayerChecks({
      requestedLayers: ['ebh'], evidence: [evidence('ebh', false)], unavailableLayers: [],
      findings: [{ rule_id: 'LU-EBH-001', risk_level: 'NOT_CHECKED' }],
    });
    expect(check).toMatchObject({ status: 'NOT_CHECKED', reason: 'NOT_CHECKED_FINDING' });
  });

  it('an evidence result without a boolean `exists` is NOT_CHECKED (UNRECOGNIZED_RESULT), never no-hit', () => {
    const weird = { artifact_id: 'evidence-water-y', payload: { source_metadata: { dataset: 'water' }, result_semantics: { result: {} } } };
    const [check] = computeGovernedLayerChecks({ requestedLayers: ['water'], evidence: [weird], unavailableLayers: [], findings: [] });
    expect(check).toMatchObject({ status: 'NOT_CHECKED', reason: 'UNRECOGNIZED_RESULT' });
  });
});

/**
 * M1a verification F4: when the run fails AFTER the geometry step (release, provider, kernel...),
 * the generic failure branch must still report which localization geometry this request resolved
 * or derived -- in particular a centroid derived in this very request. A failure BEFORE the
 * geometry step reports none (nothing is invented).
 */
describe('F4: a failure after the geometry step keeps localization_geometry', () => {
  it('centroid derived in this request, then the kernel throws -> EXECUTION_FAILED that still reports the derived point', async () => {
    resolveOrDeriveMock.mockResolvedValue({
      geometry: { artifact_id: 'localization-geometry-derived', artifact_type: 'localization_geometry', payload: { provenance: 'derived_from_property_boundary' } },
      wasDerived: true,
      provenanceRecord: resolvedGeometryProvenanceRecord({
        artifactId: 'localization-geometry-derived', provenance: 'derived_from_property_boundary', derivedInThisRequest: true,
      }),
    });
    kernelMock.mockRejectedValue(new Error('kernel exploded'));
    const analysis = (await runReport()).siteAnalyses[0]!;

    expect(analysis.executionMotor).toMatchObject({
      admitted: false,
      assessment_status: 'EXECUTION_FAILED',
      reason_codes: ['EXECUTION_KERNEL_ERROR'],
      assessment_artifact_id: null,
      localization_geometry: {
        status: 'RESOLVED', artifact_id: 'localization-geometry-derived',
        provenance: 'derived_from_property_boundary', derived_in_this_request: true, failure_class: null,
      },
    });
    expect('overallRisk' in analysis.complianceAnalysis).toBe(false);
  });

  it('existing current point, then the spatial provider throws -> the resolved point is still reported (not derived)', async () => {
    resolveOrDeriveMock.mockResolvedValue({
      geometry: { artifact_id: 'localization-geometry-user', artifact_type: 'localization_geometry', payload: { provenance: 'user_defined' } },
      wasDerived: false,
    });
    queryMock.mockRejectedValue(new Error('provider down'));
    const analysis = (await runReport()).siteAnalyses[0]!;

    expect(kernelMock).not.toHaveBeenCalled();
    expect(analysis.executionMotor).toMatchObject({
      assessment_status: 'EXECUTION_FAILED',
      reason_codes: ['EXECUTION_KERNEL_ERROR'],
      localization_geometry: { status: 'RESOLVED', artifact_id: 'localization-geometry-user', provenance: 'user_defined', derived_in_this_request: false },
    });
  });

  it('a failure before the geometry step reports no geometry at all', async () => {
    const { resolveCanonicalProjectContext } = await import('../../src/application/resolveCanonicalProjectContext');
    vi.mocked(resolveCanonicalProjectContext).mockRejectedValueOnce(new Error('context unavailable'));
    const analysis = (await runReport()).siteAnalyses[0]!;

    expect(resolveOrDeriveMock).not.toHaveBeenCalled();
    expect(analysis.executionMotor?.assessment_status).toBe('EXECUTION_FAILED');
    expect(analysis.executionMotor?.localization_geometry).toBeUndefined();
  });
});
