import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Ensuring spatial tables...');
    
    await prisma.$executeRawUnsafe("CREATE SCHEMA IF NOT EXISTS env;");
    await prisma.$executeRawUnsafe("CREATE SEQUENCE IF NOT EXISTS env.sgu_ground_layer_id_seq;");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS env.sgu_ground_layer (
        id int8 NOT NULL DEFAULT nextval('env.sgu_ground_layer_id_seq'),
        source_key text NOT NULL,
        source_object_id int8,
        layer_code int4,
        layer_label text,
        mapping_name text,
        map_type int4,
        symbol int4,
        area_sqm float8,
        length_m float8,
        source_dataset text NOT NULL DEFAULT 'SGU jordarter 1 miljon'::text,
        raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
        imported_at timestamptz NOT NULL DEFAULT now(),
        geom geometry
      );
    `);
    await prisma.$executeRawUnsafe("CREATE UNIQUE INDEX IF NOT EXISTS sgu_ground_layer_source_key_key ON env.sgu_ground_layer (source_key);");
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS sgu_ground_layer_geom_gix ON env.sgu_ground_layer USING gist (geom);");
    
    console.log('Success!');
  } catch (e) {
    console.error('SQL Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
