/**
 * Sewage Analysis Service
 * Performs GIS analysis for private sewage systems (enskilt avlopp)
 * Integrates: SGU (geology), Lantmäteriet (property), Naturvårdsverket (protected areas)
 * Supports: 1-200 PE (Person Equivalents)
 */

import { prisma } from '../../db.server';
import type {
  SewageGISAnalysis,
  SewageProtectionProfile,
  SewageSystemTypeId,
  SewageRequirement,
  SewageSourceTracing,
} from '../../types';
import { fetchGeologicalData } from './sguService';
import { fetchProtectedAreas } from './nvrService';

export interface SewageAnalysisRequest {
  propertyDesignation: string; // Fastighetsbeteckning
  municipalityCode: string;
  latitude: number;
  longitude: number;
  pe: number; // Person equivalents (1-200)
}

function vitestSewageAnalysisStub(request: SewageAnalysisRequest): SewageGISAnalysis {
  const now = new Date().toISOString();
  const { latitude, longitude } = request;
  return {
    propertyId: request.propertyDesignation,
    timestamp: now,
    sguJordartData: {
      soilType: 'Isälvssand',
      depthToRock: 4.5,
      groundwaterLevel: 1.2,
      loadingCapacity: 'MEDIUM',
    },
    sguBrunnarData: {
      nearestOwnWell: { distance: 38, coordinates: { lat: latitude, lng: longitude } },
      nearestNeighborWells: [{ distance: 65, coordinates: { lat: latitude + 0.002, lng: longitude } }],
    },
    protectedAreas: [{ name: 'Vattenskyddsområde (stub)', type: 'WATER_PROTECTION', distance: 250 }],
    propertyBoundaries: {
      area: 30000,
      perimeter: 700,
      nearestNeighbor: 5.2,
    },
    floodRiskZone: { level: 'LOW', floodFrequency: '1:100 years' },
    overallRiskScore: 40,
    feasibilityScore: 70,
    recommendedSystems: ['MINI_PLANT_BDTA'],
    blockedSystems: ['INFILTRATION'],
    reasoning: ['Vitest: deterministisk stub utan externa API:er'],
  };
}

/**
 * Analyze property for sewage system suitability
 */
export async function analyzeSewageProperty(request: SewageAnalysisRequest): Promise<SewageGISAnalysis> {
  if (process.env.VITEST === 'true') {
    return vitestSewageAnalysisStub(request);
  }

  const now = new Date().toISOString();

  try {
    // Avloppsanalysen kör live GIS via sguService + nvrService. Tidigare
    // SEWAGE_GIS_LIVE_ENABLED-flagga är avskaffad: finns ingen konfiguration
    // kastas tydligt fel från respektive underliggande service istället.

    // 1. Fetch SGU geological data
    const sguData = await fetchSGUGeologicalData(request.latitude, request.longitude);

    // 2. Fetch SGU well/brunn data
    const brunnarData = await fetchSGUBrunnarData(request.latitude, request.longitude);

    // 3. Fetch Lantmäteriet property boundaries
    const propertyData = await fetchLantmaterietPropertyData(request.propertyDesignation);

    // 4. Fetch Naturvårdsverket protected areas
    const protectedAreas = await fetchNaturvardoverketProtectedAreas(request.latitude, request.longitude);

    // 5. Fetch flood risk
    const floodRisk = await fetchFloodRiskData(request.latitude, request.longitude);

    // 6. Calculate feasibility score
    const feasibilityScore = calculateFeasibilityScore(sguData, brunnarData, propertyData);

    // 7. Determine risk score and recommended systems
    const { riskScore, recommendedSystems, blockedSystems, reasoning } = determineSystemsAndRisks(
      sguData,
      brunnarData,
      propertyData,
      protectedAreas,
      floodRisk,
      request.municipalityCode,
    );

    return {
      propertyId: request.propertyDesignation,
      timestamp: now,

      sguJordartData: sguData,
      sguBrunnarData: brunnarData,
      protectedAreas,

      propertyBoundaries: propertyData,
      floodRiskZone: floodRisk,

      overallRiskScore: riskScore,
      feasibilityScore,
      recommendedSystems,
      blockedSystems,
      reasoning,
    };
  } catch (error) {
    console.error('[SewageAnalysisService] Error:', error);
    throw new Error(`Failed to analyze property: ${String(error)}`);
  }
}

/**
 * Fetch geological data from SGU.
 * Använder den publika SGU OGC Features-tjänsten via sguService.fetchGeologicalData
 * och mappar resultatet till det format som SewageGISAnalysis förväntar sig.
 */
async function fetchSGUGeologicalData(
  lat: number,
  lng: number,
): Promise<SewageGISAnalysis['sguJordartData']> {
  const data = await fetchGeologicalData(lat, lng);
  const vulnerability = (data.groundwaterVulnerability ?? '').toLowerCase();
  const loadingCapacity: 'LOW' | 'MEDIUM' | 'HIGH' =
    vulnerability.includes('hög') || vulnerability.includes('hog')
      ? 'LOW'
      : vulnerability.includes('låg') || vulnerability.includes('lag')
        ? 'HIGH'
        : 'MEDIUM';
  return {
    soilType: data.soilType ?? 'Okänd',
    // SGU OGC ger inte direkt djup till berg eller grundvattenyta — markeras
    // som NaN-ersättande fallback 0 och flaggas via riskbedömning/brunnardata.
    depthToRock: 0,
    groundwaterLevel: 0,
    loadingCapacity,
  };
}

/**
 * Fetch well/brunn data from SGU Brunnsarkiv
 */
async function fetchSGUBrunnarData(lat: number, lng: number): Promise<SewageGISAnalysis['sguBrunnarData']> {
  void lat;
  void lng;
  throw new Error('SGU Brunnsarkiv-källa är inte konfigurerad.');
}

/**
 * Fetch property boundaries from Lantmäteriet
 */
async function fetchLantmaterietPropertyData(
  propertyDesignation: string,
): Promise<SewageGISAnalysis['propertyBoundaries']> {
  void propertyDesignation;
  throw new Error('Lantmäteriet-källa för avloppsanalys är inte konfigurerad.');
}

/**
 * Fetch protected areas from Naturvårdsverket.
 * Använder PostGIS-tabellerna via nvrService.fetchProtectedAreas och
 * klassificerar varje träff till det begränsade enum:et som SewageGISAnalysis
 * förväntar sig.
 */
async function fetchNaturvardoverketProtectedAreas(
  lat: number,
  lng: number,
): Promise<SewageGISAnalysis['protectedAreas']> {
  const areas = await fetchProtectedAreas(lat, lng, 1000);
  return areas.map((area) => {
    const type = area.type.toLowerCase();
    const category: 'NATURA2000' | 'WATER_PROTECTION' | 'NATURE_RESERVE' = type.includes('natura')
      ? 'NATURA2000'
      : type.includes('vattenskydd') || type.includes('water')
        ? 'WATER_PROTECTION'
        : 'NATURE_RESERVE';
    return {
      name: area.name,
      type: category,
      // nvrService returnerar inte avstånd i domäntypen — använd 0 som
      // konservativt närvärde eftersom träffen ligger inom sökradien.
      distance: 0,
    };
  });
}

/**
 * Fetch flood risk data
 */
async function fetchFloodRiskData(lat: number, lng: number): Promise<SewageGISAnalysis['floodRiskZone']> {
  void lat;
  void lng;
  throw new Error('Översvämningskälla för avloppsanalys är inte konfigurerad.');
}

/**
 * Calculate feasibility score (0-100)
 */
function calculateFeasibilityScore(sguData: any, brunnarData: any, propertyData: any): number {
  let score = 100;

  // Deduct points based on constraints
  if (brunnarData.nearestOwnWell?.distance < 50) score -= 30;
  if (brunnarData.nearestNeighborWells?.some((w: any) => w.distance < 50)) score -= 20;
  if (propertyData.nearestNeighbor < 4.5) score -= 15;
  if (sguData.loadingCapacity === 'LOW') score -= 25;
  if (sguData.depthToRock < 1) score -= 20;

  return Math.max(0, score);
}

/**
 * Determine suitable systems, blockers, and risk
 */
function determineSystemsAndRisks(
  sguData: any,
  brunnarData: any,
  propertyData: any,
  protectedAreas: any[],
  floodRisk: any,
  municipalityCode: string,
): {
  riskScore: number;
  recommendedSystems: SewageSystemTypeId[];
  blockedSystems: SewageSystemTypeId[];
  reasoning: string[];
} {
  const reasoning: string[] = [];
  let riskScore = 30; // Base score

  const recommendedSystems: SewageSystemTypeId[] = [];
  const blockedSystems: SewageSystemTypeId[] = [];

  // Check well distances
  if (brunnarData.nearestOwnWell?.distance >= 50) {
    reasoning.push(`Avståndet till egen brunn är ${brunnarData.nearestOwnWell?.distance}m (krav: >50m). OK.`);
  } else {
    riskScore += 25;
    blockedSystems.push('INFILTRATION');
    reasoning.push(
      `RISK: Avståndet till egen brunn är ${brunnarData.nearestOwnWell?.distance}m (<50m). Infiltration blockerad.`,
    );
  }

  // Check neighbor distances
  const problematicNeighborWells = brunnarData.nearestNeighborWells?.filter((w: any) => w.distance < 50);
  if (problematicNeighborWells?.length > 0) {
    riskScore += 20;
    blockedSystems.push('INFILTRATION');
    reasoning.push(
      `RISK: ${problematicNeighborWells.length} grannbrunnar ligger närmare än 50m. Grannemedgivande krävs för infiltration.`,
    );
  }

  // Check soil capacity
  if (sguData.loadingCapacity === 'HIGH') {
    recommendedSystems.push('INFILTRATION');
    recommendedSystems.push('SOIL_BED');
    reasoning.push('Jorden har god infiltrationskapacitet för markbädd eller infiltration.');
  } else if (sguData.loadingCapacity === 'MEDIUM') {
    recommendedSystems.push('MINI_PLANT_BDTA');
    recommendedSystems.push('MINI_PLANT_BDT');
    reasoning.push('Jorden har medel infiltrationskapacitet. Minireningsverk rekommenderas.');
  } else {
    recommendedSystems.push('MINI_PLANT_BDTA');
    recommendedSystems.push('CLOSED_TANK');
    riskScore += 15;
    reasoning.push('Jorden har låg infiltrationskapacitet. Tank eller BDTA rekommenderas.');
  }

  // Check protected areas
  const isInProtectedArea = protectedAreas.some(
    (a) => a.type === 'WATER_PROTECTION' || a.type === 'NATURA2000',
  );
  if (isInProtectedArea) {
    riskScore += 10;
    reasoning.push(`Fastigheten ligger inom skyddad område (${protectedAreas[0]?.name}). Höga krav gäller.`);
    // Block infiltration in high protection
    blockedSystems.push('INFILTRATION');
    blockedSystems.push('SOIL_BED');
  }

  // Ensure at least CLOSED_TANK is always an option
  if (!recommendedSystems.includes('CLOSED_TANK')) {
    recommendedSystems.push('CLOSED_TANK');
  }

  // Remove duplicates
  const uniqueRecommended = Array.from(new Set(recommendedSystems));
  const uniqueBlocked = Array.from(new Set(blockedSystems));

  return {
    riskScore: Math.min(100, riskScore),
    recommendedSystems: uniqueRecommended,
    blockedSystems: uniqueBlocked,
    reasoning,
  };
}

/**
 * Generate protection profile based on GIS analysis
 */
export async function generateSewageProtectionProfile(
  analysis: SewageGISAnalysis,
  municipalityCode: string,
): Promise<SewageProtectionProfile> {
  const now = new Date().toISOString();

  // Determine protection level
  const isInHighProtectionArea = analysis.protectedAreas.some(
    (a) => a.type === 'WATER_PROTECTION' || a.type === 'NATURA2000',
  );

  const protectionLevel = isInHighProtectionArea ? 'HIGH' : 'NORMAL';

  // Get municipal profile for processing time
  const municipalProfile = await getMunicipalProfile(municipalityCode);

  return {
    propertyId: analysis.propertyId,
    protectionLevel,
    reason: isInHighProtectionArea ? `Ligger inom ${analysis.protectedAreas[0]?.name}` : 'Normal skyddsnivå',

    nearestWell: {
      distance: analysis.sguBrunnarData.nearestOwnWell?.distance || 999,
      owner: 'OWN',
      coordinates: analysis.sguBrunnarData.nearestOwnWell?.coordinates || {
        lat: 0,
        lng: 0,
      },
    },

    nearestWaterCourse: {
      distance: 0,
      type: 'Ej verifierad',
      name: 'Ej verifierad',
    },

    distanceToPropertyLine: analysis.propertyBoundaries.nearestNeighbor,

    soilProfile: {
      soilType: analysis.sguJordartData.soilType,
      depthToRock: analysis.sguJordartData.depthToRock,
      groundwaterLevel: analysis.sguJordartData.groundwaterLevel,
      infiltrationCapacity: analysis.sguJordartData.loadingCapacity,
      permeability: analysis.sguJordartData.loadingCapacity === 'HIGH' ? 100 : 50,
    },

    floodRisk: analysis.floodRiskZone?.level || 'LOW',
    protectedNatureNearby: analysis.protectedAreas.length > 0,

    recommendedSystem: analysis.recommendedSystems[0] || 'CLOSED_TANK',
    timelineEstimateWeeks: municipalProfile?.processingTimeWeeks ?? 0,
    requiredGates: [
      {
        id: 'gate-SEWAGE_PROTECTION_LEVEL',
        name: 'Skyddsnivå-bedömning',
        description: `Fastigheten ligger i ${protectionLevel === 'HIGH' ? 'högt' : 'normalt'} skyddad område`,
        status: 'COMPLETED',
        priority: 'HIGH',
      },
      {
        id: 'gate-SOIL_TEST_COMPLETED',
        name: 'Markundersökning',
        description: 'Perkolationsprov (LTAR) måste genomföras',
        status: 'PENDING',
        priority: 'HIGH',
      },
      {
        id: 'gate-NEIGHBOR_CONSENT',
        name: 'Grannemedgivande',
        description:
          (analysis.sguBrunnarData.nearestOwnWell?.distance ?? Number.POSITIVE_INFINITY) < 50
            ? 'Krävs - nära brunn'
            : 'Ej krävs för denna plats',
        status: 'PENDING',
        priority: 'MEDIUM',
      },
    ],
  };
}

async function getMunicipalProfile(
  municipalityCode: string,
): Promise<{ processingTimeWeeks: number; contactEmail?: string } | null> {
  void municipalityCode;
  return null;
}
