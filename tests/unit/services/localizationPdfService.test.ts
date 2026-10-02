import { describe, it, expect, vi } from 'vitest';
import { buildLocalizationPdfData } from '../../../server/services/localizationPdfService';
import type { LocalizationReport, SiteAnalysisResult } from '../../../server/services/localizationReportService';

// Hermetic: the projection is pure; the real database client is never evaluated.
vi.mock('../../../server/db/prisma', async () => (await import('../../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

// ── Byggstenar ─────────────────────────────────────────────────────────────

function makeSite(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Plats ${id}`,
    lat: 59.33,
    lng: 18.07,
    ...overrides,
  };
}

/**
 * U20-C: the older, ungoverned observations reach this projection only through their own labelled
 * block (`legacyObservations`, governed: false), never through top-level site fields.
 */
function makeLegacy(overrides: Record<string, unknown> = {}): NonNullable<SiteAnalysisResult['legacyObservations']> {
  // Fixture objects (monuments with only id/name, etc.) are deliberately partial.
  return {
    governed: false as const,
    source: 'legacy_observation' as const,
    version: 'v1' as const,
    note_sv: 'Äldre observationer (test).',
    sourceAvailability: { spatialAudit: true, nvr: true, raa: true, viss: true, slu: true },
    protectedArea: { available: true, isProtected: false, hitNames: [] as string[] },
    distanceToWater: { available: true, meters: null as number | null },
    monuments: [] as Array<{ name: string }>,
    vissWaterStatus: null,
    sluObservationCount: 0,
    dataSources: [],
    warnings: [] as string[],
    restrictions: [] as string[],
    rules: [],
    ...overrides,
  } as unknown as NonNullable<SiteAnalysisResult['legacyObservations']>;
}

function makeCompliance(siteId: string, overrides: Record<string, unknown> = {}) {
  return {
    overallRisk: 'LOW' as const,
    permitProbability: 0.8,
    // LU_VERDICT_TYPE_BOUNDARY_V1 — the discriminant that entitles this analysis to carry a
    // verdict at all. Without it the projection reads a non-verdict variant, and the verdict
    // fields above are unreachable.
    assessment_status: 'ASSESSED' as const,
    restrictions: [],
    rules: [],
    summary: `Sammanfattning ${siteId}`,
    // Required on a governed verdict since SEM-1 (W2); the fixture omitted it.
    unresolvedChecks: [],
    ...overrides,
  };
}

/**
 * P3-LU-CANONICAL-CHAIN-01 — a site bearing a verdict must also bear the governed assessment
 * that entitles it to one. `executionMotor` is no longer optional decoration: the PDF reads
 * `assessment_status` to decide whether a risk figure may be rendered at all.
 */
function makeExecutionMotor(id: string, overrides: Record<string, unknown> = {}) {
  return {
    admitted: true,
    reason_codes: [],
    attempt_id: `attempt-${id}`,
    outcome_id: `outcome-${id}`,
    manifest_id: `manifest-${id}`,
    ticket_id: null,
    finding_ids: [],
    assessment_artifact_id: `assessment-${id}`,
    assessment_projection_registered: true,
    property_context_id: `prop-${id}`,
    assessment_status: 'ASSESSED' as const,
    findings: [],
    ...overrides,
  };
}

function makeSiteAnalysis(id: string, overrides: Record<string, unknown> = {}) {
  return {
    site: makeSite(id),
    complianceAnalysis: makeCompliance(id),
    warnings: [],
    legacyObservations: makeLegacy(),
    executionMotor: makeExecutionMotor(id),
    ...overrides,
  };
}

function makeReport(overrides: Partial<LocalizationReport> = {}): LocalizationReport {
  return {
    projectId: 'proj-test',
    generatedAt: '2026-05-21T10:00:00.000Z',
    siteAnalyses: [makeSiteAnalysis('alt-1')],
    summary: {
      bestAlternativeId: 'alt-1',
      reasoning: 'Minst risk',
      // Required since P3-LU-CANONICAL-CHAIN-01: the projection reports how much of the
      // candidate set was actually assessed, so a winner drawn from a subset cannot read as
      // best of all alternatives.
      comparison_status: 'COMPLETE' as const,
      assessed_site_ids: ['alt-1'],
      not_ranked_site_ids: [],
      unassessed_site_ids: [],
    },
    warnings: [],
    humanInTheLoop: 'Granska innan beslut.',
    ...overrides,
  };
}

// ── Tester ─────────────────────────────────────────────────────────────────

describe('buildLocalizationPdfData', () => {
  it('mappar toppnivåfält korrekt', () => {
    const pdf = buildLocalizationPdfData(makeReport());
    expect(pdf.projectId).toBe('proj-test');
    expect(pdf.generatedAt).toBe('2026-05-21T10:00:00.000Z');
    expect(pdf.humanInTheLoop).toBe('Granska innan beslut.');
    expect(pdf.title).toContain('Lokaliseringsutredning');
    expect(pdf.disclaimer).toContain('Human in the Loop');
  });

  it('mappar summary korrekt', () => {
    const pdf = buildLocalizationPdfData(makeReport());
    expect(pdf.summary.bestAlternativeId).toBe('alt-1');
    expect(pdf.summary.reasoning).toBe('Minst risk');
  });

  /**
   * P3-LU-CANONICAL-CHAIN-01 — this test previously asserted the opposite, that an absent
   * winner was rendered as the string 'N/A'. That reads in the finished document as though a
   * comparison had been carried out and produced nothing, which is itself a claim. When no
   * site carries a governed assessment the key is omitted entirely.
   */
  it('utelämnar bestAlternativeId helt när ingen plats är bedömd', () => {
    const report = makeReport({
      summary: {
        reasoning: 'Ingen rangordning tillgänglig',
        comparison_status: 'UNAVAILABLE' as const,
        assessed_site_ids: [],
        not_ranked_site_ids: [],
        unassessed_site_ids: ['alt-1'],
      },
    });
    const pdf = buildLocalizationPdfData(report);

    expect(Object.prototype.hasOwnProperty.call(pdf.summary, 'bestAlternativeId')).toBe(false);
    expect(pdf.summary.comparison_status).toBe('UNAVAILABLE');
    expect(JSON.stringify(pdf.summary)).not.toMatch(/N\/A|undefined|null/);
  });

  it('bär comparison_status och rangordningspopulation vidare', () => {
    const pdf = buildLocalizationPdfData(makeReport());
    expect(pdf.summary.comparison_status).toBe('COMPLETE');
    expect(pdf.summary.assessed_site_ids).toEqual(['alt-1']);
    expect(pdf.summary.unassessed_site_ids).toEqual([]);
    // U20CDF4 (owner decision 2026-10-03 (4) point 4).
    expect(pdf.summary.not_ranked_site_ids).toEqual([]);
  });

  it('U20CDF4: not_ranked_site_ids is carried; a report of the older shape (compatibility field only) still builds and gets no fabricated list', () => {
    const report = makeReport({
      summary: { reasoning: 'x', comparison_status: 'PARTIAL' as const, assessed_site_ids: ['alt-1'], not_ranked_site_ids: ['alt-2'], unassessed_site_ids: ['alt-3'] },
    });
    expect(buildLocalizationPdfData(report).summary).toMatchObject({ assessed_site_ids: ['alt-1'], not_ranked_site_ids: ['alt-2'], unassessed_site_ids: ['alt-3'] });
    const older = makeReport({ summary: { reasoning: 'x', comparison_status: 'COMPLETE' as const, assessed_site_ids: ['alt-1'], unassessed_site_ids: [] } as never });
    const pdf = buildLocalizationPdfData(older);
    expect(pdf.summary.unassessed_site_ids).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(pdf.summary, 'not_ranked_site_ids')).toBe(false);
  });

  it('U20CDF4: a not_ranked_site_ids that is not a list is refused like the other coverage fields', () => {
    const report = makeReport({
      summary: { reasoning: 'x', comparison_status: 'COMPLETE' as const, assessed_site_ids: ['alt-1'], not_ranked_site_ids: 'alt-2', unassessed_site_ids: [] } as never,
    });
    expect(() => buildLocalizationPdfData(report)).toThrow(/coverage fields required/);
  });

  it('utelämnar verdict-fält för en plats utan governad bedömning', () => {
    const report = makeReport({
      siteAnalyses: [
        makeSiteAnalysis('alt-1', {
          complianceAnalysis: {
            restrictions: [],
            rules: [],
            summary: 'ej bedömd',
            assessment_status: 'GOVERNANCE_DENIED' as const,
          },
          executionMotor: makeExecutionMotor('alt-1', {
            admitted: false,
            reason_codes: ['CAPABILITY_DENIED'],
            assessment_artifact_id: null,
            assessment_status: 'GOVERNANCE_DENIED' as const,
          }),
        }),
      ],
      summary: {
        reasoning: 'Ingen rangordning tillgänglig',
        comparison_status: 'UNAVAILABLE' as const,
        assessed_site_ids: [],
        not_ranked_site_ids: [],
        unassessed_site_ids: ['alt-1'],
      },
    });
    const site = buildLocalizationPdfData(report).sites[0];

    expect(Object.prototype.hasOwnProperty.call(site, 'overallRisk')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(site, 'permitProbability')).toBe(false);
    expect(site.assessment_status).toBe('GOVERNANCE_DENIED');
    expect(site.assessment_artifact_id).toBeNull();
  });

  it('vidarebefordrar reportWarnings', () => {
    const report = makeReport({ warnings: ['Källa otillgänglig'] });
    const pdf = buildLocalizationPdfData(report);
    expect(pdf.reportWarnings).toContain('Källa otillgänglig');
  });

  describe('platsdata', () => {
    it('mappar grundfält för en plats', () => {
      const pdf = buildLocalizationPdfData(makeReport());
      const site = pdf.sites[0];
      expect(site.id).toBe('alt-1');
      expect(site.name).toBe('Plats alt-1');
      expect(site.lat).toBe(59.33);
      expect(site.lng).toBe(18.07);
      expect(site.overallRisk).toBe('LOW');
      expect(site.permitProbability).toBe(0.8);
    });

    it('W2b: en SEM-1 NOT_CHECKED-bedömning (permitProbability: null) utelämnar permitProbability och bär status/text/unresolvedChecks istället, aldrig 0 eller ett fabricerat tal', () => {
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            complianceAnalysis: makeCompliance('alt-1', {
              permitProbability: null,
              unresolvedChecks: [{ rule_id: 'LU-WATER-001', finding_id: 'finding-notchecked-water' }],
            }),
          }),
        ],
      });
      const site = buildLocalizationPdfData(report).sites[0];

      // The exact regression this guards against: null must never render as 0, and it must never
      // be a raw string in the number field either -- P3's own "absence, not a placeholder" rule
      // applies here too. permitProbability is OFF the object; structured fields replace it.
      expect(Object.prototype.hasOwnProperty.call(site, 'permitProbability')).toBe(false);
      expect(site.permitProbability).not.toBe(0);
      expect(site.permitProbabilityStatus).toBe('NOT_CHECKED');
      expect(site.permitProbabilityText).toBe('kan inte anges');
      expect(site.unresolvedChecks).toEqual([{ ruleId: 'LU-WATER-001', findingId: 'finding-notchecked-water' }]);
      // SEM-1: NOT_CHECKED is a non-severity state, not an absent verdict -- overallRisk is still
      // present and meaningful even though no permit-probability number was computed.
      expect(site.overallRisk).toBe('LOW');
    });

    it('W3a: a site whose legacy engine contributed restrictions/rules carries a visible legacy-observation label (SEM-2/SEM-3, Q2)', () => {
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            legacyObservations: makeLegacy({ restrictions: ['Naturreservat'] }),
          }),
        ],
      });
      const site = buildLocalizationPdfData(report).sites[0];

      expect(site.restrictions).toEqual(['Naturreservat']);
      expect(site.legacyObservationLabel).toBeTruthy();
      expect(typeof site.legacyObservationLabel).toBe('string');
    });

    it('W3a: a site with no legacy restrictions or rules carries no legacy-observation label', () => {
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            legacyObservations: makeLegacy({ restrictions: [], rules: [] }),
          }),
        ],
      });
      const site = buildLocalizationPdfData(report).sites[0];

      expect(Object.prototype.hasOwnProperty.call(site, 'legacyObservationLabel')).toBe(false);
    });

    it('fallback till "Namnlöst alternativ" när name saknas', () => {
      const report = makeReport({
        siteAnalyses: [makeSiteAnalysis('x', { site: makeSite('x', { name: undefined }) })],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].name).toBe('Namnlöst alternativ');
    });

    it('trunkerar monument till max 5 namn', () => {
      const monuments = Array.from({ length: 8 }, (_, i) => ({ name: `Fornl ${i}`, id: `m${i}` }));
      const report = makeReport({
        siteAnalyses: [makeSiteAnalysis('alt-1', { legacyObservations: makeLegacy({ monuments }) })],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].legacyObservations.monuments).toMatchObject({ available: true, status_sv: 'tillgänglig', count: 8 });
      expect(pdf.sites[0].legacyObservations.monuments.names).toHaveLength(5);
    });

    it('trunkerar skyddade områden till max 5', () => {
      const hitNames = Array.from({ length: 7 }, (_, i) => `Område ${i}`);
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            legacyObservations: makeLegacy({ protectedArea: { available: true, isProtected: true, hitNames } }),
          }),
        ],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].legacyObservations.protectedArea.isProtected).toBe(true);
      expect(pdf.sites[0].legacyObservations.protectedArea.names).toHaveLength(5);
    });

    it('U20-C: skyddade områdens namn kommer oförändrade ur legacy-blocket (namnlösa sätts redan där)', () => {
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            legacyObservations: makeLegacy({ protectedArea: { available: true, isProtected: true, hitNames: ['Namnlöst område'] } }),
          }),
        ],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].legacyObservations.protectedArea.names[0]).toBe('Namnlöst område');
    });
  });

  describe('VISS-data', () => {
    it('null vissWaterStatus ger null-fält', () => {
      const pdf = buildLocalizationPdfData(makeReport());
      const site = pdf.sites[0];
      expect(site.legacyObservations.viss).toEqual({
        available: true, status_sv: 'tillgänglig', waterName: null, ecologicalStatus: null, chemicalStatus: null,
      });
    });

    it('mappar vissWaterStatus korrekt', () => {
      const viss = {
        waterName: 'Fyrisån',
        ecologicalStatus: 'GOD',
        chemicalStatus: 'GOD',
        waterBody: 'SE999',
        typeCode: 'WB1',
      };
      const report = makeReport({
        siteAnalyses: [makeSiteAnalysis('alt-1', { legacyObservations: makeLegacy({ vissWaterStatus: viss }) })],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].legacyObservations.viss).toEqual({
        available: true, status_sv: 'tillgänglig', waterName: 'Fyrisån', ecologicalStatus: 'GOD', chemicalStatus: 'GOD',
      });
    });
  });

  describe('rules-mappning', () => {
    it('mappar den äldre regelmotorns regler ur legacy-blocket (U20-C; inte ur complianceAnalysis)', () => {
      const rules = [
        {
          ruleId: 'MB-2-3',
          chapter: 'MB 2:3',
          title: 'Försiktighetsprincipen',
          risk: 'MEDIUM' as const,
          description: 'Kräver försiktig hantering',
          recommendation: 'Utför MKB',
        },
      ];
      const report = makeReport({
        siteAnalyses: [makeSiteAnalysis('alt-1', { legacyObservations: makeLegacy({ rules }) })],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].rules[0].ruleId).toBe('MB-2-3');
      expect(pdf.sites[0].rules[0].chapter).toBe('MB 2:3');
    });
  });

  describe('U20-C: styrt och ostyrt hålls isär i den äldre rapportvägen', () => {
    it('svaret säger själv vad som är styrt och vad som är äldre, ostyrd observation', () => {
      const pdf = buildLocalizationPdfData(makeReport());
      expect(pdf.governance_note_sv).toMatch(/Äldre rapportväg/);
      expect(pdf.governance_note_sv).toMatch(/inte är styrd evidens/);
    });

    it('bär de styrda lagerkontrollerna (dokumentkontrollen inräknad) och den kvalificerade helhetstexten', () => {
      const checks = [
        { layer: 'water', rule_id: 'LU-WATER-001', status: 'CHECKED_NO_HIT', evidence_artifact_id: 'e1', reason: null },
        { layer: 'document', rule_id: 'LU-DOC-BESLUT-001', status: 'NOT_CHECKED', evidence_artifact_id: null, reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED' },
      ];
      const statement = 'Låg risk i de kontroller som utfördes; underlaget är ofullständigt: 1 av 2 kontroller genomförda.';
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            complianceAnalysis: makeCompliance('alt-1', { summary: statement }),
            executionMotor: makeExecutionMotor('alt-1', { governed_layer_checks: checks }),
          }),
        ],
      });
      const site = buildLocalizationPdfData(report).sites[0];
      expect(site.governed_layer_checks).toEqual(checks);
      expect(site.overall_statement_sv).toBe(statement);
    });

    it('utan styrd bedömning: ingen helhetstext, lagerkontroller null', () => {
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            complianceAnalysis: { assessment_status: 'EXECUTION_FAILED', restrictions: [], rules: [], summary: 'x' },
            executionMotor: makeExecutionMotor('alt-1', { assessment_status: 'EXECUTION_FAILED', assessment_artifact_id: null }),
          }),
        ],
        summary: { reasoning: 'x', comparison_status: 'UNAVAILABLE', assessed_site_ids: [], not_ranked_site_ids: [], unassessed_site_ids: ['alt-1'] },
      });
      const site = buildLocalizationPdfData(report).sites[0];
      expect(Object.prototype.hasOwnProperty.call(site, 'overall_statement_sv')).toBe(false);
      expect(site.governed_layer_checks).toBeNull();
    });

    it('styrda varningar först, därefter de märkta äldre', () => {
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            warnings: ['ExecutionKernel denied: X'],
            legacyObservations: makeLegacy({ warnings: ['Äldre observation (ingår inte i den styrda bedömningen): VISS: x'] }),
          }),
        ],
      });
      expect(buildLocalizationPdfData(report).sites[0].warnings).toEqual([
        'ExecutionKernel denied: X',
        'Äldre observation (ingår inte i den styrda bedömningen): VISS: x',
      ]);
    });

    it('U20CDF (F4): de äldre observationerna är ett eget block med governed:false -- aldrig utplattade i platsfälten', () => {
      const site = buildLocalizationPdfData(makeReport()).sites[0];
      expect(site.legacyObservations).toMatchObject({ governed: false, source: 'legacy_observation', version: 'v1' });
      for (const key of [
        'isProtected', 'protectedAreaNames', 'monumentCount', 'monumentNames', 'sluObservationCount',
        'vissWaterName', 'vissEcologicalStatus', 'vissChemicalStatus', 'distanceToWaterMeters', 'dataSources',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(site, key), key).toBe(false);
      }
    });

    it('U20CDF (F4): en otillgänglig källa visas som "ej tillgänglig" med null, aldrig som false eller 0', () => {
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            legacyObservations: makeLegacy({
              sourceAvailability: { spatialAudit: false, nvr: false, raa: false, viss: false, slu: false },
              protectedArea: { available: false, isProtected: null, hitNames: [] },
              distanceToWater: { available: false, meters: null },
              monuments: [],
              vissWaterStatus: null,
              sluObservationCount: null,
            }),
          }),
        ],
      });
      const legacy = buildLocalizationPdfData(report).sites[0].legacyObservations;
      expect(legacy).toEqual({
        governed: false,
        source: 'legacy_observation',
        version: 'v1',
        note_sv: 'Äldre observationer (test).',
        protectedArea: { available: false, status_sv: 'ej tillgänglig', isProtected: null, names: [] },
        monuments: { available: false, status_sv: 'ej tillgänglig', count: null, names: [] },
        slu: { available: false, status_sv: 'ej tillgänglig', observationCount: null },
        viss: { available: false, status_sv: 'ej tillgänglig', waterName: null, ecologicalStatus: null, chemicalStatus: null },
        distanceToWater: { available: false, status_sv: 'ej tillgänglig', meters: null },
        dataSources: [],
      });
    });

    it('U20CDF (F4): ett block som inte anger tillgänglighet för en källa visar den som ej tillgänglig (fail-safe)', () => {
      const legacyWithout = makeLegacy({ monuments: [{ name: 'Fornl' }], sluObservationCount: 3 }) as unknown as Record<string, unknown>;
      delete legacyWithout.sourceAvailability;
      const report = makeReport({ siteAnalyses: [makeSiteAnalysis('alt-1', { legacyObservations: legacyWithout })] });
      const legacy = buildLocalizationPdfData(report).sites[0].legacyObservations;
      expect(legacy.monuments).toMatchObject({ available: false, count: null });
      expect(legacy.slu).toMatchObject({ available: false, observationCount: null });
      expect(legacy.viss).toMatchObject({ available: false });
    });

    it('utan legacy-block skriver projektionen aldrig ut tomma observationer som resultat (fail-closed)', () => {
      const report = makeReport({ siteAnalyses: [makeSiteAnalysis('alt-1', { legacyObservations: undefined })] });
      expect(() => buildLocalizationPdfData(report)).toThrow(/LEGACY_OBSERVATIONS_NOT_INCLUDED/);
    });
  });

  it('innehåller legalBasis med MB-hänvisning', () => {
    const pdf = buildLocalizationPdfData(makeReport());
    expect(pdf.legalBasis).toContain('Miljöbalken');
    expect(pdf.legalBasis).toContain('1998:808');
  });

  it('hanterar flera platser korrekt', () => {
    const report = makeReport({
      siteAnalyses: [makeSiteAnalysis('a'), makeSiteAnalysis('b'), makeSiteAnalysis('c')],
    });
    const pdf = buildLocalizationPdfData(report);
    expect(pdf.sites).toHaveLength(3);
    expect(pdf.sites.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
