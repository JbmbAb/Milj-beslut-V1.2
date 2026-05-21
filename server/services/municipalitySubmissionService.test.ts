import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { submitSewageApplicationToMunicipality } from './municipalitySubmissionService';
import * as notificationService from './notificationService';
import { PrismaSubmissionRepository } from '../../src/infrastructure/prisma-submission-repository';
import type { SewageApplication, SewageProtectionProfile } from '../../types';
import { SubmissionStatus } from '../../src/domain/submission';

// Mock dependencies
vi.mock('./notificationService', () => ({
  sendEmailNotification: vi.fn(),
}));

vi.mock('./documentGenerator', () => ({
  generateApplicationDraft: vi.fn().mockResolvedValue({
    id: 'doc-123',
    originalName: 'Anmälan Utkast.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }),
}));

vi.mock('../../src/infrastructure/prisma-submission-repository');

const mockSubmissionRepo = {
  save: vi.fn(),
  logStatusEvent: vi.fn(),
  addArtifact: vi.fn(),
};

describe('municipalitySubmissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock the repository implementation
    PrismaSubmissionRepository.prototype.save = mockSubmissionRepo.save;
    PrismaSubmissionRepository.prototype.logStatusEvent = mockSubmissionRepo.logStatusEvent;
    PrismaSubmissionRepository.prototype.addArtifact = mockSubmissionRepo.addArtifact;

    // Mock the save function to return a submission object
    mockSubmissionRepo.save.mockImplementation((submission) =>
      Promise.resolve({ ...submission, id: submission.id || `sub-${Date.now()}` }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const application: SewageApplication = {
    id: 'app-1',
    projectId: 'proj-1',
    propertyDesignation: 'TESTFASTIGHET 1:1',
    selectedSystemType: 'INFILTRATION',
    protectionProfile: {
      propertyId: 'app-1',
      protectionLevel: 'HIGH',
      reason: 'Test',
      nearestWell: {
        distance: 120,
        owner: 'OWN',
        coordinates: { lat: 59.33, lng: 18.06 },
      },
      nearestWaterCourse: { distance: 300, type: 'Bäck' },
      distanceToPropertyLine: 10,
      soilProfile: {
        soilType: 'Morän',
        depthToRock: 2,
        groundwaterLevel: 1.5,
        infiltrationCapacity: 'MEDIUM',
        permeability: 20,
      },
      floodRisk: 'LOW',
      protectedNatureNearby: false,
      recommendedSystem: 'INFILTRATION',
      timelineEstimateWeeks: 6,
      requiredGates: [],
    },
    soilTestCompleted: false,
    neighborConsentRequired: false,
    status: 'DRAFT',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentGates: [],
    pe: 5,
  };

  const protectionProfile: SewageProtectionProfile = {
    propertyId: 'app-1',
    protectionLevel: 'HIGH',
    reason: 'Test',
    nearestWell: {
      distance: 120,
      owner: 'OWN',
      coordinates: { lat: 59.33, lng: 18.06 },
    },
    nearestWaterCourse: { distance: 300, type: 'Bäck' },
    distanceToPropertyLine: 10,
    soilProfile: {
      soilType: 'Morän',
      depthToRock: 2,
      groundwaterLevel: 1.5,
      infiltrationCapacity: 'MEDIUM',
      permeability: 20,
    },
    floodRisk: 'LOW',
    protectedNatureNearby: false,
    recommendedSystem: 'INFILTRATION',
    timelineEstimateWeeks: 6,
    requiredGates: [],
  };

  it('should call sendEmailNotification when municipality endpoint is missing but a registrar email exists', async () => {
    const municipalityCodeWithRegistrar = '0180'; // Stockholm, has a registrarEmail in the service

    await submitSewageApplicationToMunicipality(
      application,
      protectionProfile,
      municipalityCodeWithRegistrar,
      '<svg>situationsplan</svg>',
      '<svg>tvarsektion</svg>',
      'test@example.com',
      'proj-1',
      'org-1',
    );

    // Verify that the fallback logic was triggered and sent an email
    expect(notificationService.sendEmailNotification).toHaveBeenCalledOnce();
    const emailParams = (notificationService.sendEmailNotification as any).mock.calls[0][0];

    expect(emailParams.to).toBe('registrator.miljo@stockholm.se');
    expect(emailParams.subject).toContain('Ny anmälan om enskilt avlopp');
    expect(emailParams.subject).toContain(application.propertyDesignation);
    expect(emailParams.body).toContain(application.propertyDesignation);
    expect(emailParams.attachments).toHaveLength(2);
    expect(emailParams.attachments[0].filename).toBe('situationsplan.svg');
  });

  it('should queue submission for manual dispatch if endpoint and registrar email are both missing', async () => {
    const unknownMunicipalityCode = '9999';

    await submitSewageApplicationToMunicipality(
      application,
      protectionProfile,
      unknownMunicipalityCode,
      '<svg>situationsplan</svg>',
      '<svg>tvarsektion</svg>',
      'test@example.com',
      'proj-1',
      'org-1',
    );

    // Should not attempt to send an email
    expect(notificationService.sendEmailNotification).not.toHaveBeenCalled();

    // Should log the initial "prepared" status
    expect(mockSubmissionRepo.logStatusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubmissionStatus.PREPARED,
      }),
    );

    // Should log that it's queued for manual dispatch
    const lastLogCall = mockSubmissionRepo.logStatusEvent.mock.calls.at(-1)[0];
    expect(lastLogCall).toEqual(
      expect.objectContaining({
        status: SubmissionStatus.PENDING_REVIEW,
        summary: 'Endpoint not configured and no registrar email found. Queued for manual dispatch.',
      }),
    );
  });
});
