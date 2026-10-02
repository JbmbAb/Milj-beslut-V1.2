/**
 * K0 (DOC-EVIDENCE-CENSUS 2026-10-02) through the real GenerateLocalizationReportUseCase.
 *
 * K0a: without explicit, governed document refs no document evidence may be created, sent in the
 * API response or handed to the assessment -- even when DocumentRecord rows exist for the
 * municipality the property lies in. The former presentation-only fallback swept those rows and
 * packaged them as DOCUMENT_EVIDENCE with random ids and content_hash "uncalculated".
 *
 * Hermetic: server/db/prisma is replaced by a FAKE database that has two DocumentRecords for the
 * resolved municipality (so the old sweep has something to find) and that throws/records on every
 * other access. Nothing here can reach a real Postgres. The `orchestrator` the old fallback called
 * (LUBackendOrchestrator.generateDocumentEvidence) no longer exists (K0-FIX-1 b); the cases below
 * still set LU_DOC_PROVIDER to every former value to show none of them brings document evidence back.
 *
 * Mock layout follows tests/unit/luGeometryCurrentnessD9aUsecase.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeDb = vi.hoisted(() => ({
  calls: [] as string[],
  rows: [
    {
      id: 'docrec-haninge-1',
      subject: 'Bygglovsbeslut Haninge K0-SENTINEL',
      originalName: 'beslut-1.pdf',
      municipalityNormalized: 'Haninge',
      diskName: 'MBN 2026-0001',
      decisionType: 'unknown',
      chunks: [{ chunkText: 'K0-SENTINEL chunk text from an e-mail attachment' }],
    },
    {
      id: 'docrec-haninge-2',
      subject: null,
      originalName: 'K0-SENTINEL-attachment.pdf',
      municipalityNormalized: 'Haninge',
      diskName: 'MBN 2026-0002',
      decisionType: null,
      chunks: [],
    },
  ],
}));

vi.mock('../../server/db/prisma', () => {
  const documentRecord = {
    findMany: async () => {
      fakeDb.calls.push('documentRecord.findMany');
      return fakeDb.rows;
    },
  };
  const prisma = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === 'symbol' || property === 'then') return undefined;
        if (property === '$queryRawUnsafe') {
          return async () => {
            fakeDb.calls.push('$queryRawUnsafe');
            return [{ kommunnamn: 'Haninge' }];
          };
        }
        if (property === 'documentRecord') return documentRecord;
        fakeDb.calls.push(`prisma.${String(property)}`);
        throw new Error(`HERMETIC_TEST_GUARD: unexpected database access (prisma.${String(property)})`);
      },
    },
  );
  return { prisma, Prisma: {} };
});

const kernelMock = vi.fn();
const resolveOrDeriveMock = vi.fn();
const releaseMock = vi.fn();

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
    protectedAreaHits: [],
    protectedAreaAvailable: true,
    protectedAreaWarning: undefined,
    isProtected: false,
    sgu: { manualReviewRequired: false, summary: 'ok' },
    distanceToWaterMeters: null,
    distanceToWaterAvailable: true,
    distanceToWaterWarning: undefined,
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
    geometry: { type: 'Polygon', coordinates: [[[18.1, 59.2], [18.2, 59.2], [18.2, 59.3], [18.1, 59.2]]] },
  })),
}));
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({
  resolveCanonicalProductRelease: (...args: unknown[]) => releaseMock(...args),
}));
vi.mock('../../server/modules/localization/localizationGeometryService', () => ({
  resolveOrDeriveCurrentLocalizationGeometry: (...args: unknown[]) => resolveOrDeriveMock(...args),
}));

import { resolvedGeometryProvenanceRecord } from '../../server/modules/localization/localizationGeometryCurrentness';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';

const SITE = { id: 'site-k0', name: 'Alternativ A', lat: 59.17, lng: 18.14 };

function spatialEvidence(layer: string, exists: boolean) {
  return {
    artifact_id: `evidence-${layer}-k0`,
    artifact_type: 'SPATIAL_EVIDENCE',
    payload: { source_metadata: { dataset: layer }, result_semantics: { result: { exists } } },
  };
}

const queryMock = vi.fn();
function runtime() {
  return {
    artifactRepository: { put: vi.fn(async () => undefined), resolve: vi.fn(async () => { throw new Error('nope'); }) },
    resolveSpatialProvider: vi.fn(() => ({ query: queryMock })),
    sweref99ToWgs84: vi.fn(async () => [59.17, 18.14] as const),
    close: vi.fn(async () => undefined),
  };
}

async function runReport(site: typeof SITE = SITE) {
  return new GenerateLocalizationReportUseCase(async () => runtime() as never).execute({ projectId: 'proj-k0', siteAlternatives: [site] });
}

const ORIGINAL_LU_DOC_PROVIDER = process.env.LU_DOC_PROVIDER;

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.calls.length = 0;
  releaseMock.mockResolvedValue({
    artifact_id: 'product-release-1', artifact_type: 'product_release_manifest', release_hash: { value: 'a'.repeat(64) },
  });
  resolveOrDeriveMock.mockResolvedValue({
    geometry: { artifact_id: 'localization-geometry-derived', artifact_type: 'localization_geometry', payload: { provenance: 'derived_from_property_boundary' } },
    wasDerived: true,
    provenanceRecord: resolvedGeometryProvenanceRecord({
      artifactId: 'localization-geometry-derived', provenance: 'derived_from_property_boundary', derivedInThisRequest: true,
    }),
  });
  queryMock.mockResolvedValue({
    evidence: [spatialEvidence('water', false), spatialEvidence('ebh', false)],
    unavailable_layers: [],
  });
  kernelMock.mockImplementation(async (input: { assessment_draft: { evidence_refs: unknown[] } }) => ({
    admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1',
    findings: [], finding_ids: [],
    assessment: { artifact_id: 'assessment-k0', payload: { evidence_refs: input.assessment_draft.evidence_refs } },
  }));
});

afterEach(() => {
  if (ORIGINAL_LU_DOC_PROVIDER === undefined) delete process.env.LU_DOC_PROVIDER;
  else process.env.LU_DOC_PROVIDER = ORIGINAL_LU_DOC_PROVIDER;
});

describe('K0a: no ungoverned document evidence without explicit governed refs', () => {
  it.each<[string, string | undefined]>([
    ['unset (the old default selected postgis)', undefined],
    ['postgis (explicit)', 'postgis'],
    ['mock (explicit, test mode)', 'mock'],
  ])('LU_DOC_PROVIDER=%s and DocumentRecords exist for the municipality -> no document evidence in the response or the assessment', async (_label, value) => {
    if (value === undefined) delete process.env.LU_DOC_PROVIDER;
    else process.env.LU_DOC_PROVIDER = value;

    const report = await runReport();
    const analysis = report.siteAnalyses[0]!;

    // The run itself is a normal governed run (so the absence below is not a side effect of failure).
    expect(analysis.executionMotor?.assessment_status).toBe('ASSESSED');

    // API response: no document evidence at all, and nothing of the old packaging.
    expect(analysis.documentEvidence).toEqual([]);
    const wire = JSON.stringify(report);
    for (const forbidden of ['uncalculated', 'mock-doc-hash', 'doc_ev_', 'K0-SENTINEL', 'Haninge', 'MockDocumentProvider', 'PostgisDocumentProvider', 'MÖD 2018:14']) {
      expect(wire).not.toContain(forbidden);
    }

    // No municipality sweep: neither the municipality lookup nor the DocumentRecord query ran.
    expect(fakeDb.calls).toEqual([]);

    // Assessment input: nothing document-shaped reaches the kernel or the pinned evidence refs.
    expect(kernelMock).toHaveBeenCalledTimes(1);
    const kernelInput = kernelMock.mock.calls[0]![0] as {
      document_evidence: unknown[];
      verified_document_facts: unknown[];
      assessment_draft: { evidence_refs: Array<{ artifact_type: string }>; system_summary: string };
    };
    expect(kernelInput.document_evidence).toEqual([]);
    expect(kernelInput.verified_document_facts).toEqual([]);
    expect(kernelInput.assessment_draft.evidence_refs.map((r) => r.artifact_type)).toEqual(['SPATIAL_EVIDENCE', 'SPATIAL_EVIDENCE']);
    expect(kernelInput.assessment_draft.system_summary).toContain('0 document evidence');
  });
});

/**
 * K0b: the machine-readable document check in the fresh generate-report response, derived from the
 * PINNED evidence refs of the persisted assessment (kernelResult.assessment.payload.evidence_refs).
 * tests/unit/luDocumentCheckReadModel.test.ts asserts the same object for the read-back and the PDF.
 */
const DOCUMENT_NOT_CHECKED = {
  layer: 'document',
  rule_id: 'LU-DOC-BESLUT-001',
  status: 'NOT_CHECKED',
  evidence_artifact_id: null,
  reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED',
} as const;

function documentCheckOf(report: Awaited<ReturnType<typeof runReport>>) {
  const checks = (report.siteAnalyses[0]!.executionMotor?.governed_layer_checks ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
  return checks.filter((c) => c.layer === 'document');
}

describe('K0b: document check in the fresh generate-report response', () => {
  it('no governed document refs -> exactly one "document" check: NOT_CHECKED, NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED, never no-hit', async () => {
    const report = await runReport();
    const analysis = report.siteAnalyses[0]!;
    expect(analysis.executionMotor?.assessment_status).toBe('ASSESSED');

    const [check, ...more] = documentCheckOf(report);
    expect(more).toEqual([]);
    expect(check).toMatchObject(DOCUMENT_NOT_CHECKED);
    expect(check!.message_sv).toMatch(/^Dokument och tidigare beslut: inte kontrollerat\./);
    expect(check!.status).not.toBe('CHECKED_NO_HIT');

    // Presentation on top, never a replacement: the spatial checks are all still there, and the
    // document check adds no finding and no unresolved check (no rule-level NOT_CHECKED, OD-DOC-3).
    const layers = (analysis.executionMotor?.governed_layer_checks ?? []).map((c) => c.layer);
    expect(layers).toEqual(['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area', 'document']);
    expect(analysis.executionMotor?.findings).toEqual([]);
    expect((analysis.complianceAnalysis as { unresolvedChecks?: unknown[] }).unresolvedChecks).toEqual([]);
  });

  it('is derived from the persisted assessment\'s PINNED refs, not from the request draft', async () => {
    // The request selected no documents (draft refs are spatial only) but the persisted artifact pins
    // DOCUMENT_EVIDENCE + VERIFIED_DOCUMENT_FACT: the check follows the artifact.
    kernelMock.mockImplementationOnce(async (input: { assessment_draft: { evidence_refs: unknown[] } }) => ({
      admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1',
      findings: [], finding_ids: [],
      assessment: {
        artifact_id: 'assessment-k0-pinned',
        payload: {
          evidence_refs: [
            ...input.assessment_draft.evidence_refs,
            { artifact_id: 'doc-evidence-b', artifact_type: 'DOCUMENT_EVIDENCE' },
            { artifact_id: 'doc-evidence-a', artifact_type: 'DOCUMENT_EVIDENCE' },
            { artifact_id: 'verified-fact-1', artifact_type: 'VERIFIED_DOCUMENT_FACT' },
          ],
        },
      },
    }));
    const report = await runReport();
    const draftRefs = (kernelMock.mock.calls[0]![0] as { assessment_draft: { evidence_refs: Array<{ artifact_type: string }> } })
      .assessment_draft.evidence_refs;
    expect(draftRefs.some((r) => r.artifact_type === 'DOCUMENT_EVIDENCE')).toBe(false);

    expect(documentCheckOf(report)).toEqual([
      expect.objectContaining({
        layer: 'document', rule_id: 'LU-DOC-BESLUT-001', status: 'CHECKED_HIT',
        evidence_artifact_id: 'doc-evidence-a', reason: null,
      }),
    ]);
  });

  it('a run without a governed assessment gets no invented document check (governed_layer_checks stays absent)', async () => {
    kernelMock.mockResolvedValueOnce({
      admitted: false, reason_codes: ['CAPABILITY_DENIED'], attempt_id: null, outcome_id: null, manifest_id: null,
      findings: [], finding_ids: [], assessment: null,
    });
    const report = await runReport();
    expect(report.siteAnalyses[0]!.executionMotor?.assessment_status).toBe('GOVERNANCE_DENIED');
    expect(report.siteAnalyses[0]!.executionMotor?.governed_layer_checks).toBeUndefined();
  });
});
