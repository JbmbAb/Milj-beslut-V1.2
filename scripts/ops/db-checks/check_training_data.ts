import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Legal Reference Content Counts ---');
  
  try {
    const sourceCount = await prisma.legalSourceRecord.count();
    const corpusCount = await prisma.legalCorpusRecord.count();
    const judgmentCount = await prisma.judgmentRecord.count();
    
    console.log(`LegalSourceRecord: ${sourceCount}`);
    console.log(`LegalCorpusRecord: ${corpusCount}`);
    console.log(`JudgmentRecord: ${judgmentCount}`);

    console.log('\n--- Sample Legal Sources ---');
    const sources = await prisma.legalSourceRecord.findMany({
      take: 5,
      select: { title: true, sourceSystem: true, sourceType: true }
    });
    sources.forEach(s => console.log(`[${s.sourceSystem}] ${s.sourceType}: ${s.title}`));

    console.log('\n--- Specific Material Search (Lagtext/Praxis) ---');
    const trainingSamples = await prisma.legalCorpusRecord.findMany({
      where: {
        OR: [
          { title: { contains: 'Lagtext', mode: 'insensitive' } },
          { title: { contains: 'Praxis', mode: 'insensitive' } },
          { title: { contains: 'Lokaliseringsutredning', mode: 'insensitive' } },
          { tags: { array_contains: 'training' } }
        ]
      },
      take: 5,
      select: { title: true, sourceType: true }
    });
    trainingSamples.forEach(s => console.log(`[${s.sourceType}] ${s.title}`));

  } catch (e) {
    console.error('Error querying legal tables:', e);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
