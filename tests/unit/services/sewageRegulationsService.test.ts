import { describe, it, expect } from 'vitest';
import {
  validateSewageApplicationRegulations,
  generateSewageRequirementChecklist,
  getMunicipalRegulations,
  generateRegulatorySourceTracing,
} from '../../../server/services/sewageRegulationsService';
import type { SewageApplication, SewageProtectionProfile } from '../../../types';

// ── Byggstenar ─────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<SewageProtectionProfile> = {}): SewageProtectionProfile {
  return {
    propertyId: 'prop-1',
    protectionLevel: 'NORMAL',
    reason: 'Test',
    nearestWell: { distance: 80, owner: 'NEIGHBOR', coordinates: { lat: 60.0, lng: 17.0 } },
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
    ...overrides,
  };
}

function makeApp(overrides: Partial<SewageApplication> = {}): SewageApplication {
  return {
    id: 'app-1',
    projectId: 'proj-1',
    propertyDesignation: 'TEST 1:1',
    pe: 5,
    selectedSystemType: 'INFILTRATION',
    protectionProfile: makeProfile(),
    soilTestCompleted: true,
    neighborConsentRequired: false,
    neighborConsentObtained: false,
    status: 'DRAFT',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    currentGates: [],
    ...overrides,
  } as SewageApplication;
}

// ── validateSewageApplicationRegulations ───────────────────────────────────

describe('validateSewageApplicationRegulations', () => {
  it('godkänner ansökan utan violations för ett oklanderligt scenario', () => {
    const result = validateSewageApplicationRegulations(makeApp(), makeProfile());
    expect(result.isCompliant).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  describe('brunnsavstånd (50 m – Miljöbalken 32:4)', () => {
    it('kräver violation när brunn är 30 m bort och system är INFILTRATION', () => {
      const profile = makeProfile({ nearestWell: { distance: 30, owner: 'NEIGHBOR', coordinates: { lat: 60, lng: 17 } } });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.isCompliant).toBe(false);
      expect(result.violations.some((v) => v.includes('30m') && v.includes('50m'))).toBe(true);
    });

    it('kräver violation vid exakt 49 m (under tröskeln)', () => {
      const profile = makeProfile({ nearestWell: { distance: 49, owner: 'NEIGHBOR', coordinates: { lat: 60, lng: 17 } } });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.violations.some((v) => v.includes('49m'))).toBe(true);
    });

    it('ingen violation vid exakt 50 m (på tröskeln)', () => {
      const profile = makeProfile({ nearestWell: { distance: 50, owner: 'NEIGHBOR', coordinates: { lat: 60, lng: 17 } } });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.violations.some((v) => v.includes('50m') && v.includes('brunn'))).toBe(false);
    });

    it('ingen brunnsavståndsviolation för CLOSED_TANK (ej i applicableTo)', () => {
      const profile = makeProfile({ nearestWell: { distance: 10, owner: 'NEIGHBOR', coordinates: { lat: 60, lng: 17 } } });
      const app = makeApp({ selectedSystemType: 'CLOSED_TANK' });
      const result = validateSewageApplicationRegulations(app, profile);
      // CLOSED_TANK triggrar INTE brunnsavståndsregeln i INFILTRATION/SOIL_BED-grenen
      expect(result.violations.some((v) => v.includes('brunn') && v.includes('50m'))).toBe(false);
    });
  });

  describe('tomtgränssavstånd (4,5 m – Miljöbalken 32:4)', () => {
    it('violation när distanceToPropertyLine är 3 m', () => {
      const profile = makeProfile({ distanceToPropertyLine: 3 });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.violations.some((v) => v.includes('3m') && v.includes('4,5m'))).toBe(true);
    });

    it('ingen violation vid exakt 4,5 m', () => {
      const profile = makeProfile({ distanceToPropertyLine: 4.5 });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.violations.some((v) => v.includes('4,5m') && v.includes('tomtgräns'))).toBe(false);
    });
  });

  describe('markundersökning (HVMFS 2016:17)', () => {
    it('violation för INFILTRATION utan soilTest', () => {
      const result = validateSewageApplicationRegulations(makeApp({ soilTestCompleted: false }), makeProfile());
      expect(result.violations.some((v) => v.includes('perkolationsprov'))).toBe(true);
    });

    it('violation för SOIL_BED utan soilTest', () => {
      const result = validateSewageApplicationRegulations(
        makeApp({ selectedSystemType: 'SOIL_BED', soilTestCompleted: false }),
        makeProfile(),
      );
      expect(result.violations.some((v) => v.includes('perkolationsprov'))).toBe(true);
    });

    it('ingen violation för CLOSED_TANK utan soilTest', () => {
      const result = validateSewageApplicationRegulations(
        makeApp({ selectedSystemType: 'CLOSED_TANK', soilTestCompleted: false }),
        makeProfile(),
      );
      expect(result.violations.some((v) => v.includes('perkolationsprov'))).toBe(false);
    });
  });

  describe('högt skyddad område', () => {
    it('violation för INFILTRATION i HIGH-område', () => {
      const profile = makeProfile({ protectionLevel: 'HIGH' });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.violations.some((v) => v.includes('BDTA'))).toBe(true);
      expect(result.isCompliant).toBe(false);
    });

    it('ingen BDTA-violation för MINI_PLANT_BDTA i HIGH-område', () => {
      const profile = makeProfile({ protectionLevel: 'HIGH' });
      const result = validateSewageApplicationRegulations(
        makeApp({ selectedSystemType: 'MINI_PLANT_BDTA' }),
        profile,
      );
      expect(result.violations.some((v) => v.includes('BDTA'))).toBe(false);
    });

    it('rekommendation om länsstyrelsen läggs till för HIGH-område', () => {
      const profile = makeProfile({ protectionLevel: 'HIGH' });
      // MINI_PLANT_BDTA är tillåtet i HIGH-område — ingen BDTA-violation, men rekommendation ska finnas
      const result = validateSewageApplicationRegulations(
        makeApp({ selectedSystemType: 'MINI_PLANT_BDTA', soilTestCompleted: true }),
        profile,
      );
      expect(result.recommendations.some((r) => r.includes('länstyrelsen'))).toBe(true);
    });
  });

  describe('grannemedgivande', () => {
    it('violation om grannens brunn < 50 m och medgivande saknas', () => {
      const profile = makeProfile({
        nearestWell: { distance: 35, owner: 'NEIGHBOR', coordinates: { lat: 60, lng: 17 } },
      });
      const result = validateSewageApplicationRegulations(
        makeApp({ neighborConsentObtained: false }),
        profile,
      );
      expect(result.violations.some((v) => v.includes('Grannemedgivande'))).toBe(true);
    });

    it('ingen consent-violation om medgivande är inhämtat', () => {
      const profile = makeProfile({
        nearestWell: { distance: 35, owner: 'NEIGHBOR', coordinates: { lat: 60, lng: 17 } },
      });
      const result = validateSewageApplicationRegulations(
        makeApp({ neighborConsentObtained: true }),
        profile,
      );
      expect(result.violations.some((v) => v.includes('Grannemedgivande') && v.includes('OBLIGATORISKT'))).toBe(false);
    });

    it('ingen consent-violation när brunn är 80 m bort', () => {
      const result = validateSewageApplicationRegulations(
        makeApp({ neighborConsentObtained: false }),
        makeProfile(),
      );
      expect(result.violations.some((v) => v.includes('Grannemedgivande'))).toBe(false);
    });
  });

  describe('varningar', () => {
    it('varning för låg infiltrationskapacitet', () => {
      const profile = makeProfile({
        soilProfile: { soilType: 'Lera', depthToRock: 1, groundwaterLevel: 0.5, infiltrationCapacity: 'LOW', permeability: 5 },
      });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.warnings.some((w) => w.includes('infiltrationskapacitet'))).toBe(true);
    });

    it('varning för MEDIUM-översvämningsrisk', () => {
      const profile = makeProfile({ floodRisk: 'MEDIUM' });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.warnings.some((w) => w.includes('medium'))).toBe(true);
    });

    it('varning för HIGH-översvämningsrisk', () => {
      const profile = makeProfile({ floodRisk: 'HIGH' });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.warnings.some((w) => w.includes('high'))).toBe(true);
    });

    it('ingen varning vid LOW-översvämningsrisk', () => {
      const result = validateSewageApplicationRegulations(makeApp(), makeProfile({ floodRisk: 'LOW' }));
      expect(result.warnings.some((w) => w.includes('översvämning'))).toBe(false);
    });
  });

  describe('rekommendationer', () => {
    it('fosforfällerekommendation om naturvårdsområde nära INFILTRATION', () => {
      const profile = makeProfile({ protectedNatureNearby: true });
      const result = validateSewageApplicationRegulations(makeApp(), profile);
      expect(result.recommendations.some((r) => r.includes('Fosforfälla'))).toBe(true);
    });

    it('ingen fosfelfällerekommendation för CLOSED_TANK med naturvård', () => {
      const profile = makeProfile({ protectedNatureNearby: true });
      const result = validateSewageApplicationRegulations(
        makeApp({ selectedSystemType: 'CLOSED_TANK' }),
        profile,
      );
      expect(result.recommendations.some((r) => r.includes('Fosforfälla'))).toBe(false);
    });
  });
});

// ── generateSewageRequirementChecklist ─────────────────────────────────────

describe('generateSewageRequirementChecklist', () => {
  it('returnerar krav för INFILTRATION-system', () => {
    const reqs = generateSewageRequirementChecklist('INFILTRATION', 'NORMAL', '0180');
    expect(reqs.length).toBeGreaterThan(0);
    const ids = reqs.map((r) => r.id);
    expect(ids).toContain('MB-32-4-well-distance');
    expect(ids).toContain('NFS-2016-soil-test');
  });

  it('markerar BLOCKED när faktiskt avstånd underskrider minimum', () => {
    const reqs = generateSewageRequirementChecklist('INFILTRATION', 'NORMAL', '0180', {
      toWell: 30,
    });
    const wellReq = reqs.find((r) => r.id === 'MB-32-4-well-distance');
    expect(wellReq?.status).toBe('BLOCKED');
    expect(wellReq?.blockingFactor).toContain('30m');
  });

  it('markerar COMPLETED när avstånd möter minimum', () => {
    const reqs = generateSewageRequirementChecklist('INFILTRATION', 'NORMAL', '0180', {
      toWell: 55,
    });
    const wellReq = reqs.find((r) => r.id === 'MB-32-4-well-distance');
    expect(wellReq?.status).toBe('COMPLETED');
  });

  it('inkluderar HIGH-krav i HIGH-skyddsområde', () => {
    const reqs = generateSewageRequirementChecklist('MINI_PLANT_BDTA', 'HIGH', '0180');
    const ids = reqs.map((r) => r.id);
    expect(ids).toContain('NFS-2016-high-protection-area');
  });

  it('inkluderar inte HIGH-krav för NORMAL-skyddsområde', () => {
    const reqs = generateSewageRequirementChecklist('INFILTRATION', 'NORMAL', '0180');
    const ids = reqs.map((r) => r.id);
    expect(ids).not.toContain('NFS-2016-high-protection-area');
  });
});

// ── getMunicipalRegulations ────────────────────────────────────────────────

describe('getMunicipalRegulations', () => {
  it('returnerar nationella standarder för vilken kommunkod som helst', async () => {
    const regs = await getMunicipalRegulations('0180');
    expect(Array.isArray(regs)).toBe(true);
    expect(regs.length).toBeGreaterThan(0);
  });

  it('returnerar samma lista oavsett kommunkod', async () => {
    const r1 = await getMunicipalRegulations('0180');
    const r2 = await getMunicipalRegulations('2180');
    expect(r1).toEqual(r2);
  });
});

// ── generateRegulatorySourceTracing ───────────────────────────────────────

describe('generateRegulatorySourceTracing', () => {
  it('returnerar array med källspårning', () => {
    const tracing = generateRegulatorySourceTracing();
    expect(Array.isArray(tracing)).toBe(true);
    expect(tracing.length).toBeGreaterThan(0);
  });

  it('varje post har source LOCAL_RULES och timestamp', () => {
    const tracing = generateRegulatorySourceTracing();
    for (const t of tracing) {
      expect(t.source).toBe('LOCAL_RULES');
      expect(typeof t.timestamp).toBe('string');
      expect(typeof t.version).toBe('string');
    }
  });
});
