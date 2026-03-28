import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- PROPAGATING MUNICIPALITIES TO REQUIREMENT CASES ---');
  
  const docs = await prisma.documentRecord.findMany({
    where: { NOT: { municipality: null } },
    select: { id: true, municipality: true }
  });

  console.log(`Checking ${docs.length} documents...`);

  let updated = 0;
  for (const doc of docs) {
    // Update RequirementCase for this docId
    const result = await prisma.requirementCase.updateMany({
      where: { 
        documentId: doc.id,
        municipality: null // Only update if missing
      },
      data: {
        municipality: doc.municipality
      }
    });

    if (result.count > 0) {
      updated++;
      if (updated % 100 === 0) console.log(`  Updated ${updated} cases...`);
    }
  }

  console.log(`Successfully updated ${updated} RequirementCase records.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
