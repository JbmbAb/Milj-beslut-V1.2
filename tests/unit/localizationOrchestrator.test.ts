import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  validateLocalizationBody,
  localizationAuditRef,
  LocalizationDataUnavailableError,
  runLocalizationReport,
} from '../../server/modules/localization/localizationOrchestrator';
import type { LocalizationReport } from '../../server/services/localizationReportService';

vi.mock('../../server/services/localizationReportService', () => ({
  generateLocalizationReport: vi.fn(),
  isLocalizationStrictMode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn().mockResolvedValue(undefined),
}));

import {
  generateLocalizationReport,
  isLocalizationStrictMode,
} from '../../server/services/localizationReportService';
import type { AuthUser } from '../../server/security/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SiteAnalysisResult = LocalizationReport['siteAnalyses'][number];

function makeReport(overrides: Partial<LocalizationReport> = {}): LocalizationReport {
  return {
    projectId: 'proj-1',
    generatedAt: '2026-05-21T10:00:00.000Z',
    summary: {
      bestAlternativeId: 'A',
      reasoning: 'Baseline motivering',
    },
    warnings: [],
    siteAnalyses: [],
    humanInTheLoop: 'Handläggare ska verifiera rapporten innan beslut fattas.',
    ...overrides,
  };
}

function makeSiteAnalysis(
  siteId: string,
  unavailableSources: string[],
  spatialDown = false,
): SiteAnalysisResult {
  const externalSources = ['NVR API', 'RAA API', 'VISS', 'SLU Artdata'];
  return {
    site: { id: siteId, lat: 59.3, lng: 18.07 },
    dataSources: externalSources.map((source) => ({
      source,
      status: unavailableSources.includes(source) ? ('unavailable' as const) : ('ok' as const),
    })),
    spatialAudit: {
      protectedAreaHits: [],
      protectedAreaAvailable: !spatialDown,
      isProtected: false,
      sgu: {
        coverageMode: 'sample',
        manualReviewRequired: false,
        riskLevel: 'LOW',
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
      distanceToWaterAvailable: !spatialDown,
      text: 'Spatial audit genomford.',
      sources: [],
    },
    complianceAnalysis: {
      overallRisk: 'LOW',
      permitProbability: 0.75,
      restrictions: [],
      rules: [],
      summary: 'Låg risk.',
    },
    warnings: [],
    monuments: [],
    vissWaterStatus: null,
    distanceToWaterMeters: null,
    sluObservationCount: 0,
  };
}

const mockAuth: AuthUser = {
  id: 'user-1',
  organisationId: 'org-1',
  bankidId: 'bankid-user-1',
  role: 'ADMIN',
};

// ─── localizationAuditRef ─────────────────────────────────────────────────────

describe('localizationAuditRef', () => {
  it('prefixes projectId with LOK-', () => {
    expect(localizationAuditRef('proj-abc')).toBe('LOK-proj-abc');
  });

  it('handles empty string', () => {
    expect(localizationAuditRef('')).toBe('LOK-');
  });
});

// ─── validateLocalizationBody (→ parseSiteAlternatives) ──────────────────────

describe('validateLocalizationBody', () => {
  it('returns projectId and sites for valid input', () => {
    const result = validateLocalizationBody({
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
    });
    expect(result.projectId).toBe('proj-1');
    expect(result.sites).toHaveLength(1);
    expect(result.sites![0].id).toBe('A');
  });

  it('parses name and truncates to 120 characters', () => {
    const longName = 'X'.repeat(200);
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07, name: longName }],
    });
    expect(result.sites![0].name).toHaveLength(120);
  });

  it('returns undefined sites for empty siteAlternatives', () => {
    const result = validateLocalizationBody({ projectId: 'p1', siteAlternatives: [] });
    expect(result.sites).toBeUndefined();
  });

  it('returns undefined sites for non-array siteAlternatives', () => {
    const result = validateLocalizationBody({ projectId: 'p1', siteAlternatives: 'invalid' });
    expect(result.sites).toBeUndefined();
  });

  it('returns undefined for null body', () => {
    const result = validateLocalizationBody(null);
    expect(result.projectId).toBeUndefined();
    expect(result.sites).toBeUndefined();
  });

  it('returns undefined sites when any item lacks id', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: '', lat: 59.3, lng: 18.07 }],
    });
    expect(result.sites).toBeUndefined();
  });

  it('rejects lat below Swedish southern bound (< 55°N)', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: 'A', lat: 54.9, lng: 18.07 }],
    });
    expect(result.sites).toBeUndefined();
  });

  it('rejects lat above Swedish northern bound (> 69.5°N)', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: 'A', lat: 70.0, lng: 18.07 }],
    });
    expect(result.sites).toBeUndefined();
  });

  it('rejects lng below Swedish western bound (< 10°E)', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 9.9 }],
    });
    expect(result.sites).toBeUndefined();
  });

  it('rejects lng above Swedish eastern bound (> 25.5°E)', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 25.6 }],
    });
    expect(result.sites).toBeUndefined();
  });

  it('accepts coordinates on Swedish boundary (55°N, 10°E)', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: 'A', lat: 55.0, lng: 10.0 }],
    });
    expect(result.sites).toHaveLength(1);
  });

  it('accepts coordinates on Swedish boundary (69.5°N, 25.5°E)', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: 'A', lat: 69.5, lng: 25.5 }],
    });
    expect(result.sites).toHaveLength(1);
  });

  it('rejects non-finite lat (NaN)', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [{ id: 'A', lat: NaN, lng: 18.07 }],
    });
    expect(result.sites).toBeUndefined();
  });

  it('returns undefined sites when non-object in array', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [null],
    });
    expect(result.sites).toBeUndefined();
  });

  it('handles multiple valid sites', () => {
    const result = validateLocalizationBody({
      projectId: 'p1',
      siteAlternatives: [
        { id: 'A', lat: 59.3, lng: 18.07 },
        { id: 'B', lat: 67.0, lng: 20.0 },
      ],
    });
    expect(result.sites).toHaveLength(2);
  });
});

// ─── assertStrictReportUsable (via runLocalizationReport) ────────────────────

describe('assertStrictReportUsable via runLocalizationReport', () => {
  beforeEach(() => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(false);
    vi.mocked(generateLocalizationReport).mockResolvedValue(makeReport());
  });

  it('non-strict mode: passes even with 3 unavailable external sources', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(false);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({ siteAnalyses: [makeSiteAnalysis('A', ['NVR API', 'RAA API', 'VISS'])] }),
    );

    const result = await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
    });
    expect(result.ok).toBe(true);
  });

  it('strict mode: 3 unavailable external sources → LocalizationDataUnavailableError', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({ siteAnalyses: [makeSiteAnalysis('A', ['NVR API', 'RAA API', 'VISS'])] }),
    );

    await expect(
      runLocalizationReport({
        authUser: mockAuth,
        projectId: 'proj-1',
        siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
      }),
    ).rejects.toThrow(LocalizationDataUnavailableError);
  });

  it('strict mode: 4 unavailable external sources → LocalizationDataUnavailableError', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({
        siteAnalyses: [makeSiteAnalysis('A', ['NVR API', 'RAA API', 'VISS', 'SLU Artdata'])],
      }),
    );

    await expect(
      runLocalizationReport({
        authUser: mockAuth,
        projectId: 'proj-1',
        siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
      }),
    ).rejects.toThrow(LocalizationDataUnavailableError);
  });

  it('strict mode: 2 unavailable + spatial degraded → throws', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({ siteAnalyses: [makeSiteAnalysis('A', ['NVR API', 'RAA API'], true)] }),
    );

    await expect(
      runLocalizationReport({
        authUser: mockAuth,
        projectId: 'proj-1',
        siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
      }),
    ).rejects.toThrow(LocalizationDataUnavailableError);
  });

  it('strict mode: 2 unavailable + spatial OK → passes', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({ siteAnalyses: [makeSiteAnalysis('A', ['NVR API', 'RAA API'], false)] }),
    );

    const result = await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
    });
    expect(result.ok).toBe(true);
  });

  it('strict mode: 1 unavailable + spatial degraded → passes', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({ siteAnalyses: [makeSiteAnalysis('A', ['NVR API'], true)] }),
    );

    const result = await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
    });
    expect(result.ok).toBe(true);
  });

  it('strict mode: all sources available → passes', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({ siteAnalyses: [makeSiteAnalysis('A', [])] }),
    );

    const result = await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
    });
    expect(result.ok).toBe(true);
  });

  it('strict mode: error contains site id and external count', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({ siteAnalyses: [makeSiteAnalysis('site-XYZ', ['NVR API', 'RAA API', 'VISS'])] }),
    );

    const err = await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'site-XYZ', lat: 59.3, lng: 18.07 }],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(LocalizationDataUnavailableError);
    expect((err as Error).message).toContain('site-XYZ');
    expect((err as LocalizationDataUnavailableError).status).toBe(503);
    expect((err as LocalizationDataUnavailableError).code).toBe('LOCALIZATION_DATA_UNAVAILABLE');
  });

  it('returns 400 when projectId missing', async () => {
    const result = await runLocalizationReport({
      authUser: mockAuth,
      projectId: '',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
    });
    expect(result.ok).toBe(false);
    expect('status' in result ? result.status : 0).toBe(400);
  });

  it('returns 400 when siteAlternatives is empty array', async () => {
    const result = await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [],
    });
    expect(result.ok).toBe(false);
    expect('status' in result ? result.status : 0).toBe(400);
  });

  it('meta.strictMode reflects isLocalizationStrictMode', async () => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(makeReport());

    const result = await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
    });
    if (result.ok) expect(result.meta.strictMode).toBe(true);
  });
});
