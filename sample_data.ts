import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Sample C-anmälan/Avlopp Requirements ---');
  
  const samples = await prisma.requirementRecord.findMany({
    where: {
      OR: [
        { requirementTextQuote: { contains: 'C-anmälan', mode: 'insensitive' } },
        { interpretedRequirement: { contains: 'C-anmälan', mode: 'insensitive' } },
        { requirementTextQuote: { contains: 'enskilt avlopp', mode: 'insensitive' } },
        { interpretedRequirement: { contains: 'enskilt avlopp', mode: 'insensitive' } }
      ]
    },
    take: 5,
    select: {
      requirementCode: true,
      category: true,
      interpretedRequirement: true,
      municipalitySpecific: true
    }
  });

  if (samples.length === 0) {
    console.log('No specific mentions found in first few records.');
  } else {
    samples.forEach(s => {
      console.log(`[${s.requirementCode}] ${s.category}: ${s.interpretedRequirement.substring(0, 100)}...`);
    });
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
