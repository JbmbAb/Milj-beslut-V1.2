import { describe, expect, it, beforeAll } from 'vitest';
import { prisma } from '../../server/db/prisma';
import * as fs from 'fs';
import * as path from 'path';

describe('Spatial Regression Tests (30-50 Reference Properties)', () => {
  beforeAll(async () => {
    // Read the spatial regression fixtures
    const fixturesPath = path.join(__dirname, '../fixtures/spatial-regression-fixtures.json');
    const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

    console.log(`Seeding ${fixtures.length} spatial regression fixtures into test database...`);

    // Clean any existing records first to ensure test isolation
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE core.property_unit CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE topo10.vatten CASCADE;`);

    // Alter topo10.vatten to generic geometry type so it accepts both LineStrings and Polygons from the fixtures
    await prisma.$executeRawUnsafe(`ALTER TABLE topo10.vatten ALTER COLUMN geom TYPE geometry(Geometry, 3006);`);

    // Insert each fixture into core.property_unit and topo10.vatten
    for (const [index, fixture] of fixtures.entries()) {
      if (fixture.property_wkt) {
        // Since id is SERIAL PRIMARY KEY, we let Postgres generate it and insert the fields
        await prisma.$executeRawUnsafe(
          `INSERT INTO core.property_unit (designation, geom)
           VALUES ($1, ST_Multi(ST_GeomFromText($2, 3006)));`,
          fixture.designation,
          fixture.property_wkt
        );
      }
      if (fixture.water_wkt) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO topo10.vatten (objektidentitet, geom)
           VALUES ($1, ST_GeomFromText($2, 3006));`,
          `water-ref-${index}`,
          fixture.water_wkt
        );
      }
    }
    console.log('Successfully seeded geodata fixtures.');
  });

  it('calculates water distance with a tolerance of ±0.5 meters against the verified baseline', async () => {
    const fixturesPath = path.join(__dirname, '../fixtures/spatial-regression-fixtures.json');
    const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

    console.log(`Running regression check on ${fixtures.length} reference properties...`);
    
    for (const ref of fixtures) {
      // Query PostGIS directly to calculate minimum distance to nearest water body (topo10.vatten)
      const result = await prisma.$queryRawUnsafe<any[]>(
        `SELECT ST_Distance(pu.geom, w.geom) as dist
         FROM core.property_unit pu, topo10.vatten w
         WHERE pu.designation = $1
           AND pu.geom IS NOT NULL 
           AND w.geom IS NOT NULL
         ORDER BY pu.geom <-> w.geom
         LIMIT 1;`,
        ref.designation
      );

      expect(result.length).toBeGreaterThan(0);
      const actualDistance = Number(result[0].dist);
      const difference = Math.abs(actualDistance - ref.expected_distance);

      console.log(
        `Property: ${ref.designation.padEnd(40)} | Expected: ${ref.expected_distance.toFixed(2)}m | Actual: ${actualDistance.toFixed(2)}m | Diff: ${difference.toFixed(2)}m`
      );

      expect(difference).toBeLessThanOrEqual(0.5);
    }
  });
});
