import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/services/sewageRegulationsService', () => ({
  generateSewageRequirementChecklist: vi
    .fn()
    .mockReturnValue([{ id: 'soil-test-1', text: 'Perkolationsprov krävs' }]),
  validateSewageApplicationRegulations: vi.fn().mockReturnValue({
    violations: [],
    warnings: [],
  }),
}));

vi.mock('../../db.server', () => ({
  prisma: {},
}));

import {
  createSewageApplication,
  validateApplicationForSubmission,
  updateGateStatus,
  getPendingGates,
  submitApplicationToMunicipality,
  generateSubmissionSummary,
} from '../../server/services/sewageApplicationService';
import type { SewageApplication, SewageProtectionProfile } from '../../types';

const mockProfile: SewageProtectionProfile = {
  protectionLevel: 'HIGH',
  recommendedSystem: 'INFILTRATION',
  nearestWell: { distance: 100, onOwnLand: false },
  distanceToPropertyLine: 10,
  timelineEstimateWeeks: 8,
  soilCapacity: 'GOOD',
  groundwaterLevel: 0.5,
  slope: 2,
} as unknown as SewageProtectionProfile;

const mockGisAnalysis = {} as any;

describe('sewageApplicationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSewageApplication', () => {
    it('skapar en ansökan med rätt projektId och fastighetsbeteckning', async () => {
      const app = await createSewageApplication({
        projectId: 'proj-1',
        propertyDesignation: 'Gävle Brynäs 1:1',
        municipalityCode: '2180',
        pe: 5,
        gisAnalysis: mockGisAnalysis,
        protectionProfile: mockProfile,
      });

      expect(app.projectId).toBe('proj-1');
      expect(app.propertyDesignation).toBe('Gävle Brynäs 1:1');
      expect(app.status).toBe('DRAFT');
    });

    it('sätter soilTestCompleted till false initialt', async () => {
      const app = await createSewageApplication({
        projectId: 'proj-2',
        propertyDesignation: 'Stockholm Norrmalm 1:1',
        municipalityCode: '0180',
        pe: 3,
        gisAnalysis: mockGisAnalysis,
        protectionProfile: mockProfile,
      });

      expect(app.soilTestCompleted).toBe(false);
    });

    it('kräver grannemedgivande när brunn är nära (<50m)', async () => {
      const profile: SewageProtectionProfile = {
        ...mockProfile,
        nearestWell: { distance: 30, onOwnLand: false },
      } as unknown as SewageProtectionProfile;

      const app = await createSewageApplication({
        projectId: 'proj-3',
        propertyDesignation: 'Malmö 2:2',
        municipalityCode: '1280',
        pe: 2,
        gisAnalysis: mockGisAnalysis,
        protectionProfile: profile,
      });

      expect(app.neighborConsentRequired).toBe(true);
    });

    it('kräver ej grannemedgivande när brunn är långt bort (>50m)', async () => {
      const app = await createSewageApplication({
        projectId: 'proj-4',
        propertyDesignation: 'Umeå 3:3',
        municipalityCode: '2480',
        pe: 5,
        gisAnalysis: mockGisAnalysis,
        protectionProfile: mockProfile,
      });

      expect(app.neighborConsentRequired).toBe(false);
    });

    it('skapar gates inklusive SEWAGE_PROTECTION_LEVEL som COMPLETED', async () => {
      const app = await createSewageApplication({
        projectId: 'proj-5',
        propertyDesignation: 'Göteborg 4:4',
        municipalityCode: '1480',
        pe: 5,
        gisAnalysis: mockGisAnalysis,
        protectionProfile: mockProfile,
      });

      const protectionGate = app.currentGates.find((g) => g.id === 'gate-SEWAGE_PROTECTION_LEVEL');
      expect(protectionGate?.status).toBe('COMPLETED');
    });
  });

  describe('validateApplicationForSubmission', () => {
    const makeApp = (overrides: Partial<SewageApplication> = {}): SewageApplication =>
      ({
        id: 'app-1',
        projectId: 'proj-1',
        propertyDesignation: 'Test 1:1',
        pe: 5,
        selectedSystemType: 'SEPTIC',
        protectionProfile: mockProfile,
        soilTestCompleted: true,
        neighborConsentRequired: false,
        neighborConsentObtained: false,
        status: 'DRAFT',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentGates: [
          { id: 'gate-1', name: 'Gate 1', description: '', status: 'COMPLETED', priority: 'HIGH' },
        ],
        situationPlan: { url: 'http://example.com/plan.pdf' } as any,
        crossSection: { url: 'http://example.com/cross.pdf' } as any,
        ...overrides,
      }) as unknown as SewageApplication;

    it('kan skickas när alla villkor uppfylls', () => {
      const result = validateApplicationForSubmission(makeApp(), mockProfile);
      expect(result.canSubmit).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it('blockeras om kritiska gates ej är COMPLETED', () => {
      const app = makeApp({
        currentGates: [
          { id: 'gate-1', name: 'Kritisk gate', description: '', status: 'PENDING', priority: 'HIGH' },
        ],
      });

      const result = validateApplicationForSubmission(app, mockProfile);
      expect(result.canSubmit).toBe(false);
      expect(result.blockers.some((b) => b.includes('Kritisk gate'))).toBe(true);
    });

    it('blockeras om markundersökning saknas för INFILTRATION', () => {
      const app = makeApp({
        selectedSystemType: 'INFILTRATION',
        soilTestCompleted: false,
        currentGates: [
          { id: 'gate-1', name: 'Gate', description: '', status: 'COMPLETED', priority: 'HIGH' },
        ],
      });

      const result = validateApplicationForSubmission(app, mockProfile);
      expect(result.canSubmit).toBe(false);
      expect(result.blockers.some((b) => b.toLowerCase().includes('markundersökning'))).toBe(true);
    });

    it('blockeras om grannemedgivande krävs men saknas', () => {
      const app = makeApp({
        neighborConsentRequired: true,
        neighborConsentObtained: false,
        currentGates: [
          { id: 'gate-1', name: 'Gate', description: '', status: 'COMPLETED', priority: 'HIGH' },
        ],
      });

      const result = validateApplicationForSubmission(app, mockProfile);
      expect(result.canSubmit).toBe(false);
    });

    it('blockeras om situationsplan eller tvärsektion saknas', () => {
      const app = makeApp({ situationPlan: undefined, crossSection: undefined });
      const result = validateApplicationForSubmission(app, mockProfile);
      expect(result.canSubmit).toBe(false);
    });
  });

  describe('updateGateStatus', () => {
    it('uppdaterar status på angiven gate', () => {
      const gates: any[] = [
        { id: 'g-1', name: 'Gate 1', status: 'PENDING', priority: 'HIGH', description: '' },
        { id: 'g-2', name: 'Gate 2', status: 'PENDING', priority: 'HIGH', description: '' },
      ];

      const updated = updateGateStatus(gates, 'g-1', 'COMPLETED');
      expect(updated.find((g) => g.id === 'g-1')?.status).toBe('COMPLETED');
      expect(updated.find((g) => g.id === 'g-2')?.status).toBe('PENDING');
    });

    it('returnerar alla gates oförändrade om id inte hittas', () => {
      const gates: any[] = [{ id: 'g-1', status: 'PENDING', priority: 'HIGH', name: '', description: '' }];
      const updated = updateGateStatus(gates, 'non-existent', 'COMPLETED');
      expect(updated[0].status).toBe('PENDING');
    });
  });

  describe('getPendingGates', () => {
    it('returnerar bara PENDING gates', () => {
      const app: any = {
        currentGates: [
          { id: 'g-1', status: 'PENDING' },
          { id: 'g-2', status: 'COMPLETED' },
          { id: 'g-3', status: 'PENDING' },
        ],
      };

      const pending = getPendingGates(app as SewageApplication);
      expect(pending).toHaveLength(2);
      expect(pending.every((g) => g.status === 'PENDING')).toBe(true);
    });

    it('returnerar tom array när inga är PENDING', () => {
      const app: any = {
        currentGates: [{ id: 'g-1', status: 'COMPLETED' }],
      };
      expect(getPendingGates(app as SewageApplication)).toHaveLength(0);
    });
  });

  describe('submitApplicationToMunicipality', () => {
    it('returnerar success med referensnummer', async () => {
      const app: any = {
        protectionProfile: { timelineEstimateWeeks: 8 },
      };

      const result = await submitApplicationToMunicipality(app as SewageApplication, '2180');
      expect(result.success).toBe(true);
      expect(result.referenceNumber).toContain('2180');
      expect(result.submissionId).toBeTruthy();
      expect(result.estimatedProcessingTime).toBe(8);
    });
  });

  describe('generateSubmissionSummary', () => {
    it('returnerar objekt med referenceData', () => {
      const app: any = {
        propertyDesignation: 'Gävle 1:1',
        pe: 5,
        selectedSystemType: 'INFILTRATION',
        protectionProfile: { protectionLevel: 'HIGH' },
        status: 'SUBMITTED',
        situationPlan: null,
        crossSection: null,
        performanceDeclaration: null,
      };

      const summary = generateSubmissionSummary(app as SewageApplication);
      expect(summary).toHaveProperty('referenceData');
      expect((summary.referenceData as any).propertyDesignation).toBe('Gävle 1:1');
      expect((summary.referenceData as any).pe).toBe(5);
    });
  });
});
