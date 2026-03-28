import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Testing insert into stage.property_unit_raw...");
  try {
    // We need a MultiPolygon for geom
    await prisma.$executeRaw`
      INSERT INTO stage.property_unit_raw (
        source_key,
        designation,
        municipality_code,
        municipality_name,
        county_code,
        geom,
        raw_properties
      ) VALUES (
        'test-key-1',
        'TEST PROP 1:1',
        '0000',
        'TEST',
        '00',
        ST_Multi(ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 3006)),
        '{}'::jsonb
      ) ON CONFLICT (source_key) DO NOTHING;
    `;
    console.log("Success!");
  } catch (e: any) {
    console.error("Failed:", e.message);
  }
  await prisma.$disconnect();
}
main();
