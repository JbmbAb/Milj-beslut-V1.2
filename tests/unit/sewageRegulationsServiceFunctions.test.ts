import { describe, expect, it } from 'vitest';
import {
  generateSewageRequirementChecklist,
  validateSewageApplicationRegulations,
  generateRegulatorySourceTracing,
  listSewageEvidenceSources,
} from '../../server/services/sewageRegulationsService';
import type { SewageApplication, SewageProtectionProfile } from '../../types';

const baseProfile: SewageProtectionProfile = {
  propertyId: 'GÄVLE BRYNÄS 1:1',
  protectionLevel: 'NORMAL',
  reason: 'Normal skyddsnivå',
  nearestWell: { distance: 60, owner: 'OWN', coordinates: { lat: 60.67, lng: 17.14 } },
  nearestWaterCourse: { distance: 200, type: 'Bäck', name: 'Källan' },
  distanceToPropertyLine: 6,
  soilProfile: {
    soilType: 'Isälvssand',
    depthToRock: 4.5,
    groundwaterLevel: 1.2,
    infiltrationCapacity: 'MEDIUM',
    permeability: 50,
  },
  floodRisk: 'LOW',
  protectedNatureNearby: false,
  recommendedSystem: 'MINI_PLANT_BDTA',
  timelineEstimateWeeks: 8,
  requiredGates: [],
};

const baseApplication: SewageApplication = {
  id: 'app-1',
  projectId: 'proj-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  pe: 5,
  selectedSystemType: 'MINI_PLANT_BDTA',
  protectionProfile: baseProfile,
  soilTestCompleted: false,
  neighborConsentObtained: false,
  neighborConsentRequired: false,
  status: 'DRAFT',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  currentGates: [],
};

describe('sewageRegulationsService', () => {
  describe('generateSewageRequirementChecklist', () => {
    it('returnerar kravlista för INFILTRATION system i NORMAL skyddsnivå', () => {
      const requirements = generateSewageRequirementChecklist('INFILTRATION', 'NORMAL', '2180');

      expect(Array.isArray(requirements)).toBe(true);
      expect(requirements.length).toBeGreaterThan(0);
    });

    it('returnerar kravlista för CLOSED_TANK system', () => {
      const requirements = generateSewageRequirementChecklist('CLOSED_TANK', 'NORMAL', '2180');

      expect(requirements.length).toBeGreaterThan(0);
      // CLOSED_TANK has a tank-emptying requirement
      expect(requirements.some((r) => r.id === 'court-tank-emptying')).toBe(true);
    });

    it('returnerar krav för HIGH skyddsnivå (PHOSPHORUS_TRAP)', () => {
      const requirements = generateSewageRequirementChecklist('PHOSPHORUS_TRAP', 'HIGH', '2180');

      expect(requirements.some((r) => r.id === 'phosphorus-sensitive-recipient')).toBe(true);
    });

    it('sätter status BLOCKED om avstånd understiger krav', () => {
      const requirements = generateSewageRequirementChecklist('INFILTRATION', 'NORMAL', '2180', {
        toWell: 30, // Less than 50m minimum
        toPropertyLine: 3, // Less than 4.5m minimum
      });

      const blockedReqs = requirements.filter((r) => r.status === 'BLOCKED');
      expect(blockedReqs.length).toBeGreaterThan(0);
    });

    it('sätter status COMPLETED om avstånd uppfyller krav', () => {
      const requirements = generateSewageRequirementChecklist('INFILTRATION', 'NORMAL', '2180', {
        toWell: 80, // More than 50m minimum
        toPropertyLine: 6, // More than 4.5m minimum
      });

      const completedReqs = requirements.filter((r) => r.status === 'COMPLETED');
      expect(completedReqs.length).toBeGreaterThan(0);
    });

    it('inkluderar blockingFactor när avstånd understiger krav', () => {
      const requirements = generateSewageRequirementChecklist('INFILTRATION', 'NORMAL', '2180', {
        toWell: 30,
      });

      const blocked = requirements.find((r) => r.status === 'BLOCKED');
      expect(blocked?.blockingFactor).toContain('30m');
    });

    it('sätter relatedMunicipalCode korrekt', () => {
      const requirements = generateSewageRequirementChecklist('SOIL_BED', 'NORMAL', '0180');

      requirements.forEach((r) => {
        expect(r.relatedMunicipalCode).toBe('0180');
      });
    });

    it('utan distanceData är status DRAFT', () => {
      const requirements = generateSewageRequirementChecklist(
        'INFILTRATION',
        'NORMAL',
        '2180',
        // No distanceData
      );

      const draftReqs = requirements.filter((r) => r.status === 'DRAFT');
      expect(draftReqs.length).toBeGreaterThan(0);
    });
  });

  describe('validateSewageApplicationRegulations', () => {
    it('returnerar compliant när alla krav uppfylls', () => {
      const app = {
        ...baseApplication,
        selectedSystemType: 'MINI_PLANT_BDTA' as const,
        soilTestCompleted: true,
      };
      const result = validateSewageApplicationRegulations(app, baseProfile);

      expect(result.isCompliant).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('violation när INFILTRATION för nära brunn', () => {
      const app = { ...baseApplication, selectedSystemType: 'INFILTRATION' as const };
      const profile = {
        ...baseProfile,
        nearestWell: { distance: 30, owner: 'OWN' as const, coordinates: { lat: 60.67, lng: 17.14 } },
      };

      const result = validateSewageApplicationRegulations(app, profile);

      expect(result.isCompliant).toBe(false);
      expect(result.violations.some((v) => v.includes('30m') && v.includes('brunn'))).toBe(true);
    });

    it('violation när för nära tomtgräns (< 4.5m)', () => {
      const profile = { ...baseProfile, distanceToPropertyLine: 3 };
      const result = validateSewageApplicationRegulations(baseApplication, profile);

      expect(result.isCompliant).toBe(false);
      expect(result.violations.some((v) => v.includes('tomtgräns'))).toBe(true);
    });

    it('violation när INFILTRATION saknar perkolationsprov', () => {
      const app = {
        ...baseApplication,
        selectedSystemType: 'INFILTRATION' as const,
        soilTestCompleted: false,
      };
      const result = validateSewageApplicationRegulations(app, baseProfile);

      expect(result.violations.some((v) => v.includes('perkolationsprov'))).toBe(true);
    });

    it('violation vid INFILTRATION i HIGH skyddat område', () => {
      const app = {
        ...baseApplication,
        selectedSystemType: 'INFILTRATION' as const,
        soilTestCompleted: true,
      };
      const profile = { ...baseProfile, protectionLevel: 'HIGH' as const };

      const result = validateSewageApplicationRegulations(app, profile);

      expect(result.violations.some((v) => v.includes('BDTA'))).toBe(true);
    });

    it('violation när grannbrunn < 50m utan medgivande', () => {
      const app = { ...baseApplication, neighborConsentObtained: false };
      const profile = {
        ...baseProfile,
        nearestWell: { distance: 40, owner: 'NEIGHBOR' as const, coordinates: { lat: 60.67, lng: 17.14 } },
      };

      const result = validateSewageApplicationRegulations(app, profile);

      expect(result.violations.some((v) => v.includes('Grannemedgivande'))).toBe(true);
    });

    it('ingen violation när grannbrunn < 50m men medgivande finns', () => {
      const app = { ...baseApplication, neighborConsentObtained: true };
      const profile = {
        ...baseProfile,
        nearestWell: { distance: 40, owner: 'NEIGHBOR' as const, coordinates: { lat: 60.67, lng: 17.14 } },
      };

      const result = validateSewageApplicationRegulations(app, profile);

      expect(result.violations.every((v) => !v.includes('Grannemedgivande'))).toBe(true);
    });

    it('warning vid låg infiltrationskapacitet', () => {
      const profile = {
        ...baseProfile,
        soilProfile: { ...baseProfile.soilProfile, infiltrationCapacity: 'LOW' as const },
      };

      const result = validateSewageApplicationRegulations(baseApplication, profile);

      expect(result.warnings.some((w) => w.includes('infiltrationskapacitet'))).toBe(true);
    });

    it('warning vid MEDIUM eller HIGH floodrisk', () => {
      const profile = { ...baseProfile, floodRisk: 'MEDIUM' as const };
      const result = validateSewageApplicationRegulations(baseApplication, profile);

      expect(result.warnings.some((w) => w.includes('översvämning'))).toBe(true);
    });

    it('rekommendation vid HIGH skyddsnivå', () => {
      const profile = { ...baseProfile, protectionLevel: 'HIGH' as const };
      const result = validateSewageApplicationRegulations(baseApplication, profile);

      expect(result.recommendations.some((r) => r.includes('länstyrelsen'))).toBe(true);
    });

    it('rekommendation vid naturvårdsområde nära + INFILTRATION', () => {
      const app = {
        ...baseApplication,
        selectedSystemType: 'INFILTRATION' as const,
        soilTestCompleted: true,
      };
      const profile = { ...baseProfile, protectedNatureNearby: true };

      const result = validateSewageApplicationRegulations(app, profile);

      expect(result.recommendations.some((r) => r.includes('Fosforfälla'))).toBe(true);
    });
  });

  describe('generateRegulatorySourceTracing', () => {
    it('returnerar minst 5 rättsliga källhänvisningar', () => {
      const sources = generateRegulatorySourceTracing();

      expect(sources.length).toBeGreaterThanOrEqual(5);
    });

    it('inkluderar Miljöbalken-referens', () => {
      const sources = generateRegulatorySourceTracing();

      expect(sources.some((s) => s.version?.includes('Miljöbalken'))).toBe(true);
    });

    it('alla sources har rätt format', () => {
      const sources = generateRegulatorySourceTracing();

      sources.forEach((s) => {
        expect(s.source).toBe('LOCAL_RULES');
        expect(typeof s.timestamp).toBe('string');
      });
    });
  });

  describe('listSewageEvidenceSources', () => {
    it('inkluderar HVMFS 2016:17 i avloppsunderlaget', () => {
      const sources = listSewageEvidenceSources();

      expect(sources.some((source) => source.title.includes('HVMFS 2016:17'))).toBe(true);
    });

    it('inkluderar Domstolsverket, Länsstyrelsen och Dataportalen i samma source pack', () => {
      const sources = listSewageEvidenceSources();

      expect(sources.some((source) => source.authorityName.includes('Domstolsverket'))).toBe(true);
      expect(sources.some((source) => source.authorityName.includes('Länsstyrelsen'))).toBe(true);
      expect(sources.some((source) => source.sourceSystem === 'DATAPORTAL')).toBe(true);
    });
  });
});
