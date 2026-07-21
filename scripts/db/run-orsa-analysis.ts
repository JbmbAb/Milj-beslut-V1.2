import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const propertyId = 'f0741e9e-7e6c-8249-e4b0-0f5d249fbcbb';
  console.log(`Performing Spatial Analysis for Property ID: ${propertyId}`);

  // 1. Get Centroid for Point-based analysis (SGU, etc.)
  const centroidRows = await prisma.$queryRaw<any[]>`
    SELECT 
      ST_X(ST_Centroid(ST_Transform(geom, 4326))) as lng,
      ST_Y(ST_Centroid(ST_Transform(geom, 4326))) as lat,
      ST_AsGeoJSON(ST_Transform(geom, 3006)) as geom_3006
    FROM env.registerenhetsomradesytor
    WHERE objektidentitet = ${propertyId}
    LIMIT 1;
  `;

  if (centroidRows.length === 0) {
    console.error('Property not found');
    return;
  }

  const { lat, lng, geom_3006 } = centroidRows[0];
  console.log(`Centroid: Lat ${lat}, Lng ${lng}`);

  // 2. Protected Area Analysis (Intersection)
  console.log('Checking Protected Areas...');
  const protectedHits = await prisma.$queryRaw<any[]>`
    SELECT nvr_id, name, protection_type
    FROM env.protected_area
    WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(${geom_3006}));
  `;
  console.log('Protected Area Hits:', protectedHits);

  // 3. Distance to Water (topo10.vatten)
  console.log('Checking Distance to Water...');
  const waterDist = await prisma.$queryRaw<any[]>`
    SELECT ST_Distance(t.geom, ST_GeomFromGeoJSON(${geom_3006})) as distance_m
    FROM topo10.vatten t
    ORDER BY distance_m ASC
    LIMIT 1;
  `;
  console.log('Distance to nearest water (m):', waterDist[0]?.distance_m ?? 'N/A');

  // 4. Land Cover (env.marktacke)
  console.log('Checking Land Cover...');
  const landCover = await prisma.$queryRaw<any[]>`
    SELECT objekttyp, ST_Area(ST_Intersection(m.geom, ST_GeomFromGeoJSON(${geom_3006}))) as area_sqm
    FROM env.marktacke m
    WHERE ST_Intersects(m.geom, ST_GeomFromGeoJSON(${geom_3006}))
    ORDER BY area_sqm DESC;
  `;
  console.log('Land Cover intersection:', landCover);

  // 5. Build Result
  console.log('\n--- ANALYSIS SUMMARY ---');
  console.log(`Property: ORSA STACKMORA 3:12`);
  console.log(`Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  
  if (protectedHits.length > 0) {
    console.log(`⚠️  Inom skyddad natur: ${protectedHits.map(h => h.name).join(', ')}`);
  } else {
    console.log(`✅ Utanför skyddad natur (baserat på aktuellt data)`);
  }

  if (landCover.length > 0) {
    console.log(`Marktäckning (dominanta typer):`);
    landCover.forEach(lc => console.log(`  - ${lc.objekttyp}: ${Math.round(lc.area_sqm)} m²`));
  } else {
    console.log(`ℹ️ Ingen marktäckningsdata hittades för detta område.`);
  }

  if (waterDist[0]) {
     console.log(`Närmaste vatten: ${Math.round(waterDist[0].distance_m)} meter.`);
  }
}

main().finally(() => prisma.$disconnect());
