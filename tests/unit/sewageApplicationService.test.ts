import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSewageApplication,
  validateApplicationForSubmission,
  submitApplicationToMunicipality,
} from '../../server/services/sewageApplicationService';
import type { SewageProtectionProfile } from '../../types';

vi.mock('../../server/repositories/sewageApplicationRepository', () => ({
  createSewageApplicationRecord: vi.fn(),
  getSewageApplicationById: vi.fn(),
  updateSewageApplicationRecord: vi.fn(),
}));

vi.mock('../../server/services/sewageRegulationsService', () => ({
  generateSewageRequirementChecklist: vi.fn().mockReturnValue([]),
  validateSewageApplicationRegulations: vi.fn().mockReturnValue({ violations: [], warnings: [] }),
}));

vi.mock('../../src/application/evaluate-sewage-regulations.usecase', () => ({
  validateSewageApplicationRegulations: vi.fn().mockReturnValue({ violations: [], warnings: [] }),
}));

vi.mock('../../server/services/sewageDocumentGenerator', () => ({
  generateSewageApplicationDocuments: vi.fn().mockReturnValue({
    situationPlanSVG: '<svg>situation</svg>',
    crossSectionSVG: '<svg>cross</svg>',
    generatedAt: new Date().toISOString(),
  }),
}));

vi.mock('../../server/services/municipalitySubmissionService', () => ({
  submitSewageApplicationToMunicipality: vi.fn().mockResolvedValue({
    referenceNumber: 'SUB-0180-123',
    municipalityCode: '0180',
    municipalityContactEmail: 'kommun@test.se',
    submittedAt: new Date().toISOString(),
    estimatedProcessingDays: 30,
  }),
}));

import {
  createSewageApplicationRecord,
  getSewageApplicationById,
  updateSewageApplicationRecord,
} from '../../server/repositories/sewageApplicationRepository';

const profile: SewageProtectionProfile = {
  propertyId: 'prop-1',
  protectionLevel: 'NORMAL',
  reason: 'Test',
  nearestWell: { distance: 100, owner: 'OWN', coordinates: { lat: 59.3, lng: 18.0 } },
  nearestWaterCourse: { distance: 120, type: 'Bäck' },
  distanceToPropertyLine: 8,
  soilProfile: {
    soilType: 'Morän',
    depthToRock: 2,
    groundwaterLevel: 1,
    infiltrationCapacity: 'MEDIUM',
    permeability: 20,
  },
  floodRisk: 'LOW',
  protectedNatureNearby: false,
  recommendedSystem: 'INFILTRATION',
  timelineEstimateWeeks: 8,
  requiredGates: [],
};

describe('sewageApplicationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createSewageApplication forwards required fields to repository', async () => {
    vi.mocked(createSewageApplicationRecord).mockResolvedValue({
      id: 'app-1',
      referenceNumber: 'AVLOPP-app-1',
      organisationId: 'org-1',
      createdByUserId: 'user-1',
      projectId: 'proj-1',
      municipalityCode: '2180',
      pe: 5,
      propertyDesignation: 'GÄVLE BRYNÄS 1:1',
      latitude: 60.67,
      longitude: 17.14,
      applicantName: 'Anna Åberg',
      applicantEmail: 'anna@example.se',
      systemType: 'INFILTRATION',
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    const result = await createSewageApplication({
      projectId: 'proj-1',
      propertyDesignation: 'GÄVLE BRYNÄS 1:1',
      municipalityCode: '2180',
      pe: 5,
      gisAnalysis: {} as any,
      protectionProfile: profile,
      organisationId: 'org-1',
      createdByUserId: 'user-1',
      applicantName: 'Anna Åberg',
      applicantEmail: 'anna@example.se',
      latitude: 60.67,
      longitude: 17.14,
    });

    expect(createSewageApplicationRecord).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(createSewageApplicationRecord).mock.calls[0][0];
    expect(callArgs.domainSnapshot?.gates).toHaveLength(4);
    expect(result.projectId).toBe('proj-1');
  });

  it('validateApplicationForSubmission uses gates from domainSnapshot', async () => {
    const mockApp = {
      id: 'app-3',
      systemType: 'INFILTRATION',
      domainSnapshot: {
        protectionProfile: profile,
        gates: [{ id: 'gate-1', status: 'PENDING' }],
        soilTest: { ltar: 15, testDate: '2026-05-21' },
      },
    } as any;

    vi.mocked(getSewageApplicationById).mockResolvedValue(mockApp);
    const { validateSewageApplicationRegulations } =
      await import('../../src/application/evaluate-sewage-regulations.usecase');

    await validateApplicationForSubmission('app-3');

    expect(validateSewageApplicationRegulations).toHaveBeenCalledWith(
      expect.objectContaining({
        currentGates: expect.arrayContaining([expect.objectContaining({ id: 'gate-1' })]),
      }),
      expect.anything(),
    );
  });

  it('validateApplicationForSubmission returns blocker when app missing', async () => {
    vi.mocked(getSewageApplicationById).mockResolvedValue(null);

    const result = await validateApplicationForSubmission('missing-app');
    expect(result.canSubmit).toBe(false);
    expect(result.blockers).toContain('Application data missing');
  });

  it('submitApplicationToMunicipality updates status when app exists', async () => {
    vi.mocked(getSewageApplicationById).mockResolvedValue({
      id: 'app-2',
      referenceNumber: 'AVLOPP-app-2',
      organisationId: 'org-1',
      createdByUserId: 'user-1',
      projectId: 'proj-2',
      municipalityCode: '2180',
      pe: 5,
      propertyDesignation: 'STOCKHOLMS KOMMUN 1:1',
      latitude: 59.33,
      longitude: 18.07,
      applicantName: 'Bo Bäck',
      applicantEmail: 'bo@example.se',
      systemType: 'INFILTRATION',
      status: 'DRAFT',
      domainSnapshot: { protectionProfile: { ...profile, timelineEstimateWeeks: 9 } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    vi.mocked(updateSewageApplicationRecord).mockResolvedValue({} as any);

    const result = await submitApplicationToMunicipality('app-2', '0180');

    expect(result.success).toBe(true);
    expect(result.referenceNumber).toContain('0180');
    expect(updateSewageApplicationRecord).toHaveBeenCalledWith(
      'app-2',
      expect.objectContaining({ status: 'SUBMITTED' }),
    );
  });
});
