import { prisma } from "../db/prisma";
import { auditSguRiskAtPoint, type SguRiskAudit } from "./sguRiskService";

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
      WHERE ST_Intersects(env.natura2000_area.geom, point.geom)
    ) hits
    LIMIT 10;
  `;
}

export async function runSpatialAudit(lat: number, lng: number): Promise<SpatialAuditSummary> {
  let protectedAreaHits: LocalProtectedAreaHit[] = [];
  let protectedAreaAvailable = true;
  let protectedAreaWarning: string | undefined;

  const sguPromise = auditSguRiskAtPoint(lat, lng);

  try {
    protectedAreaHits = await fetchProtectedAreaHits(lat, lng);
  } catch (error) {
    protectedAreaAvailable = false;
    const details = error instanceof Error ? error.message : String(error);
    protectedAreaWarning = details.includes('env.protected_area')
      ? 'Lokal tabell for skyddad natur saknas i databasen.'
      : `Skyddad natur kunde inte verifieras i lokal databas: ${details}`;
  }

  const sgu = await sguPromise;

  const parts: string[] = [];
  if (!protectedAreaAvailable) {
    parts.push(`Skyddad natur: ${protectedAreaWarning}`);
  } else if (protectedAreaHits.length > 0) {
    const names = protectedAreaHits.map((hit) => hit.name || 'namnlost omrade').slice(0, 3).join(', ');
    parts.push(`Skyddad natur: platsen overlappar ${protectedAreaHits.length} registrerat omrade i lokal PostGIS (${names}).`);
  } else {
    parts.push('Skyddad natur: ingen direkt overlapptreff i lokal NVR-databas.');
  }
  parts.push(sgu.summary);

  const sources: Array<{ web: { uri: string; title: string } }> = [];
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
  sources.push({
    web: {
      title: 'SGU jordskred-raviner',
      uri: 'https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1/collections/jordskred-raviner',
    },
  });

  return {
    protectedAreaHits,
    protectedAreaAvailable,
    protectedAreaWarning,
    isProtected: protectedAreaHits.length > 0,
    sgu,
    text: parts.join(' '),
    sources,
  };
}
