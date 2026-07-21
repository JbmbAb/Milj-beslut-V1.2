import { describe, expect, it, vi } from 'vitest';
import {
  recordStatusToDomain,
  resolveDomainContext,
} from '../../server/modules/sewage/applicationOrchestrator';
import type { SewageApplicationRecord } from '../../server/repositories/sewageApplicationRepository';
import type { SewageProtectionProfile, SewageGISAnalysis } from '../../types';

vi.mock('../../server/repositories/sewageApplicationRepository', () => ({
  updateSewageApplicationRecord: vi.fn(),
  getSewageApplicationById: vi.fn(),
  createSewageApplicationRecord: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<SewageApplicationRecord> = {}): SewageApplicationRecord {
  return {
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
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

const fullProfile: SewageProtectionProfile = {
  propertyId: 'prop-1',
  protectionLevel: 'NORMAL',
  reason: 'Test-profil',
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
};

const fullGis: SewageGISAnalysis = {
  propertyId: 'prop-1',
  timestamp: '2026-05-01T10:00:00.000Z',
  sguJordartData: { soilType: 'Morän', depthToRock: 3, groundwaterLevel: 2, loadingCapacity: 'MEDIUM' },
  sguBrunnarData: { nearestNeighborWells: [], nearestOwnWell: { distance: 80, coordinates: { lat: 60.67, lng: 17.14 } } },
  protectedAreas: [],
  propertyBoundaries: { area: 2500, perimeter: 200, nearestNeighbor: 8 },
  floodRiskZone: { level: 'LOW', floodFrequency: '1:100 år' },
  overallRiskScore: 35,
  feasibilityScore: 70,
  recommendedSystems: ['INFILTRATION'],
  blockedSystems: [],
  reasoning: ['Test GIS'],
};

// ─── recordStatusToDomain ─────────────────────────────────────────────────────

describe('recordStatusToDomain', () => {
  it('IN_REVIEW → UNDER_REVIEW', () => {
    expect(recordStatusToDomain('IN_REVIEW')).toBe('UNDER_REVIEW');
  });

  it('DECISION → APPROVED', () => {
    expect(recordStatusToDomain('DECISION')).toBe('APPROVED');
  });

  it('SUBMITTED → SUBMITTED', () => {
    expect(recordStatusToDomain('SUBMITTED')).toBe('SUBMITTED');
  });

  it('DRAFT → DRAFT', () => {
    expect(recordStatusToDomain('DRAFT')).toBe('DRAFT');
  });

  it('REJECTED → DRAFT (default fallback)', () => {
    expect(recordStatusToDomain('REJECTED')).toBe('DRAFT');
  });

  it('APPROVED → DRAFT (default fallback)', () => {
    expect(recordStatusToDomain('APPROVED')).toBe('DRAFT');
  });
});

// ─── resolveDomainContext ─────────────────────────────────────────────────────

describe('resolveDomainContext', () => {
  describe('protectionProfile resolution', () => {
    it('uses body.protectionProfile when provided — no warning', () => {
      const { protectionProfile, warnings } = resolveDomainContext(makeRecord(), {
        protectionProfile: fullProfile,
      });
      expect(protectionProfile).toBe(fullProfile);
      expect(warnings.some((w) => w.includes('protectionProfile'))).toBe(false);
    });

    it('uses snapshot.protectionProfile when no body — no warning', () => {
      const record = makeRecord({ domainSnapshot: { protectionProfile: fullProfile } });
      const { protectionProfile, warnings } = resolveDomainContext(record);
      expect(protectionProfile).toEqual(fullProfile);
      expect(warnings.some((w) => w.includes('protectionProfile'))).toBe(false);
    });

    it('falls back to default profile when neither body nor snapshot — emits warning', () => {
      const { protectionProfile, warnings } = resolveDomainContext(makeRecord());
      expect(protectionProfile.protectionLevel).toBe('NORMAL');
      expect(warnings.some((w) => w.includes('protectionProfile saknas'))).toBe(true);
    });
  });

  describe('gisAnalysis resolution', () => {
    it('uses body.gisAnalysis when provided — no gis warning', () => {
      const { gisAnalysis, warnings } = resolveDomainContext(makeRecord(), {
        gisAnalysis: fullGis,
      });
      expect(gisAnalysis).toBe(fullGis);
      expect(warnings.some((w) => w.includes('gisAnalysis'))).toBe(false);
    });

    it('uses snapshot.gisAnalysis when no body — no gis warning', () => {
      const record = makeRecord({ domainSnapshot: { gisAnalysis: fullGis } });
      const { gisAnalysis, warnings } = resolveDomainContext(record);
      expect(gisAnalysis).toEqual(fullGis);
      expect(warnings.some((w) => w.includes('gisAnalysis'))).toBe(false);
    });

    it('falls back to default gis when neither body nor snapshot — emits warning', () => {
      const { gisAnalysis, warnings } = resolveDomainContext(makeRecord());
      expect(gisAnalysis.propertyId).toBe('app-1');
      expect(warnings.some((w) => w.includes('gisAnalysis saknas'))).toBe(true);
    });
  });

  describe('neighborConsentRequired', () => {
    it('neighborConsentRequired = true when well distance < 50', () => {
      const profile = { ...fullProfile, nearestWell: { ...fullProfile.nearestWell, distance: 30 } };
      const { application } = resolveDomainContext(makeRecord(), { protectionProfile: profile });
      expect(application.neighborConsentRequired).toBe(true);
    });

    it('neighborConsentRequired = false when well distance >= 50', () => {
      const profile = { ...fullProfile, nearestWell: { ...fullProfile.nearestWell, distance: 80 } };
      const { application } = resolveDomainContext(makeRecord(), { protectionProfile: profile });
      expect(application.neighborConsentRequired).toBe(false);
    });

    it('neighborConsentRequired = false at exactly 50m', () => {
      const profile = { ...fullProfile, nearestWell: { ...fullProfile.nearestWell, distance: 50 } };
      const { application } = resolveDomainContext(makeRecord(), { protectionProfile: profile });
      expect(application.neighborConsentRequired).toBe(false);
    });
  });

  describe('soilTest from snapshot', () => {
    it('soilTestCompleted = true when snapshot contains soilTest', () => {
      const record = makeRecord({
        domainSnapshot: { soilTest: { ltar: 15, testDate: '2026-05-20' } },
      });
      const { application } = resolveDomainContext(record, { protectionProfile: fullProfile });
      expect(application.soilTestCompleted).toBe(true);
      expect(application.ltar).toBe(15);
      expect(application.percolationTestDate).toBe('2026-05-20');
    });

    it('soilTestCompleted = false when no soilTest in snapshot', () => {
      const { application } = resolveDomainContext(makeRecord(), { protectionProfile: fullProfile });
      expect(application.soilTestCompleted).toBe(false);
      expect(application.ltar).toBeUndefined();
    });
  });

  describe('neighborConsent from snapshot', () => {
    it('neighborConsentObtained = true from snapshot', () => {
      const record = makeRecord({
        domainSnapshot: {
          neighborConsent: { address: 'Grannvägen 1', distance: 35, obtained: true },
        },
      });
      const { application } = resolveDomainContext(record, { protectionProfile: fullProfile });
      expect(application.neighborConsentObtained).toBe(true);
      expect(application.neighborDetails?.address).toBe('Grannvägen 1');
      expect(application.neighborDetails?.distance).toBe(35);
    });

    it('neighborConsentObtained = false when no consent in snapshot', () => {
      const { application } = resolveDomainContext(makeRecord(), { protectionProfile: fullProfile });
      expect(application.neighborConsentObtained).toBe(false);
      expect(application.neighborDetails).toBeUndefined();
    });
  });

  describe('gates', () => {
    it('uses body currentGates when provided', () => {
      const customGates = [{ id: 'gate-custom', name: 'Custom', description: '', status: 'COMPLETED' as const, priority: 'HIGH' as const }];
      const { application } = resolveDomainContext(makeRecord(), {
        protectionProfile: fullProfile,
        application: { currentGates: customGates },
      });
      expect(application.currentGates).toEqual(customGates);
    });

    it('builds default DOCUMENTATION gate as PENDING when no documents in snapshot', () => {
      const { application } = resolveDomainContext(makeRecord(), { protectionProfile: fullProfile });
      const docGate = application.currentGates.find((g) => g.id === 'gate-DOCUMENTATION_COMPLETE');
      expect(docGate?.status).toBe('PENDING');
    });

    it('builds default DOCUMENTATION gate as COMPLETED when situationPlanSVG present', () => {
      const record = makeRecord({
        domainSnapshot: {
          generatedDocuments: { situationPlanSVG: '<svg/>', crossSectionSVG: '<svg/>', generatedAt: '2026-05-01T10:00:00.000Z' },
        },
      });
      const { application } = resolveDomainContext(record, { protectionProfile: fullProfile });
      const docGate = application.currentGates.find((g) => g.id === 'gate-DOCUMENTATION_COMPLETE');
      expect(docGate?.status).toBe('COMPLETED');
    });
  });

  describe('application fields', () => {
    it('status is mapped through recordStatusToDomain', () => {
      const record = makeRecord({ status: 'SUBMITTED' });
      const { application } = resolveDomainContext(record, { protectionProfile: fullProfile });
      expect(application.status).toBe('SUBMITTED');
    });

    it('projectId from body takes precedence over record', () => {
      const { application } = resolveDomainContext(makeRecord(), {
        protectionProfile: fullProfile,
        projectId: 'proj-override',
      });
      expect(application.projectId).toBe('proj-override');
    });

    it('pe from body takes precedence over record', () => {
      const { application } = resolveDomainContext(makeRecord({ pe: 5 }), {
        protectionProfile: fullProfile,
        pe: 10,
      });
      expect(application.pe).toBe(10);
    });

    it('situationPlan present when generatedDocuments has SVG', () => {
      const record = makeRecord({
        domainSnapshot: {
          generatedDocuments: { situationPlanSVG: '<svg/>', generatedAt: '2026-05-01T10:00:00.000Z' },
        },
      });
      const { application } = resolveDomainContext(record, { protectionProfile: fullProfile });
      expect(application.situationPlan?.url).toBe('inline:situation');
    });

    it('crossSection present when generatedDocuments has crossSectionSVG', () => {
      const record = makeRecord({
        domainSnapshot: {
          generatedDocuments: { crossSectionSVG: '<svg/>', generatedAt: '2026-05-01T10:00:00.000Z' },
        },
      });
      const { application } = resolveDomainContext(record, { protectionProfile: fullProfile });
      expect(application.crossSection?.url).toBe('inline:cross');
    });
  });
});
