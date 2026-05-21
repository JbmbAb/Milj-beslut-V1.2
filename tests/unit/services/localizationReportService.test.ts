/**
 * localizationReportService — isLocalizationStrictMode och generateLocalizationReport
 *
 * Täcker isLocalizationStrictMode (alla grenar via env-vars)
 * och den publika generateLocalizationReport (mocked dependencies).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateLocalizationReport,
  isLocalizationStrictMode,
} from '../../../server/services/localizationReportService';

vi.mock('../../../server/services/spatialAuditService', () => ({
  runSpatialAudit: vi.fn().mockResolvedValue({
    protectedAreaHits: [],
    protectedAreaAvailable: true,
    isProtected: false,
    sgu: { riskLevel: 'LOW', riskFactors: [], sources: [] },
    distanceToWaterMeters: null,
    distanceToWaterAvailable: true,
    text: 'OK',
    sources: [],
  }),
}));

vi.mock('../../../server/services/complianceRuleEngine', () => ({
  evaluateComplianceRules: vi.fn().mockReturnValue({
    overallRisk: 'LOW',
    permitProbability: 0.8,
    restrictions: [],
    rules: [],
    summary: 'OK',
    violations: [],
    warnings: [],
    feasibilityScore: 80,
    recommendations: [],
  }),
}));

vi.mock('../../../server/services/nvrService', () => ({
  fetchProtectedAreas: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../server/services/raaService', () => ({
  fetchAncientMonuments: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../server/services/vissService', () => ({
  queryVissPoint: vi.fn().mockResolvedValue({ ok: false, error: 'VISS not available' }),
}));

vi.mock('../../../server/services/sguRiskService', () => ({
  toGeologicalData: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../server/services/sluService', () => ({
  searchSluByCoordinates: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../server/services/auditTrailService', () => ({
  auditTrail: {
    logAction: vi.fn().mockResolvedValue({ referenceNumber: 'LOK-test', immutable: true }),
  },
}));

vi.mock('../../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SITE = { id: 'alt-1', lat: 59.33, lng: 18.07 };

describe('isLocalizationStrictMode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returnerar true när LOCALIZATION_STRICT_SOURCES=true', () => {
    process.env.LOCALIZATION_STRICT_SOURCES = 'true';
    expect(isLocalizationStrictMode()).toBe(true);
  });

  it('returnerar false när LOCALIZATION_STRICT_SOURCES=false', () => {
    process.env.LOCALIZATION_STRICT_SOURCES = 'false';
    expect(isLocalizationStrictMode()).toBe(false);
  });

  it('returnerar true när APP_ENV=staging', () => {
    delete process.env.LOCALIZATION_STRICT_SOURCES;
    process.env.APP_ENV = 'staging';
    expect(isLocalizationStrictMode()).toBe(true);
  });

  it('returnerar true när APP_ENV=production', () => {
    delete process.env.LOCALIZATION_STRICT_SOURCES;
    process.env.APP_ENV = 'production';
    expect(isLocalizationStrictMode()).toBe(true);
  });

  it('returnerar false när NODE_ENV=test (ingen staging/production)', () => {
    delete process.env.LOCALIZATION_STRICT_SOURCES;
    delete process.env.APP_ENV;
    process.env.NODE_ENV = 'test';
    expect(isLocalizationStrictMode()).toBe(false);
  });
});

describe('generateLocalizationReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returnerar rapport med siteAnalyses och summary', async () => {
    const report = await generateLocalizationReport({
      projectId: 'proj-test',
      siteAlternatives: [SITE],
      userId: 'user-1',
    });

    expect(report.projectId).toBe('proj-test');
    expect(report.siteAnalyses).toHaveLength(1);
    expect(report.siteAnalyses[0].site.id).toBe('alt-1');
    expect(report.summary.bestAlternativeId).toBe('alt-1');
    expect(typeof report.humanInTheLoop).toBe('string');
  });

  it('returnerar rapport för tom siteAlternatives-lista', async () => {
    const report = await generateLocalizationReport({
      projectId: 'proj-empty',
      siteAlternatives: [],
    });

    expect(report.siteAnalyses).toHaveLength(0);
    expect(report.summary.bestAlternativeId).toBeUndefined();
    expect(report.summary.reasoning).toContain('Inga alternativ');
  });

  it('analyserar flera alternativ och väljer bäst sannolikhet', async () => {
    const { evaluateComplianceRules } = await import('../../../server/services/complianceRuleEngine');
    let callCount = 0;
    (evaluateComplianceRules as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return {
        overallRisk: callCount === 1 ? 'HIGH' : 'LOW',
        permitProbability: callCount === 1 ? 0.3 : 0.9,
        restrictions: [],
        rules: [],
        summary: 'OK',
        violations: [],
        warnings: [],
        feasibilityScore: 70,
        recommendations: [],
      };
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-multi',
      siteAlternatives: [
        { id: 'alt-low', lat: 59.33, lng: 18.07 },
        { id: 'alt-high', lat: 59.34, lng: 18.08 },
      ],
    });

    expect(report.siteAnalyses).toHaveLength(2);
    expect(report.summary.bestAlternativeId).toBe('alt-high');
  });
});

// ── generateLocalizationReportLegacy ─────────────────────────────────────────

describe('generateLocalizationReportLegacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegerar till generateLocalizationReport', async () => {
    const { generateLocalizationReportLegacy } = await import(
      '../../../server/services/localizationReportService'
    );
    const report = await generateLocalizationReportLegacy('proj-legacy', [SITE], 'user-1');
    expect(report.projectId).toBe('proj-legacy');
    expect(report.siteAnalyses).toHaveLength(1);
  });
});

// ── SLU-integration: hasSluSpeciesConfigured och parseSluObservations ─────────

describe('SLU-integration via generateLocalizationReport (user-kontext)', () => {
  const AUTH_USER = { id: 'user-1', organisationId: 'org-1', role: 'ADMIN' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SLU_SPECIES_OBS_API_KEY;
  });

  afterEach(() => {
    delete process.env.SLU_SPECIES_OBS_API_KEY;
  });

  it('fetchSluObservations returnerar fel när SLU ej konfigurerad (hasSluSpeciesConfigured=false)', async () => {
    const report = await generateLocalizationReport({
      projectId: 'proj-slu-off',
      siteAlternatives: [SITE],
      user: AUTH_USER,
    });
    expect(report.siteAnalyses[0].sluObservationCount).toBe(0);
  });

  it('parseSluObservations körs och returnerar träffar när SLU konfigurerad', async () => {
    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
    const { searchSluByCoordinates } = await import('../../../server/services/sluService');
    (searchSluByCoordinates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      observations: [
        { taxonName: 'Rana temporaria', redlistCategory: 'LC' },
        { taxonName: 'Bufo bufo', redlistCategory: 'NT' },
      ],
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-slu-on',
      siteAlternatives: [SITE],
      user: AUTH_USER,
    });
    expect(report.siteAnalyses[0].sluObservationCount).toBeGreaterThan(0);
  });

  it('parseSluObservations hanterar features-format', async () => {
    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
    const { searchSluByCoordinates } = await import('../../../server/services/sluService');
    (searchSluByCoordinates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      features: [{ properties: { scientificName: 'Bombina variegata', conservationStatus: 'VU' } }],
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-slu-feat',
      siteAlternatives: [SITE],
      user: AUTH_USER,
    });
    expect(report.siteAnalyses[0].sluObservationCount).toBeGreaterThan(0);
  });
});

// ── Externa API-felfall (NVR/RAA/VISS/SLU) ───────────────────────────────────

describe('generateLocalizationReport — externa API-felfall', () => {
  const AUTH_USER = { id: 'user-1', organisationId: 'org-1', role: 'ADMIN' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SLU_SPECIES_OBS_API_KEY;
  });

  afterEach(() => {
    delete process.env.SLU_SPECIES_OBS_API_KEY;
  });

  it('NVR-fel ger varning och dataSources unavailable (ej strict)', async () => {
    const { fetchProtectedAreas } = await import('../../../server/services/nvrService');
    (fetchProtectedAreas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('NVR timeout'),
    );

    const report = await generateLocalizationReport({
      projectId: 'proj-nvr-fail',
      siteAlternatives: [SITE],
    });

    const nvr = report.siteAnalyses[0].dataSources.find((d) => d.source === 'NVR API');
    expect(nvr?.status).toBe('unavailable');
    expect(report.siteAnalyses[0].warnings.some((w) => w.includes('NVR'))).toBe(true);
  });

  it('NVR-fel med strict=true inkluderar skyddskällevarning', async () => {
    const { fetchProtectedAreas } = await import('../../../server/services/nvrService');
    (fetchProtectedAreas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('NVR down'),
    );
    process.env.LOCALIZATION_STRICT_SOURCES = 'true';

    try {
      const report = await generateLocalizationReport({
        projectId: 'proj-nvr-strict',
        siteAlternatives: [SITE],
      });
      const nvr = report.siteAnalyses[0].dataSources.find((d) => d.source === 'NVR API');
      expect(nvr?.status).toBe('unavailable');
    } finally {
      delete process.env.LOCALIZATION_STRICT_SOURCES;
    }
  });

  it('RAA-fel ger varning och dataSources unavailable', async () => {
    const { fetchAncientMonuments } = await import('../../../server/services/raaService');
    (fetchAncientMonuments as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('RAA API offline'),
    );

    const report = await generateLocalizationReport({
      projectId: 'proj-raa-fail',
      siteAlternatives: [SITE],
    });

    const raa = report.siteAnalyses[0].dataSources.find((d) => d.source === 'RAA API');
    expect(raa?.status).toBe('unavailable');
    expect(report.siteAnalyses[0].warnings.some((w) => w.includes('RAA'))).toBe(true);
  });

  it('VISS-fel ger varning och dataSources unavailable', async () => {
    const { queryVissPoint } = await import('../../../server/services/vissService');
    (queryVissPoint as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('VISS timeout'),
    );

    const report = await generateLocalizationReport({
      projectId: 'proj-viss-fail',
      siteAlternatives: [SITE],
    });

    const viss = report.siteAnalyses[0].dataSources.find((d) => d.source === 'VISS');
    expect(viss?.status).toBe('unavailable');
  });

  it('VISS returnerar ok=false (ej throw) ger varning', async () => {
    const { queryVissPoint } = await import('../../../server/services/vissService');
    (queryVissPoint as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: 'Ingen vattenförekomst hittad',
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-viss-notok',
      siteAlternatives: [SITE],
    });

    const viss = report.siteAnalyses[0].dataSources.find((d) => d.source === 'VISS');
    expect(viss?.status).toBe('unavailable');
  });

  it('SLU-fel (throw) ger varning och sluObservationCount=0', async () => {
    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
    const { searchSluByCoordinates } = await import('../../../server/services/sluService');
    (searchSluByCoordinates as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('SLU API down'),
    );

    const report = await generateLocalizationReport({
      projectId: 'proj-slu-err',
      siteAlternatives: [SITE],
      user: AUTH_USER,
    });

    expect(report.siteAnalyses[0].sluObservationCount).toBe(0);
    const slu = report.siteAnalyses[0].dataSources.find((d) => d.source === 'SLU Artdata');
    expect(slu?.status).toBe('unavailable');
  });

  it('parseSluObservations hanterar null-indata (raw=null)', async () => {
    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
    const { searchSluByCoordinates } = await import('../../../server/services/sluService');
    (searchSluByCoordinates as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const report = await generateLocalizationReport({
      projectId: 'proj-slu-null',
      siteAlternatives: [SITE],
      user: AUTH_USER,
    });

    expect(report.siteAnalyses[0].sluObservationCount).toBe(0);
  });

  it('parseSluObservations hanterar data-format och null i observationslista', async () => {
    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
    const { searchSluByCoordinates } = await import('../../../server/services/sluService');
    (searchSluByCoordinates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [null, { taxonName: 'Triturus cristatus' }],
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-slu-data',
      siteAlternatives: [SITE],
      user: AUTH_USER,
    });

    expect(report.siteAnalyses[0].sluObservationCount).toBeGreaterThan(0);
  });
});

// ── VISS ok=true och hasSluSpeciesConfigured via SLU_SPECIES_OBS_BASE_PATH ───

describe('generateLocalizationReport — VISS ok=true och SLU via BASE_PATH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SLU_SPECIES_OBS_API_KEY;
    delete process.env.SLU_SPECIES_OBS_BASE_PATH;
    delete process.env.SLU_API_KEY;
  });

  afterEach(() => {
    delete process.env.SLU_SPECIES_OBS_API_KEY;
    delete process.env.SLU_SPECIES_OBS_BASE_PATH;
    delete process.env.SLU_API_KEY;
    delete process.env.LOCALIZATION_STRICT_SOURCES;
  });

  it('VISS returnerar ok=true med vattenstatusdata', async () => {
    const { queryVissPoint } = await import('../../../server/services/vissService');
    (queryVissPoint as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      primaryWaterStatus: { waterName: 'Gävleån', status: 'God ekologisk status' },
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-viss-ok',
      siteAlternatives: [SITE],
    });

    const viss = report.siteAnalyses[0].dataSources.find((d) => d.source === 'VISS');
    expect(viss?.status).toBe('ok');
    expect(report.siteAnalyses[0].vissWaterStatus).not.toBeNull();
  });

  it('VISS ok=true men primaryWaterStatus=null (fallback null)', async () => {
    const { queryVissPoint } = await import('../../../server/services/vissService');
    (queryVissPoint as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      primaryWaterStatus: null,
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-viss-ok-null',
      siteAlternatives: [SITE],
    });

    const viss = report.siteAnalyses[0].dataSources.find((d) => d.source === 'VISS');
    expect(viss?.status).toBe('ok');
    expect(report.siteAnalyses[0].vissWaterStatus).toBeNull();
  });

  it('hasSluSpeciesConfigured via SLU_SPECIES_OBS_BASE_PATH + SLU_API_KEY', async () => {
    process.env.SLU_SPECIES_OBS_BASE_PATH = '/api/slu';
    process.env.SLU_API_KEY = 'base-key';
    const { searchSluByCoordinates } = await import('../../../server/services/sluService');
    (searchSluByCoordinates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      results: [{ taxonName: 'Rana arvalis' }],
    });

    const AUTH_USER = { id: 'user-1', organisationId: 'org-1', role: 'ADMIN' as const };
    const report = await generateLocalizationReport({
      projectId: 'proj-slu-base',
      siteAlternatives: [SITE],
      user: AUTH_USER,
    });

    expect(report.siteAnalyses[0].sluObservationCount).toBeGreaterThan(0);
  });

  it('NVR-catch hanterar icke-Error throw (String-gren)', async () => {
    const { fetchProtectedAreas } = await import('../../../server/services/nvrService');
    (fetchProtectedAreas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      'NVR timeout string',
    );

    const report = await generateLocalizationReport({
      projectId: 'proj-nvr-str',
      siteAlternatives: [SITE],
    });

    const nvr = report.siteAnalyses[0].dataSources.find((d) => d.source === 'NVR API');
    expect(nvr?.status).toBe('unavailable');
  });

  it('RAA-catch hanterar icke-Error throw', async () => {
    const { fetchAncientMonuments } = await import('../../../server/services/raaService');
    (fetchAncientMonuments as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      'RAA string error',
    );

    const report = await generateLocalizationReport({
      projectId: 'proj-raa-str',
      siteAlternatives: [SITE],
    });

    const raa = report.siteAnalyses[0].dataSources.find((d) => d.source === 'RAA API');
    expect(raa?.status).toBe('unavailable');
  });

  it('spatial degraded-status (en av spatial-källorna otillgänglig)', async () => {
    const { runSpatialAudit } = await import('../../../server/services/spatialAuditService');
    (runSpatialAudit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      protectedAreaHits: [],
      protectedAreaAvailable: true,
      isProtected: false,
      sgu: { riskLevel: 'LOW', riskFactors: [], sources: [], manualReviewRequired: true },
      distanceToWaterMeters: null,
      distanceToWaterAvailable: false,
      text: 'Delvis OK',
      sources: [],
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-degraded',
      siteAlternatives: [SITE],
    });

    const spatial = report.siteAnalyses[0].dataSources.find((d) => d.source === 'PostGIS spatial');
    expect(spatial?.status).toBe('degraded');
    const sgu = report.siteAnalyses[0].dataSources.find((d) => d.source === 'SGU jord/skred');
    expect(sgu?.status).toBe('degraded');
  });

  it('distanceForCompliance=null i strict-läge när vatten ej tillgängligt', async () => {
    process.env.LOCALIZATION_STRICT_SOURCES = 'true';
    const { runSpatialAudit } = await import('../../../server/services/spatialAuditService');
    (runSpatialAudit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      protectedAreaHits: [],
      protectedAreaAvailable: true,
      isProtected: false,
      sgu: { riskLevel: 'LOW', riskFactors: [], sources: [] },
      distanceToWaterMeters: null,
      distanceToWaterAvailable: false,
      text: 'OK',
      sources: [],
    });

    const report = await generateLocalizationReport({
      projectId: 'proj-strict-nowater',
      siteAlternatives: [SITE],
    });

    expect(report.siteAnalyses[0].warnings.some((w) => w.includes('Avstånd'))).toBe(true);
  });
});


