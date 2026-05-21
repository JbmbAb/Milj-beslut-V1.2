/**
 * localizationOrchestrator — felfall och saknade grenar
 *
 * Täcker: parseSiteAlternatives edge cases, assertStrictReportUsable
 * (spatialDown+2 externa), validateLocalizationBody, fetchLocalizationAuditTrail.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLocalizationAuditTrail,
  runLocalizationReport,
  validateLocalizationBody,
} from '../../server/modules/localization/localizationOrchestrator';
import type { LocalizationReport } from '../../server/services/localizationReportService';

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

const AUTH = { id: 'user-1', organisationId: 'org-1', role: 'ADMIN' as const };
const PROJECT_ID = 'proj-lok-felfall';
const VALID_SITE = { id: 'alt-1', lat: 59.33, lng: 18.07 };

function makeReport(projectId = PROJECT_ID): LocalizationReport {
  return {
    projectId,
    generatedAt: '2026-05-21T10:00:00.000Z',
    siteAnalyses: [
      {
        site: { id: 'alt-1', lat: 59.33, lng: 18.07 },
        spatialAudit: {
          protectedAreaHits: [],
          protectedAreaAvailable: true,
          isProtected: false,
          sgu: { riskLevel: 'LOW', riskFactors: [], sources: [] },
          distanceToWaterMeters: null,
          distanceToWaterAvailable: true,
          text: 'OK',
          sources: [],
        },
        complianceAnalysis: {
          overallRisk: 'LOW',
          permitProbability: 0.8,
          restrictions: [],
          rules: [],
          summary: 'OK',
          violations: [],
          warnings: [],
          feasibilityScore: 80,
          recommendations: [],
        },
        monuments: [],
        vissWaterStatus: null,
        distanceToWaterMeters: null,
        dataSources: [],
        warnings: [],
        sluObservationCount: 0,
      },
    ],
    summary: { bestAlternativeId: 'alt-1', reasoning: 'Minst risk' },
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
      if (result.ok) return;
      expect(result.status).toBe(400);
    });

    it('returnerar 400 när array innehåller icke-objekt (null)', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [null],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });

    it('returnerar 400 när id saknas (tom sträng)', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [{ id: '', lat: 59.33, lng: 18.07 }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });

    it('returnerar 400 när koordinater inte är finita (NaN)', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [{ id: 'x', lat: NaN, lng: 18.07 }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });

    it('returnerar 400 när siteAlternatives inte är en array', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: 'not-an-array',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });

    it('returnerar 400 vid tomt projectId', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: '   ',
        siteAlternatives: [VALID_SITE],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });
  });

  // ── assertStrictReportUsable — spatialDown-gren ──────────────────────────

  describe('assertStrictReportUsable — spatialDown + externa otillgängliga', () => {
    it('kastar vid spatialDown och 2 externa otillgängliga (< 3 externa totalt)', async () => {
      const { isLocalizationStrictMode, generateLocalizationReport } = await import(
        '../../server/services/localizationReportService'
      );
      (isLocalizationStrictMode as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const base = makeReport();
      const badReport: LocalizationReport = {
        ...base,
        siteAnalyses: [
          {
            ...base.siteAnalyses[0],
            spatialAudit: {
              ...base.siteAnalyses[0].spatialAudit,
              protectedAreaAvailable: false,
              distanceToWaterAvailable: false,
            },
            dataSources: [
              { source: 'NVR API', status: 'unavailable' },
              { source: 'RAA API', status: 'unavailable' },
            ],
          },
        ],
      };
      (generateLocalizationReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce(badReport);

      await expect(
        runLocalizationReport({ authUser: AUTH, projectId: PROJECT_ID, siteAlternatives: [VALID_SITE] }),
      ).rejects.toThrow('Otillräcklig datakvalitet');
    });

    it('felmeddelande innehåller "degraderad" vid spatialDown', async () => {
      const { isLocalizationStrictMode, generateLocalizationReport } = await import(
        '../../server/services/localizationReportService'
      );
      (isLocalizationStrictMode as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const base = makeReport();
      const badReport: LocalizationReport = {
        ...base,
        siteAnalyses: [
          {
            ...base.siteAnalyses[0],
            spatialAudit: {
              ...base.siteAnalyses[0].spatialAudit,
              protectedAreaAvailable: false,
              distanceToWaterAvailable: false,
            },
            dataSources: [
              { source: 'NVR API', status: 'unavailable' },
              { source: 'RAA API', status: 'unavailable' },
            ],
          },
        ],
      };
      (generateLocalizationReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce(badReport);

      await expect(
        runLocalizationReport({ authUser: AUTH, projectId: PROJECT_ID, siteAlternatives: [VALID_SITE] }),
      ).rejects.toThrow('degraderad');
    });

    it('felmeddelande innehåller "delvis" när spatial INTE är nere (3 externa nere)', async () => {
      const { isLocalizationStrictMode, generateLocalizationReport } = await import(
        '../../server/services/localizationReportService'
      );
      (isLocalizationStrictMode as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const base = makeReport();
      const badReport: LocalizationReport = {
        ...base,
        siteAnalyses: [
          {
            ...base.siteAnalyses[0],
            spatialAudit: {
              ...base.siteAnalyses[0].spatialAudit,
              protectedAreaAvailable: true,
              distanceToWaterAvailable: true,
            },
            dataSources: [
              { source: 'NVR API', status: 'unavailable' },
              { source: 'RAA API', status: 'unavailable' },
              { source: 'VISS', status: 'unavailable' },
            ],
          },
        ],
      };
      (generateLocalizationReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce(badReport);

      await expect(
        runLocalizationReport({ authUser: AUTH, projectId: PROJECT_ID, siteAlternatives: [VALID_SITE] }),
      ).rejects.toThrow('delvis');
    });

    it('lyckas när strict mode och alla källor tillgängliga', async () => {
      const { isLocalizationStrictMode, generateLocalizationReport } = await import(
        '../../server/services/localizationReportService'
      );
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
