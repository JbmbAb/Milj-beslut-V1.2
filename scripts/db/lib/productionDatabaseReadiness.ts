import { Pool } from 'pg';

export type ProductionDatabaseReadinessResult = {
  ok: boolean;
  postgisVersion: string;
  schemas: string[];
  spatialRefCount: number;
};

/**
 * Mirrors server/index.ts sovereign DB validation — do not weaken thresholds here.
 */
export async function verifyProductionDatabaseReadiness(
  pool: Pool,
): Promise<ProductionDatabaseReadinessResult> {
  await pool.query('SELECT 1');

  const postgis = await pool.query<{ ver: string }>('SELECT PostGIS_Full_Version() as ver');
  const postgisVersion = postgis.rows[0]?.ver;
  if (!postgisVersion) {
    throw new Error('PostGIS extension is not installed or enabled in the database.');
  }

  const schemasResult = await pool.query<{ schema_name: string }>(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name IN ('core', 'env', 'topo10', 'lm')
  `);
  const schemas = schemasResult.rows.map((row) => row.schema_name);
  const requiredSchemas = ['core', 'env'];
  const missing = requiredSchemas.filter((schema) => !schemas.includes(schema));
  if (missing.length > 0) {
    throw new Error(`Missing required PostGIS schemas: ${missing.join(', ')}`);
  }

  const spatialRefs = await pool.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM public.spatial_ref_sys',
  );
  const spatialRefCount = Number(spatialRefs.rows[0]?.count || 0);
  if (spatialRefCount < 100) {
    throw new Error(
      `Spatial reference table (spatial_ref_sys) is empty or incomplete (found only ${spatialRefCount} rows).`,
    );
  }

  return {
    ok: true,
    postgisVersion: postgisVersion.split(' ')[0],
    schemas,
    spatialRefCount,
  };
}
