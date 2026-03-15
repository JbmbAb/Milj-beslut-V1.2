import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT designation, ST_AsText(ST_Centroid(geom)) as center 
    FROM core.property_unit 
    WHERE designation LIKE 'ORSA STACKMORA 3:12%'
  `);
  console.log(rows);
}
main().finally(() => prisma.$disconnect());
