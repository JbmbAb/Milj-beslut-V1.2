/**
 * GIS-analys för C-anmälan schaktmassor — eget flöde, separat från avlopp/lokaliseringsutredning.
 */

import { queryMarkCoverAtPoint } from '../../services/markCoverService';
import type { AuthUser } from '../../security/types';
import type {
  MassGISAnalysis,
  MassGisAnalysisResponse,
  MassGisSnapshot,
  MassSiteProfile,
  MassSiteConstraint,
} from '../../../src/types/mass';
import { searchPropertyForMass } from './massOrchestrator';

type GeoJsonGeometry = {
  type?: string;
  coordinates?: unknown;
};

function centroidFromGeometry(geometry: unknown): { lat: number; lng: number } | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as GeoJsonGeometry;

  if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const [lng, lat] = g.coordinates as number[];
    return { lat, lng };
  }

  if (g.type === 'Polygon' && Array.isArray(g.coordinates?.[0])) {
    const ring = g.coordinates[0] as number[][];
    if (ring.length === 0) return null;
    let sumLng = 0;
    let sumLat = 0;
    for (const [lng, lat] of ring) {
      sumLng += lng;
      sumLat += lat;
    }
    return { lat: sumLat / ring.length, lng: sumLng / ring.length };
  }

  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates?.[0]?.[0])) {
    return centroidFromGeometry({ type: 'Polygon', coordinates: g.coordinates[0] });
  }

  return null;
}

function estimateAreaM2(geometry: unknown): number | undefined {
  if (!geometry || typeof geometry !== 'object') return undefined;
  const g = geometry as GeoJsonGeometry;
  if (g.type !== 'Polygon' || !Array.isArray(g.coordinates?.[0])) return undefined;
  const ring = g.coordinates[0] as number[][];
  if (ring.length < 3) return undefined;

  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    area += lng1 * lat2 - lng2 * lat1;
  }
  const m2PerDeg = 111_320 * 63_000;
  return Math.abs(area / 2) * m2PerDeg;
}

function buildConstraints(markCover?: { nmdCode: number; description: string }): MassSiteConstraint[] {
  const constraints: MassSiteConstraint[] = [];
  const code = markCover?.nmdCode;

  if (code === 51 || code === 52 || code === 31 || code === 32) {
    constraints.push({
      code: 'WATER_PROXIMITY',
      label: 'Våtmark/vatten nära platsen — deponi kräver fördjupad prövning.',
      severity: 'HIGH',
    });
  }
  if (code === 41 || code === 42) {
    constraints.push({
      code: 'BUILT_UP',
      label: 'Bebyggelse/infrastruktur — mellanlagring kräver avgränsad yta och bullerplan.',
      severity: 'MEDIUM',
    });
  }
  if (code === 21) {
    constraints.push({
      code: 'AGRICULTURE',
      label: 'Jordbruksmark — kontrollera arrende och markavvattning före masshantering.',
      severity: 'MEDIUM',
    });
  }
  if (constraints.length === 0) {
    constraints.push({
      code: 'BASELINE',
      label: 'Ingen kritisk marktäckeskonflikt identifierad vid centroid.',
      severity: 'LOW',
    });
  }
  return constraints;
}

function scoreSite(constraints: MassSiteConstraint[]): {
  overallRiskScore: number;
  logisticsSuitability: MassGISAnalysis['logisticsSuitability'];
} {
  const hasHigh = constraints.some((item) => item.severity === 'HIGH');
  const hasMedium = constraints.some((item) => item.severity === 'MEDIUM');
  const overallRiskScore = hasHigh ? 78 : hasMedium ? 52 : 28;
  const logisticsSuitability = hasHigh ? 'RESTRICTED' : hasMedium ? 'REVIEW_REQUIRED' : 'SUITABLE';
  return { overallRiskScore, logisticsSuitability };
}

function buildSiteProfile(
  propertyDesignation: string,
  centroid: { lat: number; lng: number },
  source: string,
): MassSiteProfile {
  return {
    propertyDesignation,
    centroid,
    source,
    recommendedZones: [
      { id: 'zone-transit', label: 'Infart / vändplan', operationType: 'TRANSIT', offsetM: 0 },
      { id: 'zone-mellanlagring', label: 'Mellanlagring', operationType: 'MELLANLAGRING', offsetM: 35 },
      { id: 'zone-deponi', label: 'Deponi / mottag', operationType: 'DEPONI', offsetM: -35 },
    ],
  };
}

function vitestMassGisStub(propertyDesignation: string): MassGisAnalysisResponse {
  const centroid = { lat: 60.67, lng: 17.14 };
  const markCover = { nmdCode: 21, description: 'Jordbruksmark' };
  const siteConstraints = buildConstraints(markCover);
  const { overallRiskScore, logisticsSuitability } = scoreSite(siteConstraints);

  return {
    propertySource: 'vitest',
    siteProfile: buildSiteProfile(propertyDesignation, centroid, 'vitest'),
    analysis: {
      propertyDesignation,
      timestamp: new Date().toISOString(),
      centroid,
      municipalityCode: '2180',
      municipalityName: 'Gävle',
      propertyAreaM2: 24_000,
      markCover,
      siteConstraints,
      overallRiskScore,
      logisticsSuitability,
      warnings: [],
      reasoning: ['Vitest: deterministisk mass-GIS utan externa API:er.'],
    },
  };
}

export type { MassGisSnapshot };

export async function analyzeMassSiteGis(
  authUser: AuthUser,
  input: { projectId: string; propertyDesignation: string },
): Promise<{ ok: true; data: MassGisAnalysisResponse } | { ok: false; status: number; error: string; warnings?: string[] }> {
  if (process.env.VITEST === 'true') {
    return { ok: true, data: vitestMassGisStub(input.propertyDesignation) };
  }

  const propertyResult = await searchPropertyForMass(authUser, {
    projectId: input.projectId,
    propertyDesignation: input.propertyDesignation,
    purpose: 'c_anmalan_mass_gis',
  });

  if (!propertyResult.ok) {
    return {
      ok: false,
      status: propertyResult.status ?? 400,
      error: propertyResult.error ?? 'property_lookup_failed',
      warnings: propertyResult.warnings,
    };
  }

  const payload = propertyResult.result as Record<string, unknown>;
  const geometry = payload.geometry ?? (payload.boundaries as { geometry?: unknown } | undefined)?.geometry;
  const centroid =
    centroidFromGeometry(geometry) ??
    (payload.centroid as { lat: number; lng: number } | null) ??
    null;

  if (!centroid) {
    return {
      ok: false,
      status: 422,
      error: 'property_geometry_missing',
      warnings: propertyResult.warnings,
    };
  }

  const boundariesProps = (payload.boundaries as { properties?: Record<string, unknown> } | undefined)?.properties;
  const markCover = await queryMarkCoverAtPoint(centroid.lat, centroid.lng).catch(() => null);
  const siteConstraints = buildConstraints(
    markCover ? { nmdCode: markCover.value, description: markCover.description } : undefined,
  );
  const { overallRiskScore, logisticsSuitability } = scoreSite(siteConstraints);
  const warnings = [...(propertyResult.warnings ?? [])];
  if (!markCover) {
    warnings.push('Marktäcke kunde inte verifieras vid centroid.');
  }

  const analysis: MassGISAnalysis = {
    propertyDesignation: input.propertyDesignation,
    timestamp: new Date().toISOString(),
    centroid,
    municipalityCode: boundariesProps?.municipalityCode as string | undefined,
    municipalityName: boundariesProps?.municipalityName as string | undefined,
    propertyAreaM2: estimateAreaM2(geometry),
    markCover: markCover ? { nmdCode: markCover.value, description: markCover.description } : undefined,
    siteConstraints,
    overallRiskScore,
    logisticsSuitability,
    warnings,
    reasoning: [
      `Fastighet verifierad via ${propertyResult.source}.`,
      markCover
        ? `Marktäcke: ${markCover.description}.`
        : 'Marktäcke saknas — använd fältkontroll före platsval.',
      logisticsSuitability === 'SUITABLE'
        ? 'Platsen bedöms lämplig för planerad masslogistik med normal kontrollnivå.'
        : 'Platsen kräver kompletterande GIS- och bullerunderlag.',
    ],
  };

  return {
    ok: true,
    data: {
      analysis,
      siteProfile: buildSiteProfile(input.propertyDesignation, centroid, propertyResult.source),
      propertySource: propertyResult.source,
    },
  };
}
