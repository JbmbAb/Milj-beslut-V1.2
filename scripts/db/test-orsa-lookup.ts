import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const propertyDesignation = 'ORSA STACKMORA 3:12';
  console.log(`Searching for: ${propertyDesignation}`);
  
  const exactRows = await prisma.$queryRaw<any[]>`
    WITH q AS (
      SELECT core.normalize_designation(${propertyDesignation}) AS designation_norm
    )
    SELECT
      source_key,
      designation,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS geometry_geojson
    FROM core.property_unit pu, q
    WHERE pu.designation_norm = q.designation_norm
    LIMIT 1;
  `;

  if (exactRows.length > 0) {
    console.log('EXACT MATCH FOUND:');
    console.log(JSON.stringify(exactRows[0], null, 2));
  } else {
    console.log('No exact match. Trying fuzzy lookup...');
    const fuzzyRows = await prisma.$queryRaw<any[]>`
      WITH q AS (
        SELECT core.normalize_designation(${propertyDesignation}) AS designation_norm
      )
      SELECT
        source_key,
        designation,
        similarity(pu.designation_norm, q.designation_norm) as sim
      FROM core.property_unit pu, q
      WHERE pu.designation_norm % q.designation_norm
      ORDER BY sim DESC
      LIMIT 5;
    `;
    console.log('Fuzzy results:', JSON.stringify(fuzzyRows, null, 2));
  }
}

main().finally(() => prisma.$disconnect());
