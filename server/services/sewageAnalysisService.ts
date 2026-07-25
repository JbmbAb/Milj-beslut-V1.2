/**
 * Sewage Analysis Service
 * Performs GIS analysis for private sewage systems (enskilt avlopp)
 * INTEGRATION STRATEGY: 100% PostGIS-driven. External APIs are avoided for property data.
 * Tables used: env.registerenhetsomradesytor, env.sgu_soil_type_25k_100k, env.protected_area, env.natura2000_area
 */

import type { SewageGISAnalysis, SewageProtectionProfile, SewageSystemTypeId } from '../../types';
import { 
  tryFetchLocalPropertyGeometry, 
  tryFetchLocalSguData, 
  tryFetchLocalProtectionData,
  tryFetchLocalSguWellData,
  tryFetchLocalSguPermeabilityData
} from './hybridGeoService';
import { logger } from '../logger';

export interface SewageAnalysisRequest {
  propertyDesignation: string; // Fastighetsbeteckning
  municipalityCode: string;
  latitude: number;
  longitude: number;
  pe: number; // Person equivalents (1-200)
}

/**
 * Analyze property for sewage system suitability using local PostGIS data.
 */
export async function analyzeSewageProperty(request: SewageAnalysisRequest): Promise<SewageGISAnalysis> {
  const now = new Date().toISOString();

  try {
    logger.info(`Starting PostGIS-driven sewage analysis for ${request.propertyDesignation}`);

    // 1. Fetch Property Boundaries from local PostGIS
    const propertyRecord = await tryFetchLocalPropertyGeometry(request.propertyDesignation);
    const propertyData = {
      area: 0, // Placeholder if not in DB
      perimeter: 0,
      nearestNeighbor: propertyRecord ? 10.0 : 5.0, // Default safety distance if no record
    };

    // Use coordinates from request if available, otherwise from property record
    const lat = request.latitude;
    const lng = request.longitude;

    // 2. Fetch SGU geological & permeability data from local PostGIS
    const localSgu = await tryFetchLocalSguData(lat, lng);
    const localPermeability = await tryFetchLocalSguPermeabilityData(lat, lng);
    const permeabilityLabel = localPermeability?.genomslapp_tx || 'Okänd genomsläpplighet';
    
    let loadingCapacity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
    if (localPermeability) {
      const tx = (localPermeability.genomslapp_tx || '').toLowerCase();
      if (tx.includes('mycket hög') || tx.includes('hög') || tx.includes('god')) {
        loadingCapacity = 'HIGH';
      } else if (tx.includes('medel') || tx.includes('måttlig')) {
        loadingCapacity = 'MEDIUM';
      } else if (tx.includes('låg') || tx.includes('mycket låg') || tx.includes('svag') || tx.includes('tät')) {
        loadingCapacity = 'LOW';
      }
    } else if (localSgu) {
      const tx = (localSgu.jg2_tx || '').toLowerCase();
      if (tx.includes('grus') || tx.includes('sand')) {
        loadingCapacity = 'HIGH';
      } else if (tx.includes('lera') || tx.includes('silt')) {
        loadingCapacity = 'LOW';
      }
    }

    const sguData = {
      soilType: localPermeability?.jg2_tx || localSgu?.jordart || 'Okänd',
      depthToRock: 0, 
      groundwaterLevel: 0,
      loadingCapacity,
      permeabilityLabel,
    };

    // 3. Fetch SGU well/brunn data from local PostGIS
    const localWells = await tryFetchLocalSguWellData(lat, lng);
    let nearestOwnWell = { distance: 500, coordinates: { lat, lng }, usage: 'Okänd', totaldjup: 0 };
    let nearestNeighborWells: any[] = [];
    
    if (localWells && localWells.length > 0) {
      const nearest = localWells[0];
      nearestOwnWell = {
        distance: Math.round(Number(nearest.distance_meters)),
        coordinates: { lat, lng },
        usage: nearest.anvandning || 'Okänd',
        totaldjup: Number(nearest.totaldjup) || 0,
      };
      
      nearestNeighborWells = localWells.slice(1).map(w => ({
        distance: Math.round(Number(w.distance_meters)),
        fastighet: w.fastighet || 'Okänd fastighet',
        usage: w.anvandning || 'Okänd',
        totaldjup: Number(w.totaldjup) || 0,
      }));
    }

    const brunnarData = {
      nearestOwnWell,
      nearestNeighborWells,
    };

    // 4. Fetch Protected Areas from local PostGIS (NVR + Natura 2000)
    const localProtection = await tryFetchLocalProtectionData(lat, lng);
    const protectedAreas = (localProtection || []).map(p => ({
      name: p.name,
      type: (p.type || '').toLowerCase().includes('vatten') ? 'WATER_PROTECTION' : 'NATURE_RESERVE' as any,
      distance: 0
    }));

    // 5. Fetch flood risk (Local placeholder)
    const floodRisk = { level: 'LOW' as const, floodFrequency: '1:100 years' };

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
    logger.error('[SewageAnalysisService] PostGIS analysis failed:', error);
    throw new Error(`Kunde inte genomföra fastighetsanalys via PostGIS: ${String(error)}`);
  }
}

/**
 * Calculate feasibility score (0-100)
 */
function calculateFeasibilityScore(sguData: any, brunnarData: any, propertyData: any): number {
  let score = 100;
  if (brunnarData.nearestOwnWell?.distance < 50) score -= 30;
  if (propertyData.nearestNeighbor < 4.5) score -= 15;
  if (sguData.loadingCapacity === 'LOW') score -= 25;
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
  _floodRisk: any,
  _municipalityCode: string,
): {
  riskScore: number;
  recommendedSystems: SewageSystemTypeId[];
  blockedSystems: SewageSystemTypeId[];
  reasoning: string[];
} {
  const reasoning: string[] = [];
  let riskScore = 30;

  const recommendedSystems: SewageSystemTypeId[] = [];
  const blockedSystems: SewageSystemTypeId[] = [];

  // Check well distances
  if (brunnarData.nearestOwnWell?.distance >= 50) {
    reasoning.push(`Avstånd till egen brunn är ${brunnarData.nearestOwnWell?.distance}m (OK).`);
  } else {
    riskScore += 25;
    blockedSystems.push('INFILTRATION');
    reasoning.push(`RISK: Nära egen brunn (${brunnarData.nearestOwnWell?.distance}m).`);
  }

  // Check soil capacity
  if (sguData.loadingCapacity === 'HIGH') {
    recommendedSystems.push('INFILTRATION', 'SOIL_BED');
    reasoning.push(`Jorden (${sguData.soilType}) har hög infiltrationskapacitet (${sguData.permeabilityLabel}). Infiltration eller markbädd rekommenderas.`);
  } else if (sguData.loadingCapacity === 'MEDIUM') {
    recommendedSystems.push('SOIL_BED', 'MINI_PLANT_BDTA');
    reasoning.push(`Jorden (${sguData.soilType}) har måttlig infiltrationskapacitet (${sguData.permeabilityLabel}). Markbädd eller minireningsverk rekommenderas.`);
  } else {
    recommendedSystems.push('MINI_PLANT_BDTA', 'CLOSED_TANK');
    reasoning.push(`RISK: Tät jordart identifierad (${sguData.soilType}, ${sguData.permeabilityLabel}). Traditionell infiltration är olämplig.`);
  }

  // Check protected areas
  if (protectedAreas.length > 0) {
    riskScore += 15;
    reasoning.push(`Ligger inom skyddad natur: ${protectedAreas[0].name}.`);
    blockedSystems.push('INFILTRATION');
  }

  if (!recommendedSystems.includes('CLOSED_TANK')) recommendedSystems.push('CLOSED_TANK');

  return {
    riskScore: Math.min(100, riskScore),
    recommendedSystems: Array.from(new Set(recommendedSystems)),
    blockedSystems: Array.from(new Set(blockedSystems)),
    reasoning,
  };
}

export async function generateSewageProtectionProfile(
  analysis: SewageGISAnalysis,
  municipalityCode: string,
): Promise<SewageProtectionProfile> {
  const isInHighProtectionArea = analysis.protectedAreas.some(
    (a) => a.type === 'WATER_PROTECTION' || a.type === 'NATURA2000',
  );

  const protectionLevel = isInHighProtectionArea ? 'HIGH' : 'NORMAL';

  return {
    propertyId: analysis.propertyId,
    protectionLevel,
    reason: isInHighProtectionArea ? `Ligger inom ${analysis.protectedAreas[0]?.name}` : 'Normal skyddsnivå',
    nearestWell: {
      distance: analysis.sguBrunnarData.nearestOwnWell?.distance || 999,
      owner: 'OWN',
      coordinates: analysis.sguBrunnarData.nearestOwnWell?.coordinates || { lat: 0, lng: 0 },
    },
    nearestWaterCourse: { distance: 0, type: 'Ej verifierad', name: 'Ej verifierad' },
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
    timelineEstimateWeeks: 8,
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
    ],
  };
}
