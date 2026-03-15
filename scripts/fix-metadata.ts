import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.documentRecord.updateMany({
    where: { 
      projectId: 'cmmpmyhc90004cuyg57iuzcmo',
      municipality: null
    },
    data: {
      municipality: 'Orsa',
      municipalityRaw: 'Orsa',
      municipalityNormalized: 'orsa',
      decisionType: 'Miljöprövning' // Best guess for now
    }
  });

  console.log(`Updated ${result.count} documents with Orsa / Miljöprövning`);
  await prisma.$disconnect();
}

main();
