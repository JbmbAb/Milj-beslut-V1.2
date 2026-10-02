/**
 * localizationOrchestrator — felfall och saknade grenar
 *
 * Täcker: parseSiteAlternatives edge cases, att strikt läge inte längre spärrar på de äldre,
 * ostyrda källorna (U20-C; tidigare assertStrictReportUsable), validateLocalizationBody,
 * fetchLocalizationAuditTrail.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLocalizationAuditTrail,
  runLocalizationReport,
  validateLocalizationBody,
} from '../../server/modules/localization/localizationOrchestrator';
import type { LocalizationReport } from '../../server/services/localizationReportService';
import type { AuthUser } from '../../server/security/types';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) },
  getAuditTrail: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/services/localizationReportService', () => ({
  generateLocalizationReport: vi.fn(),
  isLocalizationStrictMode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../server/services/localizationPdfService', () => ({
  buildLocalizationPdfData: vi.fn().mockReturnValue({
    title: 'Lokaliseringsutredning',
    projectId: 'proj-1',
    generatedAt: '2026-05-21T10:00:00Z',
    humanInTheLoop: 'Granska.',
    disclaimer: 'Human in the Loop',
    summary: { bestAlternativeId: 'a1', reasoning: 'ok' },
    sites: [],
    warnings: [],
    reportWarnings: [],
    legalBasis: 'Miljöbalken (1998:808)',
  }),
}));

vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: vi.fn().mockResolvedValue(Buffer.from('PDF')),
}));

type SiteAnalysisResult = LocalizationReport['siteAnalyses'][number];

const AUTH: AuthUser = {
  id: 'user-1',
  organisationId: 'org-1',
  bankidId: 'bankid-user-1',
  role: 'ADMIN',
};
const PROJECT_ID = 'proj-lok-felfall';
const VALID_SITE = { id: 'alt-1', lat: 59.33, lng: 18.07 };

function makeReport(projectId = PROJECT_ID, legacy?: { spatialDown: boolean; unavailable: string[] }): LocalizationReport {
  return {
    projectId,
    generatedAt: '2026-05-21T10:00:00.000Z',
    siteAnalyses: [
      {
        site: { id: 'alt-1', lat: 59.33, lng: 18.07 },
        complianceAnalysis: {
          assessment_status: 'NOT_ASSESSED',
          restrictions: [],
          rules: [],
          summary: 'Ingen styrd bedömning gjordes. Ingen risknivå anges.',
        },
        warnings: [],
        // U20-C: the older, ungoverned observations exist only in this labelled block.
        ...(legacy
          ? {
              legacyObservations: {
                governed: false as const,
                source: 'legacy_observation' as const,
                version: 'v1' as const,
                note_sv: 'Äldre observationer (test).',
                protectedArea: { available: !legacy.spatialDown, isProtected: false, hitNames: [] },
                distanceToWater: { available: !legacy.spatialDown, meters: null },
                monuments: [],
                vissWaterStatus: null,
                sluObservationCount: 0,
                dataSources: legacy.unavailable.map((source) => ({ source, status: 'unavailable' as const })),
                warnings: [],
                restrictions: [],
                rules: [],
              },
            }
          : {}),
      },
    ],
    summary: {
      reasoning: 'Ingen rangordning tillgänglig.',
      comparison_status: 'UNAVAILABLE',
      assessed_site_ids: [],
      not_ranked_site_ids: [],
      unassessed_site_ids: ['alt-1'],
    },
    warnings: [],
    humanInTheLoop: 'Granska innan beslut.',
  };
}

describe('localizationOrchestrator — felfall och saknade grenar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── parseSiteAlternatives (via runLocalizationReport) ────────────────────

  describe('parseSiteAlternatives — ogiltiga indata', () => {
    it('returnerar 400 för tom array', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [],
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });

    it('returnerar 400 när array innehåller icke-objekt (null)', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [null],
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });

    it('returnerar 400 när id saknas (tom sträng)', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [{ id: '', lat: 59.33, lng: 18.07 }],
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });

    it('returnerar 400 när koordinater inte är finita (NaN)', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [{ id: 'x', lat: NaN, lng: 18.07 }],
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });

    it('returnerar 400 när siteAlternatives inte är en array', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: 'not-an-array',
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });

    it('returnerar 400 vid tomt projectId', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: '   ',
        siteAlternatives: [VALID_SITE],
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });
  });

  // ── U20-C: strikt läge spärrar inte längre på de äldre, ostyrda källorna ──
  //
  // Tidigare kastade assertStrictReportUsable "Otillräcklig datakvalitet" (503) här, efter att den
  // styrda bedömningen redan sparats i CAS. U20-C (DP-04) tar bort spärren: samma lägen ger ok.

  describe('U20-C: strikt läge och nere äldre källor ger ingen spärr', () => {
    it.each<[string, { spatialDown: boolean; unavailable: string[] }]>([
      ['spatialDown och 2 externa otillgängliga', { spatialDown: true, unavailable: ['NVR API', 'RAA API'] }],
      ['3 externa otillgängliga', { spatialDown: false, unavailable: ['NVR API', 'RAA API', 'VISS'] }],
    ])('%s -> ok, ingen LocalizationDataUnavailableError', async (_label, legacy) => {
      const { isLocalizationStrictMode, generateLocalizationReport } =
        await import('../../server/services/localizationReportService');
      (isLocalizationStrictMode as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (generateLocalizationReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeReport(PROJECT_ID, legacy));

      const result = await runLocalizationReport({ authUser: AUTH, projectId: PROJECT_ID, siteAlternatives: [VALID_SITE] });
      expect(result.ok).toBe(true);
    });

    it('lyckas när strict mode och alla källor tillgängliga', async () => {
      const { isLocalizationStrictMode, generateLocalizationReport } =
        await import('../../server/services/localizationReportService');
      (isLocalizationStrictMode as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (generateLocalizationReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeReport());

      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [VALID_SITE],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.meta.strictMode).toBe(true);
    });
  });

  // ── validateLocalizationBody ─────────────────────────────────────────────

  describe('validateLocalizationBody', () => {
    it('returnerar tomt objekt för null-body', () => {
      const result = validateLocalizationBody(null);
      expect(result).toEqual({});
    });

    it('returnerar tomt objekt för sträng-body', () => {
      const result = validateLocalizationBody('not-an-object');
      expect(result).toEqual({});
    });

    it('extraherar projectId och sites för giltig body', () => {
      const result = validateLocalizationBody({
        projectId: 'proj-x',
        siteAlternatives: [{ id: 'a', lat: 59.33, lng: 18.07 }],
      });
      expect(result.projectId).toBe('proj-x');
      expect(result.sites).toHaveLength(1);
      expect(result.sites?.[0].id).toBe('a');
    });

    it('sites är undefined för ogiltiga koordinater (utanför Sverige)', () => {
      const result = validateLocalizationBody({
        projectId: 'proj-x',
        siteAlternatives: [{ id: 'a', lat: 48.8, lng: 2.3 }],
      });
      expect(result.sites).toBeUndefined();
    });

    it('projectId är undefined när det saknas i body', () => {
      const result = validateLocalizationBody({ siteAlternatives: [] });
      expect(result.projectId).toBeUndefined();
    });
  });

  // ── fetchLocalizationAuditTrail ──────────────────────────────────────────

  describe('fetchLocalizationAuditTrail', () => {
    it('returnerar ok=true med referensnummer och entries', async () => {
      const result = await fetchLocalizationAuditTrail('proj-audit-test');
      expect(result.ok).toBe(true);
      expect(result.projectId).toBe('proj-audit-test');
      expect(result.referenceNumber).toContain('proj-audit-test');
      expect(Array.isArray(result.entries)).toBe(true);
    });
  });
});
