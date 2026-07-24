import { prisma } from '../db/prisma';
import { logger } from '../logger';

export interface GeoKalkylSegment {
  lengthMeters: number;
  soilType: string;
  groundType: 'fast' | 'mellanfast' | 'svag';
  complexityFactors: {
    areaType: number;
    depth: number;
    groundType: number;
    landslide: number;
    contaminated: number;
  };
  totalComplexity: number;
  segmentCost: number;
  isPublicRoad: boolean;
  isPrivateProperty: boolean;
  isNearLandslide: boolean;
  isNearContaminated: boolean;
  clayDepth: number | null;
}

export interface GeoKalkylResult {
  totalCost: number;
  lengthMeters: number;
  baselineCost: number;
  averageClayDepth: number;
  landslideOverlap: boolean;
  contaminatedSiteOverlap: boolean;
  publicRoadOverlap: boolean;
  privatePropertyOverlap: boolean;
  segments: GeoKalkylSegment[];
}

export interface GeoKalkylInput {
  geometry: string | Record<string, any>; // GeoJSON LineString or geometry object
  pipeDepth?: number;                     // Depth in meters (default 1.8)
  baseCost?: number;                      // Cost per meter in SEK (default 1250)
}

/**
 * Classifies the jg2_tx soil description into one of three geotechnical classes:
 * - Solid Ground ('fast'): Bedrock, till, gravel, blockmark, etc.
 * - Moderate Ground ('mellanfast'): Silt, sand, postglacial sandy sediment, fyllning, etc.
 * - Soft Ground ('svag'): Clay, gyttja, peat, etc.
 */
export function classifyGroundType(jg2Tx: string | null): 'fast' | 'mellanfast' | 'svag' {
  if (!jg2Tx) return 'mellanfast';
  const normalized = jg2Tx.toLowerCase();
  
  // Soft Ground (svag mark) - priority check because some names have "morän" but are "lerig" or "ler"
  if (
    normalized.includes('lera') ||
    normalized.includes('ler') || // matches lerig, finlera, grovlera, ler--silt, etc.
    normalized.includes('torv') ||
    normalized.includes('gyttja') ||
    normalized.includes('skredjord') ||
    normalized.includes('flytjord')
  ) {
    return 'svag';
  }

  // Solid Ground (fast mark)
  if (
    normalized.includes('berg') ||
    normalized.includes('morän') ||
    normalized.includes('moran') ||
    normalized.includes('block') ||
    normalized.includes('grus') ||
    normalized.includes('klapper') ||
    normalized.includes('sten') ||
    normalized.includes('rasmassor') ||
    normalized.includes('talus')
  ) {
    return 'fast';
  }

  // Moderate Ground (mellanfast mark)
  if (
    normalized.includes('sand') ||
    normalized.includes('silt') ||
    normalized.includes('sediment') ||
    normalized.includes('fyllning')
  ) {
    return 'mellanfast';
  }

  return 'mellanfast'; // Default/unclassified
}

/**
 * Performs PostGIS-driven SGI Geokalkyl spatial geoprocessing calculations.
 */
export async function calculateGeoKalkyl(input: GeoKalkylInput): Promise<GeoKalkylResult> {
  const pipeDepth = input.pipeDepth ?? 1.8;
  const baseCost = input.baseCost ?? 1250;
  
  const geojsonString = typeof input.geometry === 'string' 
    ? input.geometry 
    : JSON.stringify(input.geometry);

  logger.info(`Running PostGIS-driven Geokalkyl calculation. Depth: ${pipeDepth}m, BaseCost: ${baseCost} SEK/m`);

  try {
    // 1. Splitting pipeline geometry into segments intersecting SGU soil types
    type RawSegmentRow = {
      jg2_tx: string | null;
      jg2: string | null;
      length_m: number;
      seg_geojson: string;
    };

    const segmentsQuery = await prisma.$queryRawUnsafe<RawSegmentRow[]>(`
      WITH input_geom AS (
        SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 3006) AS geom
      ),
      intersecting_segments AS (
        SELECT 
          s.jg2_tx,
          s.jg2::text AS jg2,
          ST_Intersection(s.geom, i.geom) AS seg_geom
        FROM env.sgu_soil_type_25k_100k s, input_geom i
        WHERE ST_Intersects(s.geom, i.geom)
      ),
      segmented_lengths AS (
        SELECT 
          jg2_tx,
          jg2,
          ST_Length(seg_geom) AS length_m,
          seg_geom AS geom
        FROM intersecting_segments
        WHERE ST_Length(seg_geom) > 0.01
      ),
      uncovered_geom AS (
        SELECT 
          ST_Difference(
            i.geom, 
            COALESCE((SELECT ST_Union(geom) FROM segmented_lengths), ST_SetSRID('GEOMETRYCOLLECTION EMPTY'::geometry, 3006))
          ) AS geom
        FROM input_geom i
      ),
      uncovered_segments AS (
        SELECT 
          'Oklassat område' AS jg2_tx,
          '90'::text AS jg2,
          ST_Length((ST_Dump(geom)).geom) AS length_m,
          (ST_Dump(geom)).geom AS geom
        FROM uncovered_geom
        WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
      ),
      all_segments AS (
        SELECT jg2_tx, jg2, length_m, geom FROM segmented_lengths
        UNION ALL
        SELECT jg2_tx, jg2, length_m, geom FROM uncovered_segments
      )
      SELECT 
        jg2_tx,
        jg2,
        length_m,
        ST_AsGeoJSON(geom) AS seg_geojson
      FROM all_segments
      WHERE length_m > 0.01;
    `, geojsonString);

    const segments: GeoKalkylSegment[] = [];
    let totalCost = 0;
    let totalLengthMeters = 0;
    let clayDepthSum = 0;
    let clayDepthCount = 0;

    let landslideOverlap = false;
    let contaminatedSiteOverlap = false;
    let publicRoadOverlap = false;
    let privatePropertyOverlap = false;

    // Helper functions for checking proximity and features per segment
    for (const raw of segmentsQuery) {
      const soilType = raw.jg2_tx || 'Oklassat område';
      const groundType = classifyGroundType(soilType);
      const len = raw.length_m;
      totalLengthMeters += len;

      // 2. Fetch segment-specific spatial overlays
      type OverlayRow = {
        is_road: boolean;
        is_property: boolean;
        is_landslide: boolean;
        is_contaminated: boolean;
        avg_clay_depth: number;
      };

      const overlays = await prisma.$queryRawUnsafe<OverlayRow[]>(`
        SELECT 
          EXISTS (
            SELECT 1 FROM topo10.vag r 
            WHERE ST_Intersects(r.geom, ST_GeomFromGeoJSON($1))
          ) AS is_road,
          EXISTS (
            SELECT 1 FROM env.registerenhetsomradesytor p
            WHERE ST_Intersects(p.geom, ST_GeomFromGeoJSON($1))
          ) AS is_property,
          EXISTS (
            SELECT 1 FROM env.sgu_landslide_feature l
            WHERE ST_DWithin(l.geom, ST_GeomFromGeoJSON($1), 150)
          ) AS is_landslide,
          EXISTS (
            SELECT 1 FROM env.ebh_potentiellt_fororenade_omraden e
            WHERE ST_DWithin(e.geom, ST_GeomFromGeoJSON($1), 100)
          ) AS is_contaminated,
          COALESCE((
            SELECT AVG(NULLIF(b.depth_from, 0))
            FROM env.sgu_borrhal b
            WHERE ST_DWithin(b.geom, ST_GeomFromGeoJSON($1), 250)
          ), 6.0) AS avg_clay_depth;
      `, raw.seg_geojson);

      const overlay = overlays[0] || {
        is_road: false,
        is_property: false,
        is_landslide: false,
        is_contaminated: false,
        avg_clay_depth: 6.0,
      };

      if (overlay.is_road) publicRoadOverlap = true;
      if (overlay.is_property) privatePropertyOverlap = true;
      if (overlay.is_landslide) landslideOverlap = true;
      if (overlay.is_contaminated) contaminatedSiteOverlap = true;

      // Calculate Complexity Factors
      // Area Type: Public Roads (+25%), Private Property (+15%), Default (0%)
      const areaTypeFactor = overlay.is_road ? 0.25 : (overlay.is_property ? 0.15 : 0.0);
      
      // Depth of pipe: +10% per meter of depth
      const depthFactor = pipeDepth * 0.10;

      // Clay depth factor:
      // If Solid Ground: No addition (0)
      // If Moderate Ground: +10% (0.10)
      // If Soft Ground: +15% * Average Clay Depth (0.15 * clayDepth)
      let groundTypeFactor = 0;
      let segmentClayDepth = null;

      if (groundType === 'mellanfast') {
        groundTypeFactor = 0.10;
      } else if (groundType === 'svag') {
        const clayDepthVal = Number(overlay.avg_clay_depth);
        segmentClayDepth = clayDepthVal;
        groundTypeFactor = 0.15 * clayDepthVal;
        clayDepthSum += clayDepthVal;
        clayDepthCount++;
      }

      // Landslide overlap buffer (within 150m): +20%
      const landslideFactor = overlay.is_landslide ? 0.20 : 0.0;

      // Environmental hazard proximity (within 100m): +30%
      const contaminatedFactor = overlay.is_contaminated ? 0.30 : 0.0;

      const totalComplexity = areaTypeFactor + depthFactor + groundTypeFactor + landslideFactor + contaminatedFactor;
      const segmentCost = len * baseCost * (1 + totalComplexity);
      totalCost += segmentCost;

      segments.push({
        lengthMeters: len,
        soilType,
        groundType,
        complexityFactors: {
          areaType: areaTypeFactor,
          depth: depthFactor,
          groundType: groundTypeFactor,
          landslide: landslideFactor,
          contaminated: contaminatedFactor,
        },
        totalComplexity,
        segmentCost,
        isPublicRoad: overlay.is_road,
        isPrivateProperty: overlay.is_property,
        isNearLandslide: overlay.is_landslide,
        isNearContaminated: overlay.is_contaminated,
        clayDepth: segmentClayDepth,
      });
    }

    const averageClayDepth = clayDepthCount > 0 ? (clayDepthSum / clayDepthCount) : 6.0;
    const baselineCost = totalLengthMeters * baseCost;

    return {
      totalCost,
      lengthMeters: totalLengthMeters,
      baselineCost,
      averageClayDepth,
      landslideOverlap,
      contaminatedSiteOverlap,
      publicRoadOverlap,
      privatePropertyOverlap,
      segments,
    };
  } catch (error) {
    logger.error('Error running Geokalkyl calculation in PostGIS:', error);
    throw error;
  }
}
