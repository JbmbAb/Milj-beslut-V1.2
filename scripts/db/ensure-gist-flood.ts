/**
 * Idempotent: säkerställer GIST-index på climate.flood_risk_area._ogr_geometry_
 * och env.water_protection_area.geom (om de saknas). Kör efter ogr2ogr-importer.
 */
import { Client } from 'pg';

async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const stmts = [
    `CREATE INDEX IF NOT EXISTS climate_flood_risk_area_geom_gist
       ON climate.flood_risk_area USING GIST (_ogr_geometry_)`,
    `CREATE INDEX IF NOT EXISTS env_water_protection_area_geom_gist
       ON env.water_protection_area USING GIST (geom)`,
    `ANALYZE climate.flood_risk_area`,
    `ANALYZE env.water_protection_area`,
  ];
  for (const sql of stmts) {
    try {
      const start = Date.now();
      await c.query(sql);
      console.log(`OK   (${Date.now() - start}ms) ${sql.split('\n')[0]}`);
    } catch (e) {
      console.log(`FAIL ${sql.split('\n')[0]} -> ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await c.end();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
