import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSewageApplication,
  updateSoilTestResults,
  recordNeighborConsent,
  changeSewageSystem,
  validateApplicationForSubmission,
  submitApplicationToMunicipality,
} from '../../../server/services/sewageApplicationService';
import { __clearSewageApplicationStoreForTests } from '../../../server/repositories/sewageApplicationRepository';
import { prisma } from '../../../db.server';

vi.mock('../../../server/services/sewageRegulationsService', () => ({
  validateSewageApplicationRegulations: vi.fn().mockReturnValue({
    isCompliant: true,
    violations: [],
    warnings: [],
    recommendations: [],
  }),
}));

vi.mock('../../../server/services/municipalitySubmissionService', () => ({
  submitSewageApplicationToMunicipality: vi.fn().mockResolvedValue({
    referenceNumber: 'AVLOPP-2180-456',
    municipalityCode: '2180',
    municipalityContactEmail: 'kommun@test.se',
    submittedAt: new Date().toISOString(),
    estimatedProcessingDays: undefined,
  }),
}));

const BASE_REQUEST = {
  projectId: 'test-project',
  organisationId: 'org-1',
  createdByUserId: 'user-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  latitude: 60.67,
  longitude: 17.14,
  applicantName: 'Anna Åberg',
  applicantEmail: 'anna@example.se',
  systemType: 'INFILTRATION',
} as const;

describe('sewageApplicationService', () => {
  beforeEach(async () => {
    __clearSewageApplicationStoreForTests();
    vi.clearAllMocks();

    await prisma.organisation.upsert({
      where: { id: 'org-1' },
      update: {},
      create: { id: 'org-1', name: 'Test Org', orgNumber: '556000-0001', role: 'CLIENT' },
    });

    await prisma.project.upsert({
      where: { id: 'test-project' },
      update: {},
      create: {
        id: 'test-project',
        organisationId: 'org-1',
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        status: 'ACTIVE',
      },
    });
  });

  // ── createSewageApplication ───────────────────────────────────────────────

  describe('createSewageApplication', () => {
    it('skapar ansökan med status DRAFT', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      expect(app.status).toBe('DRAFT');
      expect(app.propertyDesignation).toBe('GÄVLE BRYNÄS 1:1');
    });

    it('sätter SOIL_TEST_COMPLETED gate till PENDING initialt', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const soilGate = app.domainSnapshot?.gates?.find((g) => g.id === 'gate-SOIL_TEST_COMPLETED');
      expect(soilGate?.status).toBe('PENDING');
    });

    it('NEIGHBOR_CONSENT gate PENDING när brunn < 50 m', async () => {
      const app = await createSewageApplication({
        ...BASE_REQUEST,
        protectionProfile: {
          propertyId: 'x',
          protectionLevel: 'NORMAL',
          reason: 'test',
          nearestWell: { distance: 30, owner: 'NEIGHBOR', coordinates: { lat: 60.67, lng: 17.14 } },
          nearestWaterCourse: { distance: 100, type: 'Bäck' },
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
      });
      const consentGate = app.domainSnapshot?.gates?.find((g) => g.id === 'gate-NEIGHBOR_CONSENT');
      expect(consentGate?.status).toBe('PENDING');
    });

    it('NEIGHBOR_CONSENT gate COMPLETED när brunn >= 50 m och tomtgräns >= 4.5 m', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const consentGate = app.domainSnapshot?.gates?.find((g) => g.id === 'gate-NEIGHBOR_CONSENT');
      expect(consentGate?.status).toBe('COMPLETED');
    });
  });

  // ── updateSoilTestResults ─────────────────────────────────────────────────

  describe('updateSoilTestResults', () => {
    it('lagrar LTAR och testdatum i domainSnapshot', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const updated = await updateSoilTestResults(app.id, 15, '2026-05-21');
      expect(updated?.domainSnapshot?.soilTest?.ltar).toBe(15);
      expect(updated?.domainSnapshot?.soilTest?.testDate).toBe('2026-05-21');
    });

    it('returnerar null för okänt ID', async () => {
      const result = await updateSoilTestResults('does-not-exist', 10, '2026-01-01');
      expect(result).toBeNull();
    });

    it('bevarar befintligt protectionProfile efter soilTest-uppdatering', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      await updateSoilTestResults(app.id, 20, '2026-05-01');
      const { getSewageApplicationById } =
        await import('../../../server/repositories/sewageApplicationRepository');
      const record = await getSewageApplicationById(app.id);
      expect(record?.domainSnapshot?.protectionProfile?.protectionLevel).toBe('NORMAL');
    });
  });

  // ── recordNeighborConsent ─────────────────────────────────────────────────

  describe('recordNeighborConsent', () => {
    it('sätter obtained=true med adress och avstånd', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const updated = await recordNeighborConsent(app.id, 'Granngatan 5', 35);
      expect(updated?.domainSnapshot?.neighborConsent?.obtained).toBe(true);
      expect(updated?.domainSnapshot?.neighborConsent?.address).toBe('Granngatan 5');
      expect(updated?.domainSnapshot?.neighborConsent?.distance).toBe(35);
    });

    it('kan explicit sätta obtained=false (nekat medgivande)', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const updated = await recordNeighborConsent(app.id, 'Granngatan 5', 35, false);
      expect(updated?.domainSnapshot?.neighborConsent?.obtained).toBe(false);
    });

    it('returnerar null för okänt ID', async () => {
      const result = await recordNeighborConsent('unknown', 'Gatan 1', 30);
      expect(result).toBeNull();
    });
  });

  // ── changeSewageSystem ────────────────────────────────────────────────────

  describe('changeSewageSystem', () => {
    it('uppdaterar systemType', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const newProfile = app.domainSnapshot!.protectionProfile!;
      const updated = await changeSewageSystem(app.id, 'SOIL_BED', newProfile);
      expect(updated?.systemType).toBe('SOIL_BED');
    });

    it('lagrar ny protectionProfile i snapshot', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const newProfile = {
        ...app.domainSnapshot!.protectionProfile!,
        protectionLevel: 'HIGH' as const,
      };
      await changeSewageSystem(app.id, 'MINI_PLANT_BDTA', newProfile);
      const { getSewageApplicationById } =
        await import('../../../server/repositories/sewageApplicationRepository');
      const record = await getSewageApplicationById(app.id);
      expect(record?.domainSnapshot?.protectionProfile?.protectionLevel).toBe('HIGH');
    });

    it('returnerar null för okänt ID', async () => {
      const dummy = {
        propertyId: 'x',
        protectionLevel: 'NORMAL' as const,
        reason: '',
        nearestWell: { distance: 80, owner: 'NEIGHBOR' as const, coordinates: { lat: 0, lng: 0 } },
        nearestWaterCourse: { distance: 100, type: '' },
        distanceToPropertyLine: 8,
        soilProfile: {
          soilType: '',
          depthToRock: 0,
          groundwaterLevel: 0,
          infiltrationCapacity: 'MEDIUM' as const,
          permeability: 0,
        },
        floodRisk: 'LOW' as const,
        protectedNatureNearby: false,
        recommendedSystem: 'INFILTRATION' as const,
        timelineEstimateWeeks: 8,
        requiredGates: [],
      };
      const result = await changeSewageSystem('bad-id', 'SOIL_BED', dummy);
      expect(result).toBeNull();
    });
  });

  // ── validateApplicationForSubmission ─────────────────────────────────────

  describe('validateApplicationForSubmission', () => {
    async function readyApp() {
      const app = await createSewageApplication(BASE_REQUEST);
      await updateSoilTestResults(app.id, 15, '2026-05-21');
      const { updateSewageApplicationRecord } =
        await import('../../../server/repositories/sewageApplicationRepository');
      await updateSewageApplicationRecord(app.id, {
        domainSnapshot: {
          ...app.domainSnapshot,
          soilTest: { ltar: 15, testDate: '2026-05-21' },
          generatedDocuments: {
            situationPlanSVG: '<svg/>',
            crossSectionSVG: '<svg/>',
            generatedAt: '2026-05-21T10:00:00Z',
          },
          gates: app.domainSnapshot!.gates!.map((g) => ({ ...g, status: 'COMPLETED' as const })),
        },
      });
      return app.id;
    }

    it('canSubmit=true när alla krav uppfyllda', async () => {
      const id = await readyApp();
      const result = await validateApplicationForSubmission(id);
      expect(result.canSubmit).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it('canSubmit=false och blocker för saknad situationsplan', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const result = await validateApplicationForSubmission(app.id);
      expect(result.canSubmit).toBe(false);
      expect(result.blockers.some((b) => b.includes('Situationsplan'))).toBe(true);
    });

    it('canSubmit=false och blocker för saknad tvärsektion', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const { updateSewageApplicationRecord } =
        await import('../../../server/repositories/sewageApplicationRepository');
      await updateSewageApplicationRecord(app.id, {
        domainSnapshot: {
          ...app.domainSnapshot,
          generatedDocuments: {
            situationPlanSVG: '<svg/>',
            crossSectionSVG: '',
            generatedAt: '2026-05-21T10:00:00Z',
          },
        },
      });
      const result = await validateApplicationForSubmission(app.id);
      expect(result.blockers.some((b) => b.includes('Tvärsektion'))).toBe(true);
    });

    it('canSubmit=false och blocker för saknad markundersökning (INFILTRATION)', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const { updateSewageApplicationRecord } =
        await import('../../../server/repositories/sewageApplicationRepository');
      await updateSewageApplicationRecord(app.id, {
        domainSnapshot: {
          ...app.domainSnapshot,
          soilTest: undefined,
          generatedDocuments: { situationPlanSVG: '<svg/>', crossSectionSVG: '<svg/>', generatedAt: '' },
          gates: app.domainSnapshot!.gates!.map((g) => ({ ...g, status: 'COMPLETED' as const })),
        },
      });
      const result = await validateApplicationForSubmission(app.id);
      expect(
        result.blockers.some((b) => b.includes('Markundersökning') || b.includes('markundersökning')),
      ).toBe(true);
    });

    it('canSubmit=false när HIGH-prioritet gate är PENDING', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      const result = await validateApplicationForSubmission(app.id);
      expect(result.canSubmit).toBe(false);
      const criticalBlocker = result.blockers.some((b) => b.includes('Kritiska steg'));
      expect(criticalBlocker).toBe(true);
    });

    it('returnerar canSubmit=false för okänt ID', async () => {
      const result = await validateApplicationForSubmission('no-such-id');
      expect(result.canSubmit).toBe(false);
      expect(result.blockers.some((b) => b.includes('missing'))).toBe(true);
    });
  });

  // ── submitApplicationToMunicipality ──────────────────────────────────────

  describe('submitApplicationToMunicipality', () => {
    async function ensureRequirementCaseExists(appId: string) {
      const docId = `doc-${appId}`;
      await prisma.documentRecord.upsert({
        where: { id: docId },
        update: {},
        create: {
          id: docId,
          projectId: 'test-project',
          organisationId: 'org-1',
          originalName: `test-${appId}.pdf`,
          diskName: `disk-${appId}`,
          absolutePath: `/test/path/${appId}`,
          entryId: `entry-${appId}`,
          subject: 'Test Subject',
          status: 'METADATA_ONLY',
        },
      });

      await prisma.requirementCase.upsert({
        where: { id: appId },
        update: {},
        create: {
          id: appId,
          caseKey: `CASE-${appId}`,
          projectId: 'test-project',
          documentId: docId,
          organisationId: 'org-1',
          sourceFile: 'test.pdf',
        },
      });
    }

    it('returnerar success=true med referensnummer för känd ansökan', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      await ensureRequirementCaseExists(app.id);
      const result = await submitApplicationToMunicipality(app.id, '2180');
      expect(result.success).toBe(true);
      expect(result.referenceNumber).toContain('AVLOPP-2180');
      expect(result.submissionId).toBeDefined();
    });

    it('returnerar success=false för okänt ID', async () => {
      const result = await submitApplicationToMunicipality('does-not-exist', '2180');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('använder timelineEstimateWeeks från protectionProfile', async () => {
      const app = await createSewageApplication(BASE_REQUEST);
      await ensureRequirementCaseExists(app.id);
      const { updateSewageApplicationRecord } =
        await import('../../../server/repositories/sewageApplicationRepository');
      await updateSewageApplicationRecord(app.id, {
        domainSnapshot: {
          protectionProfile: {
            propertyId: 'x',
            protectionLevel: 'NORMAL',
            reason: 'test',
            nearestWell: { distance: 80, owner: 'NEIGHBOR', coordinates: { lat: 60, lng: 17 } },
            nearestWaterCourse: { distance: 100, type: 'Bäck' },
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
            timelineEstimateWeeks: 12,
            requiredGates: [],
          },
        },
      });
      const result = await submitApplicationToMunicipality(app.id, '2180');
      expect(result.success).toBe(true);
      expect(result.estimatedProcessingTime).toBe(12);
    });
  });
});
