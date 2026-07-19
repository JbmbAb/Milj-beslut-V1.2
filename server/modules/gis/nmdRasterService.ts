import { prisma } from '../../db/prisma';
import type { PrismaClient } from '@prisma/client';
import { getNmdMbKategori, NMD_CLASS_MAP, type NmdMbKategori } from './nmdMetadata';

type QueryablePrisma = Pick<PrismaClient, '$queryRawUnsafe' | '$transaction'>;

export type NmdRasterRelation = {
  schema: string;
  table: string;
};

export type NmdRasterPointHit = {
  code: number;
  description: string;
  mbKategori: NmdMbKategori;
  source: 'nmd2023_postgis';
  relation: `${string}.${string}`;
};

type NmdRasterValueRow = {
  value: number | null;
};

export const NMD_RASTER_RELATIONS: readonly NmdRasterRelation[] = [
  { schema: 'env', table: 'nmd_2023' },
  { schema: 'env', table: 'marktacke' },
] as const;

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toQualifiedRelationName(relation: NmdRasterRelation): `${string}.${string}` {
  return `${relation.schema}.${relation.table}`;
}

export async function getAvailableNmdRasterRelation(db: QueryablePrisma = prisma): Promise<NmdRasterRelation | null> {
  for (const relation of NMD_RASTER_RELATIONS) {
    const qualifiedName = toQualifiedRelationName(relation);
    const rows = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      qualifiedName,
    );

    if (rows[0]?.exists) {
      return relation;
    }
  }

  return null;
}

export async function queryNmdRasterPoint(
  latitude: number,
  longitude: number,
  db: QueryablePrisma = prisma,
): Promise<NmdRasterPointHit | null> {
  const relation = await getAvailableNmdRasterRelation(db);
  if (!relation) {
    return null;
  }

  const qualifiedTable = `${quoteIdent(relation.schema)}.${quoteIdent(relation.table)}`;
  const sql = `
    WITH point AS (
      SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3006) AS geom
    )
    SELECT ST_Value(t.rast, p.geom)::integer AS value
    FROM ${qualifiedTable} t, point p
    WHERE ST_Intersects(t.rast, p.geom)
    LIMIT 1
  `;

  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '10s'`);
    return tx.$queryRawUnsafe<NmdRasterValueRow[]>(sql, longitude, latitude);
  });

  const rawValue = rows[0]?.value;
  if (rawValue == null) {
    return null;
  }

  const code = Number(rawValue);
  if (!Number.isFinite(code)) {
    return null;
  }

  return {
    code,
    description: NMD_CLASS_MAP[code] ?? `Okänd klass (${code})`,
    mbKategori: getNmdMbKategori(code),
    source: 'nmd2023_postgis',
    relation: toQualifiedRelationName(relation),
  };
}

export async function getNmdOutOfDbBandPath(db: Pick<PrismaClient, '$queryRawUnsafe'> = prisma): Promise<string | null> {
  const relation = await getAvailableNmdRasterRelation(db as QueryablePrisma);
  if (!relation) {
    return null;
  }

  const qualifiedTable = `${quoteIdent(relation.schema)}.${quoteIdent(relation.table)}`;
  const rows = await db.$queryRawUnsafe<Array<{ path: string | null }>>(
    `SELECT ST_BandPath(rast) AS path FROM ${qualifiedTable} LIMIT 1`,
  );

  return rows[0]?.path ?? null;
}

export function buildNmdClassValuesSql(): string {
  return Object.entries(NMD_CLASS_MAP)
    .map(([code, description]) => `(${code}, ${quoteLiteral(description)})`)
    .join(', ');
}
