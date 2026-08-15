import { describe, it, expect } from 'vitest';
import { buildLocalizationPdfData } from '../../../server/services/localizationPdfService';
import type { LocalizationReport } from '../../../server/services/localizationReportService';

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

function makeSpatialAudit(overrides: Record<string, unknown> = {}) {
  return {
    protectedAreaHits: [],
    protectedAreaAvailable: true,
    isProtected: false,
    sgu: {
      coverageMode: 'sample' as const,
      manualReviewRequired: false,
      riskLevel: 'LOW' as const,
      groundLayer: {
        intersects: false,
        hit: null,
        advisory: 'Ingen avvikelse i grundlager.',
      },
      landslideFeatures: {
        nearby: false,
        bufferMeters: 150,
        nearestDistanceMeters: null,
        hits: [],
        advisory: 'Inga SGU-indikatorer inom buffert.',
      },
      flags: [],
      summary: 'SGU-risk: låg',
    },
    insar: {
      pointCount: 0,
      averageVelocityMmYear: 0,
      maxSubsidenceMmYear: 0,
      riskLevel: 'LOW' as const,
      advisory: 'Ingen markrörelse',
      sourceUrl: '',
      points: [],
      warningFlags: [],
    },
    distanceToWaterMeters: null,
    distanceToWaterAvailable: false,
    text: 'OK',
    sources: [],
    ...overrides,
  };
}

function makeCompliance(siteId: string, overrides: Record<string, unknown> = {}) {
  return {
    overallRisk: 'LOW' as const,
    permitProbability: 0.8,
    restrictions: [],
    rules: [],
    summary: `Sammanfattning ${siteId}`,
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
    property_context_id: `prop-${id}`,
    assessment_status: 'ASSESSED' as const,
    ...overrides,
  };
}

function makeSiteAnalysis(id: string, overrides: Record<string, unknown> = {}) {
  return {
    site: makeSite(id),
    spatialAudit: makeSpatialAudit(),
    complianceAnalysis: makeCompliance(id),
    monuments: [],
    vissWaterStatus: null,
    distanceToWaterMeters: null,
    dataSources: [],
    warnings: [],
    sluObservationCount: 0,
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
  });

  it('utelämnar verdict-fält för en plats utan governad bedömning', () => {
    const report = makeReport({
      siteAnalyses: [
        makeSiteAnalysis('alt-1', {
          complianceAnalysis: { restrictions: [], rules: [], summary: 'ej bedömd' },
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
        siteAnalyses: [makeSiteAnalysis('alt-1', { monuments })],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].monumentCount).toBe(8);
      expect(pdf.sites[0].monumentNames).toHaveLength(5);
    });

    it('trunkerar skyddade områden till max 5', () => {
      const hits = Array.from({ length: 7 }, (_, i) => ({
        nvr_id: `nvr-${i}`,
        name: `Område ${i}`,
        protection_type: 'NR',
        decision_status: 'ACTIVE',
      }));
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            spatialAudit: makeSpatialAudit({ protectedAreaHits: hits, isProtected: true }),
          }),
        ],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].isProtected).toBe(true);
      expect(pdf.sites[0].protectedAreaNames).toHaveLength(5);
    });

    it('mappar skyddat område utan namn till "Namnlöst område"', () => {
      const hits = [{ nvr_id: 'nvr-1', name: null, protection_type: 'NR', decision_status: 'ACTIVE' }];
      const report = makeReport({
        siteAnalyses: [
          makeSiteAnalysis('alt-1', {
            spatialAudit: makeSpatialAudit({ protectedAreaHits: hits, isProtected: true }),
          }),
        ],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].protectedAreaNames[0]).toBe('Namnlöst område');
    });
  });

  describe('VISS-data', () => {
    it('null vissWaterStatus ger null-fält', () => {
      const pdf = buildLocalizationPdfData(makeReport());
      const site = pdf.sites[0];
      expect(site.vissWaterName).toBeNull();
      expect(site.vissEcologicalStatus).toBeNull();
      expect(site.vissChemicalStatus).toBeNull();
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
        siteAnalyses: [makeSiteAnalysis('alt-1', { vissWaterStatus: viss })],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].vissWaterName).toBe('Fyrisån');
      expect(pdf.sites[0].vissEcologicalStatus).toBe('GOD');
      expect(pdf.sites[0].vissChemicalStatus).toBe('GOD');
    });
  });

  describe('rules-mappning', () => {
    it('mappar regler i complianceAnalysis', () => {
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
        siteAnalyses: [makeSiteAnalysis('alt-1', { complianceAnalysis: makeCompliance('alt-1', { rules }) })],
      });
      const pdf = buildLocalizationPdfData(report);
      expect(pdf.sites[0].rules[0].ruleId).toBe('MB-2-3');
      expect(pdf.sites[0].rules[0].chapter).toBe('MB 2:3');
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
