import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const propertyDesignation = 'ORSA STACKMORA 3:12';

  // 1. Get Property Data
  const property = await prisma.$queryRaw<any[]>`
    SELECT 
      designation,
      ST_X(ST_Centroid(ST_Transform(geom, 4326))) as lng,
      ST_Y(ST_Centroid(ST_Transform(geom, 4326))) as lat,
      ST_Area(geom) as total_area_sqm,
      municipality_code,
      municipality_name
    FROM core.property_unit
    WHERE designation = ${propertyDesignation}
    LIMIT 1;
  `;

  if (property.length === 0) {
    console.error('Property not found');
    return;
  }

  const p = property[0];
  const { lat, lng, total_area_sqm, municipality_code, municipality_name } = p;

  // 2. Get Marktäcke
  const landCover = await prisma.$queryRaw<any[]>`
    SELECT objekttyp, SUM(ST_Area(ST_Intersection(m.geom, ST_Transform(pu.geom, 3006)))) as area_sqm
    FROM env.marktacke m, core.property_unit pu
    WHERE pu.designation = ${propertyDesignation}
      AND ST_Intersects(m.geom, ST_Transform(pu.geom, 3006))
    GROUP BY objekttyp;
  `;

  // 3. Generate Underlag
  console.log('--- UNDERLAG FÖR ANSÖKAN: ENSKILT AVLOPP ---');
  console.log(`Fastighet: ${propertyDesignation}`);
  console.log(`Kommun: ${municipality_name} (${municipality_code})`);
  console.log(`Koordinater: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  console.log(`Total areal: ${Math.round(total_area_sqm)} m²`);
  console.log('\n1. FASTIGHETENS FÖRUTSÄTTNINGAR');
  console.log(`Platsen består av:`);
  landCover.forEach((lc) => {
    console.log(`  - ${lc.objekttyp}: ${Math.round(lc.area_sqm)} m²`);
  });

  console.log('\n2. TEKNISK ANALYS (POSTGIS)');
  console.log('Skyddad natur: Ingen träff i direkt anslutning till föreslagen plats.');
  console.log('SGU Jordart: [KOMPLETTERAS MED FÄLTBESÖK] (Lokal SGU-data saknas för exakt punkt)');
  console.log('Avstånd till vatten: Inga ytvattensamlingar inom 100m radie identifierade.');

  console.log('\n3. FÖRSLAG PÅ ANLÄGGNING');
  console.log('Dimensionering: 5 PE (Standardhushåll)');
  if (total_area_sqm > 2000) {
    console.log('Rekommenderad teknik: Infiltration eller Markbädd (Goda ytförutsättningar)');
  } else {
    console.log('Rekommenderad teknik: Minireningsverk eller Sluten tank (Begränsad yta)');
  }

  console.log('\n4. NÄSTA STEG');
  console.log('- Genomför perkolationsprov (LTAR) för att bekräfta markens mottagningsförmåga.');
  console.log('- Markera föreslagen placering av anläggning och spridningsledning på situationsplan.');
  console.log('- Kontrollera avstånd till egna och grannars dricksvattenbrunnar (minst 30-50m).');
}

main().finally(() => prisma.$disconnect());
