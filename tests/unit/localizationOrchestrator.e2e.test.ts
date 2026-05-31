/**
 * Fas 2 — Lokaliseringsutredning intern E2E
 *
 * Verifierar orchestratorns sekvens:
 *   runLocalizationReport → exportLocalizationPdf → fetchLocalizationAuditTrail
 *
 * generateLocalizationReport och assertProjectAccess mockas (externa API-anrop).
 * buildJsonPdfBuffer (PDFKit) körs mot riktig kod — inga externa anrop.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalizationDataUnavailableError,
  exportLocalizationPdf,
  fetchLocalizationAuditTrail,
  localizationAuditRef,
  runLocalizationReport,
  validateLocalizationBody,
} from '../../server/modules/localization/localizationOrchestrator';
import type { LocalizationReport } from '../../server/services/localizationReportService';
import type { AuthUser } from '../../server/security/types';

vi.mock('../../server/services/localizationReportService', () => ({
  generateLocalizationReport: vi.fn(),
  isLocalizationStrictMode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) },
  getAuditTrail: vi.fn().mockResolvedValue([
    {
      id: 'entry-1',
      timestamp: '2026-05-21T10:00:00.000Z',
      referenceNumber: 'LOK-proj-lok-e2e',
      action: 'APPLICATION_SUBMITTED',
      entity: 'SewageApplication',
      entityId: 'proj-lok-e2e',
      userId: 'user-1',
      description: 'Lokaliseringsutredning genererad',
      immutable: true,
    },
  ]),
}));

import {
  generateLocalizationReport,
  isLocalizationStrictMode,
} from '../../server/services/localizationReportService';

type SiteAnalysisResult = LocalizationReport['siteAnalyses'][number];

const AUTH: AuthUser = {
  id: 'user-1',
  organisationId: 'org-1',
  bankidId: 'bankid-user-1',
  role: 'ADMIN',
};
const PROJECT_ID = 'proj-lok-e2e';
const SITES = [
  { id: 'plats-A', lat: 59.3, lng: 18.07, name: 'Norra tomten' },
  { id: 'plats-B', lat: 67.0, lng: 20.5, name: 'Södra alternativen' },
];

function makeSpatialAudit(
  overrides: Partial<SiteAnalysisResult['spatialAudit']> = {},
): SiteAnalysisResult['spatialAudit'] {
  return {
    protectedAreaHits: [],
    protectedAreaAvailable: true,
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
    distanceToWaterMeters: 120,
    distanceToWaterAvailable: true,
    text: 'Spatial audit genomford.',
    sources: [],
    ...overrides,
  };
}

function makeSiteAnalysis(siteId: string, siteLat = 59.3, siteLng = 18.07): SiteAnalysisResult {
  return {
    site: { id: siteId, lat: siteLat, lng: siteLng, name: siteId },
    spatialAudit: makeSpatialAudit(),
    complianceAnalysis: {
      overallRisk: 'LOW',
      permitProbability: 0.75,
      restrictions: [],
      rules: [],
      summary: 'Lag risk enligt regelmotor.',
    },
    monuments: [],
    vissWaterStatus: null,
    distanceToWaterMeters: 120,
    dataSources: [
      { source: 'NVR API', status: 'ok' as const },
      { source: 'RAA API', status: 'ok' as const },
      { source: 'VISS', status: 'ok' as const },
      { source: 'SLU Artdata', status: 'ok' as const },
    ],
    warnings: [],
    sluObservationCount: 0,
  };
}

function makeReport(projectId = PROJECT_ID, siteIds = ['plats-A', 'plats-B']): LocalizationReport {
  return {
    projectId,
    generatedAt: '2026-05-21T10:00:00.000Z',
    siteAnalyses: siteIds.map((id) => makeSiteAnalysis(id)),
    summary: {
      bestAlternativeId: siteIds[0],
      reasoning: 'Plats A har bäst förutsättningar baserat på GIS och naturvärden.',
    },
    warnings: [],
    humanInTheLoop: 'Handläggare ska verifiera rapporten innan beslut fattas.',
  };
}

describe('Lokaliseringsutredning — intern E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLocalizationStrictMode).mockReturnValue(false);
    vi.mocked(generateLocalizationReport).mockResolvedValue(makeReport());
  });

  describe('runLocalizationReport', () => {
    it('returnerar rapport med siteAnalyses för giltiga platser', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: SITES,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.projectId).toBe(PROJECT_ID);
      expect(result.report.siteAnalyses).toHaveLength(2);
      expect(result.meta.strictMode).toBe(false);
      expect(result.meta.warningCount).toBe(0);
    });

    it('räknar warnings korrekt (rapport + per-site)', async () => {
      const reportWithWarnings: LocalizationReport = {
        ...makeReport(),
        warnings: ['Global varning'],
        siteAnalyses: [{ ...makeSiteAnalysis('plats-A'), warnings: ['Site-varning 1', 'Site-varning 2'] }],
      };
      vi.mocked(generateLocalizationReport).mockResolvedValue(reportWithWarnings);

      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: SITES,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.meta.warningCount).toBe(3); // 1 global + 2 site
    });

    it('returnerar 400 vid tomt projectId', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: '   ',
        siteAlternatives: SITES,
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });

    it('returnerar 400 vid ogiltiga koordinater (utanför Sverige)', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [{ id: 'utlandet', lat: 48.8, lng: 2.3 }],
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });

    it('strict mode + alla externa tillgängliga → lyckas', async () => {
      vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
      vi.mocked(generateLocalizationReport).mockResolvedValue(makeReport());

      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [{ id: 'plats-A', lat: 59.3, lng: 18.07 }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.meta.strictMode).toBe(true);
    });

    it('strict mode + 3 externa otillgängliga → kastar LocalizationDataUnavailableError', async () => {
      vi.mocked(isLocalizationStrictMode).mockReturnValue(true);
      const badReport: LocalizationReport = {
        ...makeReport(PROJECT_ID, ['plats-A']),
        siteAnalyses: [
          {
            ...makeSiteAnalysis('plats-A'),
            dataSources: [
              { source: 'NVR API', status: 'unavailable' },
              { source: 'RAA API', status: 'unavailable' },
              { source: 'VISS', status: 'unavailable' },
              { source: 'SLU Artdata', status: 'ok' },
            ],
          },
        ],
      };
      vi.mocked(generateLocalizationReport).mockResolvedValue(badReport);

      await expect(
        runLocalizationReport({
          authUser: AUTH,
          projectId: PROJECT_ID,
          siteAlternatives: [{ id: 'plats-A', lat: 59.3, lng: 18.07 }],
        }),
      ).rejects.toThrow(LocalizationDataUnavailableError);
    });

    it('humanInTheLoop-fält finns i rapporten', async () => {
      const result = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: SITES,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.humanInTheLoop).toContain('Handläggare');
    });
  });

  describe('exportLocalizationPdf', () => {
    it('returnerar Buffer och filnamn', async () => {
      const result = await exportLocalizationPdf({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: SITES,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.filename).toContain('lokaliseringsutredning');
      expect(result.filename).toContain(PROJECT_ID);
      expect(result.filename).toMatch(/\.pdf$/);
    });

    it('filnamnet saniteras (inga ogiltig tecken)', async () => {
      const result = await exportLocalizationPdf({
        authUser: AUTH,
        projectId: 'projekt/123 special',
        siteAlternatives: [{ id: 'A', lat: 59.3, lng: 18.07 }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filename).not.toContain('/');
      expect(result.filename).not.toContain(' ');
    });

    it('returnerar 400 för ogiltiga platser', async () => {
      const result = await exportLocalizationPdf({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: [],
      });
      expect(result.ok).toBe(false);
      expect('status' in result ? result.status : 0).toBe(400);
    });

    it('genererar PDF som börjar med PDF-magi-bytes (%PDF)', async () => {
      const result = await exportLocalizationPdf({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: SITES,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const header = result.buffer.slice(0, 4).toString('ascii');
      expect(header).toBe('%PDF');
    });
  });

  describe('fetchLocalizationAuditTrail', () => {
    it('returnerar ok:true och entries för projektet', async () => {
      const result = await fetchLocalizationAuditTrail(PROJECT_ID);

      expect(result.ok).toBe(true);
      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.referenceNumber).toBe(localizationAuditRef(PROJECT_ID));
      expect(Array.isArray(result.entries)).toBe(true);
      expect(result.entries).toHaveLength(1);
    });

    it('referenceNumber följer LOK-{projectId}-format', async () => {
      const result = await fetchLocalizationAuditTrail('mitt-projekt-123');
      expect(result.referenceNumber).toBe('LOK-mitt-projekt-123');
    });
  });

  describe('validateLocalizationBody (koordinatgräns)', () => {
    it('returnerar sites och projectId för giltiga koordinater', () => {
      const result = validateLocalizationBody({
        projectId: PROJECT_ID,
        siteAlternatives: SITES,
      });
      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.sites).toHaveLength(2);
    });

    it('nordligaste Svenska punkten: lat=69.5, lng=25.5 → accepteras', () => {
      const result = validateLocalizationBody({
        projectId: 'p',
        siteAlternatives: [{ id: 'nord', lat: 69.5, lng: 25.5 }],
      });
      expect(result.sites).toHaveLength(1);
    });

    it('sydligaste Svenska punkten: lat=55, lng=10 → accepteras', () => {
      const result = validateLocalizationBody({
        projectId: 'p',
        siteAlternatives: [{ id: 'syd', lat: 55.0, lng: 10.0 }],
      });
      expect(result.sites).toHaveLength(1);
    });
  });

  describe('Fullständigt flöde — rapport → PDF', () => {
    it('kör rapport och exporterar PDF för samma projekt', async () => {
      const reportResult = await runLocalizationReport({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: SITES,
      });
      expect(reportResult.ok).toBe(true);

      const pdfResult = await exportLocalizationPdf({
        authUser: AUTH,
        projectId: PROJECT_ID,
        siteAlternatives: SITES,
      });
      expect(pdfResult.ok).toBe(true);
      if (!pdfResult.ok) return;
      expect(pdfResult.buffer.length).toBeGreaterThan(0);

      const trailResult = await fetchLocalizationAuditTrail(PROJECT_ID);
      expect(trailResult.ok).toBe(true);
      expect(trailResult.referenceNumber).toBe(`LOK-${PROJECT_ID}`);
    });
  });
});
