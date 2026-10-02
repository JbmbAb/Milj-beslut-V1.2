import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  validateLocalizationBody,
  localizationAuditRef,
  LocalizationDataUnavailableError,
  runLocalizationReport,
} from '../../server/modules/localization/localizationOrchestrator';
import type { LocalizationReport } from '../../server/services/localizationReportService';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

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
      comparison_status: 'COMPLETE',
      assessed_site_ids: ['A'],
      not_ranked_site_ids: [],
      unassessed_site_ids: [],
    },
    warnings: [],
    siteAnalyses: [],
    humanInTheLoop: 'Handläggare ska verifiera rapporten innan beslut fattas.',
    ...overrides,
  };
}

/**
 * U20-C: a site whose OLDER, ungoverned sources are partly or wholly down. Since U20-C those
 * observations live only in `legacyObservations` (governed: false) and can never gate the request.
 */
function makeSiteAnalysis(
  siteId: string,
  unavailableSources: string[],
  spatialDown = false,
): SiteAnalysisResult {
  const externalSources = ['NVR API', 'RAA API', 'VISS', 'SLU Artdata'];
  return {
    site: { id: siteId, lat: 59.3, lng: 18.07 },
    complianceAnalysis: {
      assessment_status: 'NOT_ASSESSED',
      restrictions: [],
      rules: [],
      summary: 'Ingen styrd bedömning gjordes. Ingen risknivå anges.',
    },
    warnings: [],
    legacyObservations: {
      governed: false,
      source: 'legacy_observation',
      version: 'v1',
      note_sv: 'Äldre observationer (test).',
      protectedArea: { available: !spatialDown, isProtected: false, hitNames: [] },
      distanceToWater: { available: !spatialDown, meters: null },
      monuments: [],
      vissWaterStatus: null,
      sluObservationCount: 0,
      dataSources: [
        { source: 'PostGIS spatial', status: spatialDown ? ('unavailable' as const) : ('ok' as const) },
        ...externalSources.map((source) => ({
          source,
          status: unavailableSources.includes(source) ? ('unavailable' as const) : ('ok' as const),
        })),
      ],
      warnings: [],
      restrictions: [],
      rules: [],
    },
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

// ─── U20-C: strict mode never gates on the unbound reads ─────────────────────
//
// The former assertStrictReportUsable turned the old spatialAudit and the live NVR / RAÄ / VISS /
// SLU outcomes into a 503 -- after the governed assessment was already persisted. These cases used
// to assert that 503; U20-C (U20-U30 spec 1.5 K1, owner decision DP-04) removes the gate, so the
// same reports now pass in every mode. The governed outcome is carried per site in executionMotor.

describe('U20-C: runLocalizationReport never gates on the older, ungoverned sources', () => {
  beforeEach(() => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(false);
    vi.mocked(generateLocalizationReport).mockResolvedValue(makeReport());
  });

  it.each<[string, string[], boolean]>([
    ['3 external sources down', ['NVR API', 'RAA API', 'VISS'], false],
    ['all 4 external sources down', ['NVR API', 'RAA API', 'VISS', 'SLU Artdata'], false],
    ['2 external sources down + spatialAudit down', ['NVR API', 'RAA API'], true],
    ['1 external source down + spatialAudit down', ['NVR API'], true],
  ])('strict mode, %s -> ok (no LocalizationDataUnavailableError)', async (_label, down, spatialDown) => {
    vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
    vi.mocked(generateLocalizationReport).mockResolvedValue(
      makeReport({ siteAnalyses: [makeSiteAnalysis('A', down, spatialDown)] }),
    );

    const result = await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.meta.strictMode).toBe(true);
  });

  it('non-strict mode: passes with 3 unavailable external sources (unchanged)', async () => {
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

  it('the governed request does not ask for the older observations; the opt-in is passed through', async () => {
    await runLocalizationReport({ authUser: mockAuth, projectId: 'proj-1', siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }] });
    expect(vi.mocked(generateLocalizationReport).mock.calls.at(-1)?.[0]).toMatchObject({ includeLegacyObservations: false });

    await runLocalizationReport({
      authUser: mockAuth,
      projectId: 'proj-1',
      siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
      includeLegacyObservations: true,
    });
    expect(vi.mocked(generateLocalizationReport).mock.calls.at(-1)?.[0]).toMatchObject({ includeLegacyObservations: true });
  });

  it('LocalizationDataUnavailableError keeps its public contract (status 503, code) for the route mapping', () => {
    const err = new LocalizationDataUnavailableError('x');
    expect(err.status).toBe(503);
    expect(err.code).toBe('LOCALIZATION_DATA_UNAVAILABLE');
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
