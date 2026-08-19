import { prisma } from '../db/prisma';
import { auditSguRiskAtPoint, type SguRiskAudit } from './sguRiskService';
import { auditInSarRiskAtPoint, type InSarRiskAudit } from './sgiInSarService';
import { logger } from '../logger';

export interface LocalProtectedAreaHit {
  nvr_id: string;
  name: string | null;
  protection_type: string | null;
  decision_status: string | null;
}

export interface SpatialAuditSummary {
  protectedAreaHits: LocalProtectedAreaHit[];
  protectedAreaAvailable: boolean;
  protectedAreaWarning?: string;
  isProtected: boolean;
  sgu: SguRiskAudit;
  insar: InSarRiskAudit;
  /** Shortest distance in meters to nearest water body (lake, stream, topo10 water). null if unavailable. */
  distanceToWaterMeters: number | null;
  distanceToWaterAvailable: boolean;
  distanceToWaterWarning?: string;
  text: string;
  sources: Array<{ web: { uri: string; title: string } }>;
}

async function fetchProtectedAreaHits(lat: number, lng: number): Promise<LocalProtectedAreaHit[]> {
  return prisma.$queryRaw<LocalProtectedAreaHit[]>`
    WITH point AS (
      SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006) AS geom
    )
    SELECT *
    FROM (
      SELECT
        nvr_id,
        name,
        protection_type,
        decision_status
      FROM env.protected_area, point
      WHERE ST_Intersects(env.protected_area.geom, point.geom)

      UNION ALL

      SELECT
        external_id AS nvr_id,
        site_name AS name,
        ('Natura 2000 ' || category) AS protection_type,
        NULL::text AS decision_status
      FROM env.natura2000_area, point
      WHERE ST_Intersects(env.natura2000_area.wkb_geometry, point.geom)
    ) hits
    LIMIT 10;
  `;
}

async function fetchDistanceToWater(lat: number, lng: number): Promise<number | null> {
  type DistRow = { distance_m: number };
  const rows = await prisma.$queryRaw<DistRow[]>`
    WITH point AS (
      SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006) AS geom
    )
    SELECT ST_Distance(t.geom, point.geom) AS distance_m
    FROM topo10.vatten t, point
    WHERE ST_DWithin(t.geom, point.geom, 500)
    ORDER BY distance_m ASC
    LIMIT 1;
  `;
  const val = rows[0]?.distance_m;
  return val != null ? Number(val) : null;
}

function fallbackInSarAudit(reason: string): InSarRiskAudit {
  return {
    pointCount: 0,
    averageVelocityMmYear: 0,
    maxSubsidenceMmYear: 0,
    riskLevel: 'LOW',
    advisory: reason,
    sourceUrl: 'https://gis.sgi.se/geoserver/wfs?service=WFS&version=2.0.0&request=GetCapabilities',
    points: [],
    warningFlags: ['insar:unavailable'],
  };
}

function fallbackSguAudit(reason: string): SguRiskAudit {
  return {
    coverageMode: 'sample',
    manualReviewRequired: true,
    riskLevel: 'LOW',
    groundLayer: {
      intersects: false,
      hit: null,
      advisory: reason,
    },
    landslideFeatures: {
      nearby: false,
      bufferMeters: 150,
      nearestDistanceMeters: null,
      hits: [],
      advisory: reason,
    },
    flags: ['sgu:unavailable'],
    summary: reason,
  };
}

export async function runSpatialAudit(lat: number, lng: number): Promise<SpatialAuditSummary> {
  const sguPromise = auditSguRiskAtPoint(lat, lng).catch((error) => {
    const reason = `SGU riskkontroll kunde inte köras: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn('auditSguRiskAtPoint failed', { lat, lng, error: String(error) });
    return fallbackSguAudit(reason);
  });

  const insarPromise = auditInSarRiskAtPoint(lat, lng).catch((error) => {
    const reason = `SGI InSAR riskkontroll kunde inte köras: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn('auditInSarRiskAtPoint failed', { lat, lng, error: String(error) });
    return fallbackInSarAudit(reason);
  });

  const [protectedAreaResult, distanceResult, sgu, insar] = await Promise.all([
    // 1. Skyddad natur (NVR + Natura 2000)
    (async () => {
      try {
        const hits = await fetchProtectedAreaHits(lat, lng);
        return { ok: true as const, hits };
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        const warning = details.includes('env.protected_area')
          ? 'Lokal tabell for skyddad natur saknas i databasen.'
          : `Skyddad natur kunde inte verifieras i lokal databas: ${details}`;
        return { ok: false as const, warning };
      }
    })(),

    // 2. Avstånd till vatten
    (async () => {
      try {
        const distance = await fetchDistanceToWater(lat, lng);
        return { ok: true as const, distance };
      } catch (error) {
        const warning = `Kunde inte beräkna avstånd till vatten: ${error instanceof Error ? error.message : String(error)}`;
        logger.warn('fetchDistanceToWater failed', { lat, lng, error: String(error) });
        return { ok: false as const, warning };
      }
    })(),

    // 3. SGU Risk (redan optimerad internt nu)
    sguPromise,

    // 4. SGI InSAR Markrörelser
    insarPromise,
  ]);

  const protectedAreaHits = protectedAreaResult.ok ? protectedAreaResult.hits : [];
  const protectedAreaAvailable = protectedAreaResult.ok;
  const protectedAreaWarning = protectedAreaResult.ok ? undefined : protectedAreaResult.warning;

  const distanceToWaterMeters = distanceResult.ok ? distanceResult.distance : null;
  const distanceToWaterAvailable = distanceResult.ok;
  const distanceToWaterWarning = distanceResult.ok ? undefined : distanceResult.warning;

  const parts: string[] = [];
  if (!protectedAreaAvailable) {
    parts.push(`Skyddad natur: ${protectedAreaWarning}`);
  } else if (protectedAreaHits.length > 0) {
    const names = protectedAreaHits
      .map((hit) => hit.name || 'namnlost omrade')
      .slice(0, 3)
      .join(', ');
    parts.push(
      `Skyddad natur: platsen overlappar ${protectedAreaHits.length} registrerat omrade i lokal PostGIS (${names}).`,
    );
  } else {
    parts.push('Skyddad natur: ingen direkt overlapptreff i lokal NVR-databas.');
  }

  if (distanceToWaterAvailable && distanceToWaterMeters != null) {
    parts.push(`Avstånd till närmaste vattenförekomst: ${Math.round(distanceToWaterMeters)} m.`);
  } else if (!distanceToWaterAvailable) {
    parts.push(`Vatten: ${distanceToWaterWarning}`);
  }

  parts.push(sgu.summary);
  parts.push(`InSAR (Markrörelser): ${insar.advisory}`);

  const sources: Array<{ web: { uri: string; title: string } }> = [];
  sources.push({
    web: {
      title: 'SGI InSAR Markrörelser',
      uri: 'https://www.sgi.se/tjanster-och-verktyg/kartor-och-verktyg/insar/',
    },
  });
  sources.push({
    web: {
      title: 'Naturvardsregistret / lokal PostGIS',
      uri: 'https://skyddadnatur.naturvardsverket.se/',
    },
  });
  sources.push({
    web: {
      title: 'SGU jordarter 1 miljon / grundlager',
      uri: 'https://api.sgu.se/oppnadata/jordarter1miljon/ogc/features/v1/collections/grundlager',
    },
  });

  return {
    protectedAreaHits,
    protectedAreaAvailable,
    protectedAreaWarning,
    isProtected: protectedAreaHits.length > 0,
    sgu,
    insar,
    distanceToWaterMeters,
    distanceToWaterAvailable,
    distanceToWaterWarning,
    text: parts.join(' '),
    sources,
  };
}
