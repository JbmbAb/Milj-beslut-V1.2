import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("--- DATABAS ÖVERSIKT ---");
  
  // 1. Projekt
  const projectCount = await prisma.project.count();
  const recentProjects = await prisma.project.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { id: true, propertyDesignation: true, status: true, createdAt: true }
  });
  
  console.log(`\nProjekt Totalt: ${projectCount}`);
  console.log("Senaste 5 projekten:");
  recentProjects.forEach(p => console.log(` - [${p.createdAt.toISOString()}] ${p.propertyDesignation} (${p.status})`));

  // 2. Dokument
  const docCount = await prisma.documentRecord.count();
  const docByStatus = await prisma.documentRecord.groupBy({
    by: ['metadataReviewStatus'],
    _count: true
  });
  
  console.log(`\nDokument Totalt: ${docCount}`);
  console.log("Dokument per status:");
  docByStatus.forEach(s => console.log(` - ${s.metadataReviewStatus || 'NULL'}: ${s._count}`));

  // 3. Fastighetsenheter (Core & Stage)
  try {
    const coreCount = await prisma.$queryRaw<any[]>`SELECT count(*) FROM core.property_unit`;
    console.log(`\nFastighetsenheter (Core): ${coreCount[0].count}`);
  } catch (e) {
    console.log("\nFastighetsenheter (Core): Tabell saknas eller kunde inte läsas.");
  }

  try {
    const stageCount = await prisma.$queryRaw<any[]>`SELECT count(*) FROM stage.property_unit_raw`;
    console.log(`Fastighetsenheter (Staging): ${stageCount[0].count}`);
  } catch (e) {
    console.log("Fastighetsenheter (Staging): Tabell saknas eller kunde inte läsas.");
  }

  // 4. Specifik koll på ORSA STACKMORA
  try {
    const orsaCore = await prisma.$queryRaw<any[]>`SELECT count(*) FROM core.property_unit WHERE designation ILIKE '%ORSA STACKMORA%';`;
    console.log(`\nSökning 'ORSA STACKMORA' i Core: ${orsaCore[0].count} träffar`);
  } catch (_e) {
    // no matching properties — intentionally silent
  }

  await prisma.$disconnect();
}

main().catch(console.error);
