import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma';
import type { GeologicalData } from './sguService';

export type SguCoverageMode = 'sample' | 'complete';
const SGU_GROUND_LAYER_TABLE = 'env.sgu_soil_type_25k_100k';

export interface SguGroundLayerHit {
  sourceKey: string;
  layerCode: number | null;
  layerLabel: string | null;
  mapType: number | null;
  sourceScale: string;
}

export interface SguLandslideFeatureHit {
  sourceKey: string;
  featureCode: number | null;
  featureLabel: string | null;
  distanceMeters: number;
}

export interface SguRiskAudit {
  coverageMode: SguCoverageMode;
  manualReviewRequired: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  groundLayer: {
    intersects: boolean;
    hit: SguGroundLayerHit | null;
    advisory: string;
  };
  landslideFeatures: {
    nearby: boolean;
    bufferMeters: number;
    nearestDistanceMeters: number | null;
    hits: SguLandslideFeatureHit[];
    advisory: string;
  };
  flags: string[];
  summary: string;
}

type GroundLayerRow = {
  source_key: string;
  layer_code: number | null;
  layer_label: string | null;
  map_type: number | null;
  source_scale: string;
};

type LandslideFeatureRow = {
  source_key: string;
  feature_code: number | null;
  feature_label: string | null;
  distance_meters: number;
};

export const SGU_LANDSLIDE_REVIEW_BUFFER_METERS = 150;

function getCoverageMode(): SguCoverageMode {
  return String(process.env.SGU_DB_COVERAGE_MODE || 'sample')
    .trim()
    .toLowerCase() === 'complete'
    ? 'complete'
    : 'sample';
}

function buildGroundLayerAdvisory(hit: SguGroundLayerHit | null): string {
  if (!hit) {
    return 'Ingen träff i lokal SGU-grundlagerdatabas. Negativ slutsats får inte dras utan fortsatt manuell kontroll.';
  }

  return `Översiktligt SGU-grundlager (${hit.sourceScale}) anger ${hit.layerLabel || 'okänt lager'} för platsen. Detta är screening, inte fastighetsprecis markbedömning.`;
}

function buildLandslideAdvisory(hits: SguLandslideFeatureHit[], coverageMode: SguCoverageMode): string {
  if (hits.length === 0) {
    if (coverageMode === 'sample') {
      return 'Ingen träff i lokal stickprovsimport för SGU skred/raviner. Frånvaro av träff är inte ett frikännande och kräver fortsatt manuell kontroll.';
    }
    return 'Ingen SGU-träff för skred/ravin inom vald granskningsradie i den lokala databasen.';
  }

  const nearest = hits[0];
  return `SGU-indikator ${nearest.featureLabel || 'okänt objekt'} finns inom ${Math.round(nearest.distanceMeters)} m. Detta är rådgivande geotekniskt beslutsstöd och ska alltid verifieras manuellt.`;
}

function deriveRiskLevel(hits: SguLandslideFeatureHit[]): 'LOW' | 'MEDIUM' | 'HIGH' {
  const nearest = hits[0];
  if (!nearest) return 'LOW';

  const label = String(nearest.featureLabel || '').toLowerCase();
  if (nearest.distanceMeters <= 50 && (label.includes('skred') || label.includes('ravin'))) {
    return 'HIGH';
  }
  if (label.includes('skredväg') || label.includes('skredärr') || label.includes('ravin')) {
    return 'MEDIUM';
  }
  return 'LOW';
}

export async function auditSguRiskAtPoint(lat: number, lng: number): Promise<SguRiskAudit> {
  const coverageMode = getCoverageMode();

  const groundLayerRows = await prisma.$queryRaw<GroundLayerRow[]>(Prisma.sql`
    SELECT
      id::text AS source_key,
      jg2 AS layer_code,
      jg2_tx AS layer_label,
      karttyp AS map_type,
      '1:25 000-1:100 000'::text AS source_scale
    FROM ${Prisma.raw(SGU_GROUND_LAYER_TABLE)}
    WHERE ST_Covers(
      geom,
      ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
    )
    LIMIT 1;
  `);

  const landslideRows = await prisma.$queryRaw<LandslideFeatureRow[]>`
    SELECT
      source_key,
      feature_code,
      feature_label,
      ST_Distance(
        geom,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
      ) AS distance_meters
    FROM env.sgu_landslide_feature
    WHERE ST_DWithin(
      geom,
      ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006),
      ${SGU_LANDSLIDE_REVIEW_BUFFER_METERS}
    )
    ORDER BY distance_meters ASC
    LIMIT 10;
  `;

  const groundHit = groundLayerRows[0]
    ? {
        sourceKey: groundLayerRows[0].source_key,
        layerCode: groundLayerRows[0].layer_code,
        layerLabel: groundLayerRows[0].layer_label,
        mapType: groundLayerRows[0].map_type,
        sourceScale: groundLayerRows[0].source_scale,
      }
    : null;

  const landslideHits = landslideRows.map((row) => ({
    sourceKey: row.source_key,
    featureCode: row.feature_code,
    featureLabel: row.feature_label,
    distanceMeters: Number(row.distance_meters),
  }));

  const flags: string[] = [];
  if (groundHit?.layerLabel) {
    flags.push(`grundlager:${groundHit.layerLabel}`);
  }
  if (landslideHits.length > 0) {
    flags.push(
      ...landslideHits
        .slice(0, 3)
        .map(
          (hit) => `sgu:${(hit.featureLabel || 'okänt').toLowerCase()}:${Math.round(hit.distanceMeters)}m`,
        ),
    );
  } else if (coverageMode === 'sample') {
    flags.push('sgu:sample-coverage');
  }

  const riskLevel = deriveRiskLevel(landslideHits);
  const manualReviewRequired = landslideHits.length > 0 || coverageMode === 'sample';
  const groundLayerAdvisory = buildGroundLayerAdvisory(groundHit);
  const landslideAdvisory = buildLandslideAdvisory(landslideHits, coverageMode);

  const summaryParts = [groundLayerAdvisory, landslideAdvisory];
  if (coverageMode === 'sample') {
    summaryParts.push(
      'Lokal SGU-databas är i testläge med stickprovsimport. Full nationell täckning är inte verifierad.',
    );
  }

  return {
    coverageMode,
    manualReviewRequired,
    riskLevel,
    groundLayer: {
      intersects: Boolean(groundHit),
      hit: groundHit,
      advisory: groundLayerAdvisory,
    },
    landslideFeatures: {
      nearby: landslideHits.length > 0,
      bufferMeters: SGU_LANDSLIDE_REVIEW_BUFFER_METERS,
      nearestDistanceMeters: landslideHits[0] ? landslideHits[0].distanceMeters : null,
      hits: landslideHits,
      advisory: landslideAdvisory,
    },
    flags,
    summary: summaryParts.join(' '),
  };
}

export function toGeologicalData(audit: SguRiskAudit): GeologicalData {
  return {
    soilType: audit.groundLayer.hit?.layerLabel || 'Okänd',
    groundLayerScale: audit.groundLayer.hit?.sourceScale || '1:1 000 000',
    landslideFeatureHits: audit.landslideFeatures.hits.map((hit) => ({
      featureCode: hit.featureCode,
      featureLabel: hit.featureLabel || 'Okänt objekt',
      distanceMeters: hit.distanceMeters,
    })),
    landslideRiskLevel:
      audit.riskLevel === 'HIGH' ? 'HIGH' : audit.riskLevel === 'MEDIUM' ? 'ADVISORY' : 'NONE',
    manualReviewRequired: audit.manualReviewRequired,
    coverageMode: audit.coverageMode,
    riskDescription: audit.summary,
  };
}
