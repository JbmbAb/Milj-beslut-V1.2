import { prisma } from '../../db/prisma';
import { buildNmdClassValuesSql, getAvailableNmdRasterRelation } from './nmdRasterService';

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function getNmdVectorTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const relation = await getAvailableNmdRasterRelation(prisma);
  if (!relation) {
    return null;
  }

  const qualifiedTable = `${quoteIdent(relation.schema)}.${quoteIdent(relation.table)}`;
  const classValuesSql = buildNmdClassValuesSql();
  const sql = `
    WITH bounds AS (
      SELECT
        ST_TileEnvelope($1, $2, $3) AS geom_3857,
        ST_Transform(ST_TileEnvelope($1, $2, $3), 3006) AS geom_3006
    ),
    clipped AS (
      SELECT ST_Clip(t.rast, b.geom_3006, true) AS rast, b.geom_3857
      FROM ${qualifiedTable} t
      CROSS JOIN bounds b
      WHERE ST_Intersects(t.rast, b.geom_3006)
    ),
    polygons AS (
      SELECT
        (dumped).val::integer AS nmd_code,
        ST_Transform((dumped).geom, 3857) AS geom_3857
      FROM clipped c
      CROSS JOIN LATERAL ST_DumpAsPolygons(c.rast, 1, true) AS dumped
      WHERE (dumped).val IS NOT NULL
    ),
    mvtgeom AS (
      SELECT
        ST_AsMVTGeom(p.geom_3857, b.geom_3857, 4096, 64, true) AS geom,
        p.nmd_code,
        COALESCE(labels.description, 'Okänd klass (' || p.nmd_code || ')') AS description
      FROM polygons p
      CROSS JOIN bounds b
      LEFT JOIN (VALUES ${classValuesSql}) AS labels(nmd_code, description)
        ON labels.nmd_code = p.nmd_code
      WHERE ST_Intersects(p.geom_3857, b.geom_3857)
    )
    SELECT ST_AsMVT(mvtgeom, 'nmd', 4096, 'geom') AS mvt
    FROM mvtgeom
    WHERE geom IS NOT NULL
  `;

  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`);
    return tx.$queryRawUnsafe<Array<{ mvt: Buffer | null }>>(sql, z, x, y);
  });

  return rows[0]?.mvt ?? null;
}
