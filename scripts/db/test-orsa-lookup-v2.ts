import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const propertyDesignation = 'ORSA STACKMORA 3:12';
  console.log(`Searching for: ${propertyDesignation}`);

  const norm = await prisma.$queryRaw<any[]>`SELECT core.normalize_designation(${propertyDesignation}) as n`;
  const designationNorm = norm[0].n;
  console.log(`Normalized search term: ${designationNorm}`);

  const exactRows = await prisma.$queryRaw<any[]>`
    SELECT
      source_key,
      designation,
      designation_norm,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS geometry_geojson
    FROM core.property_unit
    WHERE designation_norm = ${designationNorm}
    LIMIT 1;
  `;

  if (exactRows.length > 0) {
    console.log('EXACT MATCH FOUND:');
    console.log(JSON.stringify(exactRows[0], null, 2));
  } else {
    console.log('No exact match. Trying prefix lookup...');
    const prefixRows = await prisma.$queryRaw<any[]>`
      SELECT
        source_key,
        designation,
        designation_norm
      FROM core.property_unit
      WHERE designation_norm LIKE ${designationNorm + '%'}
      LIMIT 10;
    `;
    console.log('Prefix results:', JSON.stringify(prefixRows, null, 2));

    if (prefixRows.length === 0) {
      console.log('No prefix match. Trying fuzzy lookup...');
      const fuzzyRows = await prisma.$queryRaw<any[]>`
          SELECT
            source_key,
            designation,
            similarity(designation_norm, ${designationNorm}) as sim
          FROM core.property_unit
          WHERE designation_norm % ${designationNorm}
          ORDER BY sim DESC
          LIMIT 5;
        `;
      console.log('Fuzzy results:', JSON.stringify(fuzzyRows, null, 2));
    }
  }
}

main().finally(() => prisma.$disconnect());
