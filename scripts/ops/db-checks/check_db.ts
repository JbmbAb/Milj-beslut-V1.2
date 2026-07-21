import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = [
    { name: 'CNotificationChemical', count: () => prisma.cNotificationChemical.count() },
    { name: 'PermitApplicationDraft', count: () => prisma.permitApplicationDraft.count() },
    { name: 'DocumentRecord', count: () => prisma.documentRecord.count() },
    { name: 'RequirementRecord', count: () => prisma.requirementRecord.count() },
    { name: 'RequirementCase', count: () => prisma.requirementCase.count() },
    { name: 'decision_cases', count: () => prisma.decision_cases.count() },
  ];

  console.log('--- Database Record Counts ---');
  for (const table of tables) {
    try {
      const count = await table.count();
      console.log(`${table.name}: ${count}`);
    } catch {
      console.log(`${table.name}: (error or not found)`);
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
