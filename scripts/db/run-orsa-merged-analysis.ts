import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const propertyDesignation = 'ORSA STACKMORA 3:12';
  console.log(`Performing Merged Spatial Analysis for: ${propertyDesignation}`);

  // 1. Get Merged Geometry and Centroid
  const rows = await prisma.$queryRaw<any[]>`
    SELECT 
      source_key,
      ST_X(ST_Centroid(ST_Transform(geom, 4326))) as lng,
      ST_Y(ST_Centroid(ST_Transform(geom, 4326))) as lat,
      ST_Area(geom) as total_area_sqm,
      ST_AsGeoJSON(ST_Transform(geom, 3006)) as geom_3006
    FROM core.property_unit
    WHERE designation = ${propertyDesignation}
    LIMIT 1;
  `;

  if (rows.length === 0) {
    console.error('Property not found');
    return;
  }

  const { source_key, lat, lng, total_area_sqm, geom_3006 } = rows[0];
  console.log(`Centroid: Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`);
  console.log(`Total Area: ${Math.round(total_area_sqm)} m²`);

  // 2. Protected Area Analysis
  const protectedHits = await prisma.$queryRaw<any[]>`
    SELECT nvr_id, name, protection_type
    FROM env.protected_area
    WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(${geom_3006}));
  `;

  // 3. Distance to Water
  const waterDist = await prisma.$queryRaw<any[]>`
    SELECT ST_Distance(t.geom, ST_GeomFromGeoJSON(${geom_3006})) as distance_m
    FROM topo10.vatten t
    ORDER BY distance_m ASC
    LIMIT 1;
  `;

  // 4. Land Cover
  const landCover = await prisma.$queryRaw<any[]>`
    SELECT objekttyp, SUM(ST_Area(ST_Intersection(m.geom, ST_GeomFromGeoJSON(${geom_3006})))) as area_sqm
    FROM env.marktacke m
    WHERE ST_Intersects(m.geom, ST_GeomFromGeoJSON(${geom_3006}))
    GROUP BY objekttyp
    ORDER BY area_sqm DESC;
  `;

  console.log('\n--- MERGED ANALYSIS SUMMARY ---');
  console.log(`Property: ${propertyDesignation}`);
  console.log(`Total Area: ${Math.round(total_area_sqm)} m² (~${(total_area_sqm / 10000).toFixed(2)} ha)`);

  if (protectedHits.length > 0) {
    console.log(`⚠️  Inom skyddad natur: ${protectedHits.map((h) => h.name).join(', ')}`);
  } else {
    console.log(`✅ Utanför skyddad natur`);
  }

  console.log(`Marktäckning (fördelning):`);
  landCover.forEach((lc) => {
    const pct = ((lc.area_sqm / total_area_sqm) * 100).toFixed(1);
    console.log(`  - ${lc.objekttyp}: ${Math.round(lc.area_sqm)} m² (${pct}%)`);
  });

  if (waterDist[0]) {
    console.log(`Avstånd till närmaste vatten: ${Math.round(waterDist[0].distance_m)} meter.`);
  } else {
    console.log(`ℹ️ Inga vattenförekomster hittades inom sökradien.`);
  }
}

main().finally(() => prisma.$disconnect());
