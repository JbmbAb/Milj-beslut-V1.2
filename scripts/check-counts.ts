import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const judgments = await prisma.judgmentRecord.count();
    const corpus = await prisma.legalCorpusRecord.count();
    console.log(`JUDGMENTS:${judgments}`);
    console.log(`CORPUS:${corpus}`);
    
    // Hämta ett exempel på en dom som har både text och källa
    // Använd en enklare query som vi vet fungerar
    const example = await prisma.legalCorpusRecord.findFirst({
      where: {
        documentText: { not: '' }
      },
      select: {
        id: true,
        title: true,
        sourceUrl: true,
        sourcePath: true
      }
    });
    
    if (example) {
      console.log('EXAMPLE_ID:' + example.id);
      console.log('EXAMPLE_TITLE:' + example.title);
      console.log('EXAMPLE_URL:' + (example.sourceUrl || 'N/A'));
      console.log('EXAMPLE_PATH:' + (example.sourcePath || 'N/A'));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
