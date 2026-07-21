/**
 * Fas 2 — Enskilt avlopp intern E2E (in-memory store)
 *
 * Verifierar att orchestratorns sekvens fungerar end-to-end:
 *   createRecord → recordSoilTest → generateDocumentsForApplication
 *     → validateSewageApplication (canSubmit) → submitSewageApplication
 *
 * Repositories använder in-memory store (NODE_ENV=test).
 * Municipality-integration mockas för att testa lycklig inlämningsväg.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateDocumentsForApplication,
  recordNeighborConsent,
  recordSoilTest,
  submitSewageApplication,
  validateSewageApplication,
} from '../../server/modules/sewage/applicationOrchestrator';
import {
  createSewageApplicationRecord,
  getSewageApplicationById,
} from '../../server/repositories/sewageApplicationRepository';
import type { SewageDomainSnapshot } from '../../server/repositories/sewageApplicationRepository';

vi.mock('../../server/services/municipalitySubmissionService', () => ({
  submitSewageApplicationToMunicipality: vi.fn().mockResolvedValue({
    referenceNumber: 'MUN-2180-TEST-001',
    municipalityCode: '2180',
    municipalityContactEmail: 'miljo@gavle.se',
    estimatedProcessingDays: 42,
    submittedAt: new Date().toISOString(),
  }),
}));

vi.mock('../../server/services/sewageRegulationsService', () => ({
  validateSewageApplicationRegulations: vi.fn().mockReturnValue({
    isCompliant: true,
    violations: [],
    warnings: [],
    recommendations: [],
  }),
}));

// auditTrail används inte direkt i sewage orchestrator — ingen mock behövs

const AUTH = { id: 'user-1', organisationId: 'org-1', role: 'ADMIN', bankidId: undefined };

// Byggblock: domainSnapshot med allt förberett utom generatedDocuments
const READY_SNAPSHOT: SewageDomainSnapshot = {
  protectionProfile: {
    propertyId: 'prop-1',
    protectionLevel: 'NORMAL',
    reason: 'Test',
    nearestWell: { distance: 80, owner: 'NEIGHBOR', coordinates: { lat: 60.67, lng: 17.14 } },
    nearestWaterCourse: { distance: 120, type: 'Bäck' },
    distanceToPropertyLine: 8,
    soilProfile: {
      soilType: 'Morän',
      depthToRock: 3,
      groundwaterLevel: 2,
      infiltrationCapacity: 'MEDIUM',
      permeability: 20,
    },
    floodRisk: 'LOW',
    protectedNatureNearby: false,
    recommendedSystem: 'INFILTRATION',
    timelineEstimateWeeks: 8,
    requiredGates: [],
  },
  gisAnalysis: {
    propertyId: 'prop-1',
    timestamp: '2026-05-21T10:00:00.000Z',
    sguJordartData: { soilType: 'Morän', depthToRock: 3, groundwaterLevel: 2, loadingCapacity: 'MEDIUM' },
    sguBrunnarData: {
      nearestNeighborWells: [],
      nearestOwnWell: { distance: 80, coordinates: { lat: 60.67, lng: 17.14 } },
    },
    protectedAreas: [],
    propertyBoundaries: { area: 2500, perimeter: 200, nearestNeighbor: 8 },
    floodRiskZone: { level: 'LOW', floodFrequency: '1:100 år' },
    overallRiskScore: 35,
    feasibilityScore: 70,
    recommendedSystems: ['INFILTRATION'],
    blockedSystems: [],
    reasoning: ['Test GIS'],
  },
  soilTest: { ltar: 15, testDate: '2026-05-21' },
  // gates: alla HIGH-prioritet COMPLETED
  gates: [
    { id: 'gate-SEWAGE_PROTECTION_LEVEL', name: 'Skyddsnivå', description: '', status: 'COMPLETED', priority: 'HIGH' },
    { id: 'gate-SOIL_TEST_COMPLETED', name: 'Markundersökning', description: '', status: 'COMPLETED', priority: 'HIGH' },
    { id: 'gate-NEIGHBOR_CONSENT', name: 'Grannemedgivande', description: '', status: 'COMPLETED', priority: 'MEDIUM' },
    { id: 'gate-DOCUMENTATION_COMPLETE', name: 'Dokumentation', description: '', status: 'COMPLETED', priority: 'HIGH' },
  ],
};

async function createTestApp(
  snapshotOverrides: Partial<typeof READY_SNAPSHOT> = {},
  recordOverrides: { municipalityCode?: string } = {},
) {
  return createSewageApplicationRecord({
    organisationId: 'org-1',
    createdByUserId: 'user-1',
    projectId: 'proj-sewage-e2e',
    municipalityCode: '2180',
    pe: 5,
    propertyDesignation: 'GÄVLE BRYNÄS 1:1',
    latitude: 60.67,
    longitude: 17.14,
    applicantName: 'Anna Åberg',
    applicantEmail: 'anna@example.se',
    systemType: 'INFILTRATION',
    status: 'DRAFT',
    ...recordOverrides,
    domainSnapshot: { ...READY_SNAPSHOT, ...snapshotOverrides },
  });
}

describe('Sewage enskilt avlopp — intern E2E (in-memory)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordSoilTest', () => {
    it('lägger till soilTest i domainSnapshot', async () => {
      const app = await createTestApp({ soilTest: undefined });
      const result = await recordSoilTest(app.id, { ltar: 20, testDate: '2026-05-20' });

      expect(result.ok).toBe(true);
      const record = await getSewageApplicationById(app.id);
      expect(record?.domainSnapshot?.soilTest?.ltar).toBe(20);
      expect(record?.domainSnapshot?.soilTest?.testDate).toBe('2026-05-20');
    });

    it('bevarar befintlig snapshot när soilTest läggs till', async () => {
      const app = await createTestApp();
      await recordSoilTest(app.id, { ltar: 18, testDate: '2026-05-21' });

      const record = await getSewageApplicationById(app.id);
      // protectionProfile ska fortfarande finnas
      expect(record?.domainSnapshot?.protectionProfile?.protectionLevel).toBe('NORMAL');
    });
  });

  describe('recordNeighborConsent', () => {
    it('sätter neighborConsent.obtained = true', async () => {
      const app = await createTestApp();
      const result = await recordNeighborConsent(app.id, {
        address: 'Grannvägen 5',
        distance: 35,
      });

      expect(result.ok).toBe(true);
      const record = await getSewageApplicationById(app.id);
      expect(record?.domainSnapshot?.neighborConsent?.obtained).toBe(true);
      expect(record?.domainSnapshot?.neighborConsent?.address).toBe('Grannvägen 5');
    });
  });

  describe('generateDocumentsForApplication', () => {
    it('genererar situationsplan och tvärsektion SVG', async () => {
      const app = await createTestApp();
      const result = await generateDocumentsForApplication(app.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.situationPlanSVG).toContain('<svg');
      expect(result.crossSectionSVG).toContain('<svg');
      expect(result.generatedAt).toBeTruthy();
    });

    it('lagrar genererade dokument i domainSnapshot', async () => {
      const app = await createTestApp();
      await generateDocumentsForApplication(app.id);

      const record = await getSewageApplicationById(app.id);
      expect(record?.domainSnapshot?.generatedDocuments?.situationPlanSVG).toBeTruthy();
      expect(record?.domainSnapshot?.generatedDocuments?.crossSectionSVG).toBeTruthy();
    });

    it('inga varningar när protectionProfile finns i body', async () => {
      const app = await createTestApp();
      const result = await generateDocumentsForApplication(app.id, {
        protectionProfile: READY_SNAPSHOT.protectionProfile,
        gisAnalysis: READY_SNAPSHOT.gisAnalysis,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const gisWarnings = result.warnings.filter((w) => w.includes('saknas'));
      expect(gisWarnings).toHaveLength(0);
    });
  });

  describe('validateSewageApplication', () => {
    it('canSubmit = true efter dokument genererats (alla gates COMPLETED, soilTest finns)', async () => {
      const app = await createTestApp();
      await generateDocumentsForApplication(app.id);

      const result = await validateSewageApplication(app.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.canSubmit).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it('canSubmit = false om dokument saknas (situationsplan)', async () => {
      // Skapa app utan generatedDocuments
      const app = await createTestApp({ generatedDocuments: undefined });

      const result = await validateSewageApplication(app.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.canSubmit).toBe(false);
      expect(result.blockers.some((b) => b.includes('Situationsplan'))).toBe(true);
    });

    it('canSubmit = false om soilTest saknas för INFILTRATION-system', async () => {
      const app = await createTestApp({ soilTest: undefined });
      await generateDocumentsForApplication(app.id);

      const result = await validateSewageApplication(app.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.canSubmit).toBe(false);
      expect(result.blockers.some((b) => b.includes('Markundersökning'))).toBe(true);
    });

    it('canSubmit = false om grannemedgivande saknas när brunn < 50m', async () => {
      // Skapa app med brunn 30m bort (grannemedgivande krävs) men inget consent registrerat
      const profileCloseWell = {
        ...READY_SNAPSHOT.protectionProfile!,
        nearestWell: { ...READY_SNAPSHOT.protectionProfile!.nearestWell, distance: 30 },
      };
      const app = await createTestApp({
        protectionProfile: profileCloseWell,
        neighborConsent: undefined,
      });
      await generateDocumentsForApplication(app.id);

      const result = await validateSewageApplication(app.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.canSubmit).toBe(false);
      expect(result.blockers.some((b) => b.includes('Grannemedgivande'))).toBe(true);
    });
  });

  describe('submitSewageApplication', () => {
    it('returnerar referensnummer och uppdaterar status till SUBMITTED', async () => {
      const app = await createTestApp();
      await generateDocumentsForApplication(app.id);

      const result = await submitSewageApplication(app.id, AUTH, {
        municipalityCode: '2180',
        projectId: 'proj-sewage-e2e',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.referenceNumber).toBe('MUN-2180-TEST-001');
      expect(result.municipalityCode).toBe('2180');

      const record = await getSewageApplicationById(app.id);
      expect(record?.status).toBe('SUBMITTED');
      expect(record?.municipalityReference).toBe('MUN-2180-TEST-001');
    });

    it('blockeras av validering om dokument saknas', async () => {
      const app = await createTestApp({ generatedDocuments: undefined, soilTest: undefined });

      const result = await submitSewageApplication(app.id, AUTH, {
        municipalityCode: '2180',
        projectId: 'proj-sewage-e2e',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.error).toBe('validation_failed');
    });

    it('returnerar 400 när municipalityCode saknas', async () => {
      const app = await createTestApp({}, { municipalityCode: undefined });

      const result = await submitSewageApplication(app.id, AUTH, {
        municipalityCode: '',
        projectId: 'proj-sewage-e2e',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // It might return 422 if validation happens first, but we want 400 for missing code.
      // Based on implementation, it checks code first, so 400 is expected.
      expect(result.status).toBe(400);
    });

    it('returnerar 404 för okänt ansöknings-id', async () => {
      const result = await submitSewageApplication('unknown-id', AUTH, {
        municipalityCode: '2180',
        projectId: 'proj-x',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });
  });

  it('Fullständigt flöde — createRecord → soilTest → consent → docs → validate → submit', async () => {
    // Skapa app med brunn 30m bort (grannemedgivande krävs)
    const closeWellProfile = {
      ...READY_SNAPSHOT.protectionProfile!,
      nearestWell: { ...READY_SNAPSHOT.protectionProfile!.nearestWell, distance: 30 },
    };
    const closerGates = READY_SNAPSHOT.gates!.map((g) =>
      g.id === 'gate-NEIGHBOR_CONSENT' ? { ...g, status: 'PENDING' as const } : g,
    );

    const app = await createTestApp({
      protectionProfile: closeWellProfile,
      soilTest: undefined,
      neighborConsent: undefined,
      generatedDocuments: undefined,
      gates: closerGates,
    });

    // Registrera markundersökning
    const soilResult = await recordSoilTest(app.id, { ltar: 12, testDate: '2026-05-21' });
    expect(soilResult.ok).toBe(true);

    // Registrera grannemedgivande
    const consentResult = await recordNeighborConsent(app.id, { address: 'Grannv. 3', distance: 30 });
    expect(consentResult.ok).toBe(true);

    // Generera dokument
    const docsResult = await generateDocumentsForApplication(app.id);
    expect(docsResult.ok).toBe(true);

    // Uppdatera gates manuellt till COMPLETED för att reflektera utförda steg
    const { updateSewageApplicationRecord, getSewageApplicationById: getApp } = await import(
      '../../server/repositories/sewageApplicationRepository'
    );
    const currentApp = await getApp(app.id);
    await updateSewageApplicationRecord(app.id, {
      domainSnapshot: {
        ...currentApp?.domainSnapshot,
        gates: READY_SNAPSHOT.gates!,
      },
    });

    // Validera
    const valResult = await validateSewageApplication(app.id);
    expect(valResult.ok, `Validation failed: ${JSON.stringify(valResult)}`).toBe(true);
    if (!valResult.ok) return;
    expect(valResult.canSubmit, `Blockers: ${valResult.blockers.join(', ')}`).toBe(true);
    expect(valResult.blockers).toHaveLength(0);

    // Lämna in
    const submitResult = await submitSewageApplication(app.id, AUTH, {
      municipalityCode: '2180',
      projectId: 'proj-sewage-e2e',
    });
    expect(submitResult.ok, `Submission failed: ${JSON.stringify(submitResult)}`).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.referenceNumber).toBeTruthy();

    const record = await getApp(app.id);
    expect(record?.status).toBe('SUBMITTED');
  });
});
