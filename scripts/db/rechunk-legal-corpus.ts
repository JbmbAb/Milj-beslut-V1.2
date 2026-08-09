/**
 * scripts/db/rechunk-legal-corpus.ts
 *
 * Idempotent backfill-skript för LegalCorpusChunk.
 *
 * Kör: npx tsx scripts/db/rechunk-legal-corpus.ts
 *
 * Beteende:
 *   - Hoppar över poster som redan har chunks med CURRENT_VERSION.
 *   - Raderar gamla chunks (alla versioner) och skapar nya i transaktion.
 *   - Beräknar embeddings via befintlig embedText() i searchService.ts.
 *   - Kan köras upprepade gånger utan att skapa dubbletter.
 *
 * Flaggor:
 *   --dry-run    Visa antal poster som skulle bearbetas, utan att skriva.
 *   --limit N    Begränsa till N poster (för test).
 *   --record-id  Bearbeta ett specifikt LegalCorpusRecord-id.
 */

import { loadEnvFile } from '../../server/loadEnv';
loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: true });

import { prisma } from '../../server/db/prisma';
import { embedText } from '../../server/services/searchService';
import { routeToCorrectChunker } from '@miljobeslut/mps-chunking';

const CURRENT_VERSION = 'v2.3';

// ─── CLI-flaggor ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
const recordIdArg = args.find((a) => a.startsWith('--record-id='));
const targetRecordId = recordIdArg ? recordIdArg.split('=')[1] : undefined;

// ─── Hjälpfunktioner ─────────────────────────────────────────────────────

async function getRecordsToProcess() {
  const where = {
    ...(targetRecordId ? { id: targetRecordId } : {}),
    documentText: { not: null },
    // Hoppa över poster som redan har aktuell version (om inte --force är satt)
    ...(isForce
      ? {}
      : {
          NOT: {
            chunks: {
              some: { chunkVersion: CURRENT_VERSION },
            },
          },
        }),
  } as Parameters<typeof prisma.legalCorpusRecord.findMany>[0]['where'];

  return prisma.legalCorpusRecord.findMany({
    where,
    select: {
      id: true,
      title: true,
      sourceSystem: true,
      sourceType: true,
      documentText: true,
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });
}

async function processRecord(record: {
  id: string;
  title: string;
  sourceSystem: string;
  sourceType: string;
  documentText: string | null;
}): Promise<{ chunked: number; embedded: number }> {
  const text = record.documentText;
  if (!text) return { chunked: 0, embedded: 0 };

  const chunks = routeToCorrectChunker(text, record.title, record.sourceSystem);
  if (chunks.length === 0) return { chunked: 0, embedded: 0 };

  // Idempotent: radera gamla chunks och skapa nya i en transaktion
  await prisma.$transaction([
    prisma.legalCorpusChunk.deleteMany({ where: { recordId: record.id } }),
    ...chunks.map((chunk, idx) =>
      prisma.legalCorpusChunk.create({
        data: {
          recordId: record.id,
          chunkIndex: idx,
          chunkText: chunk.chunkText,
          chunkVersion: CURRENT_VERSION,
          documentType: record.sourceType ?? 'other',
          lawName: record.title,
          chapter: chunk.chapter ?? null,
          paragraph: chunk.paragraph ?? null,
          section: chunk.section ?? null,
        },
      }),
    ),
  ]);

  // Beräkna och spara embeddings (efter transaktion, per chunk)
  let embedded = 0;
  /* SKIPPED FOR NOW: Embeddings generation is disabled for the verification phase
  const createdChunks = await prisma.legalCorpusChunk.findMany({
    where: { recordId: record.id, chunkVersion: CURRENT_VERSION },
    select: { id: true, chunkText: true },
    orderBy: { chunkIndex: 'asc' },
  });

  for (const c of createdChunks) {
    const embedding = await embedText(c.chunkText);
    if (embedding && embedding.values.length > 0) {
      const vectorLiteral = `[${embedding.values.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "legal_corpus_chunks" SET embedding_vector = $1::vector WHERE id = $2`,
        vectorLiteral,
        c.id,
      );
      embedded++;
    }
  }
  */

  return { chunked: chunks.length, embedded };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔄 rechunk-legal-corpus [version ${CURRENT_VERSION}]`);
  console.log(`   Läge: ${isDryRun ? 'DRY RUN (ingen skrivning)' : 'LIVE'}`);
  console.log(`   Force-reprocess: ${isForce ? 'JA' : 'NEJ'}`);
  if (limit) console.log(`   Limit: ${limit} poster`);
  if (targetRecordId) console.log(`   Record: ${targetRecordId}`);

  const records = await getRecordsToProcess();
  console.log(`\n   Hittade ${records.length} poster att bearbeta.\n`);

  if (isDryRun || records.length === 0) {
    console.log('✅ Klar (dry-run eller ingenting att göra).');
    await prisma.$disconnect();
    return;
  }

  let totalChunked = 0;
  let totalEmbedded = 0;
  let totalFailed = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const progress = `[${i + 1}/${records.length}]`;

    try {
      const { chunked, embedded } = await processRecord(record as any);
      totalChunked += chunked;
      totalEmbedded += embedded;
      console.log(`${progress} ✅ "${record.title}" → ${chunked} chunks, ${embedded} embeddings`);
    } catch (err: any) {
      totalFailed++;
      console.error(`${progress} ❌ "${record.title}" → FEL: ${err.message}`);
    }
  }

  console.log(`
📊 Resultat:
   Poster bearbetade : ${records.length - totalFailed} / ${records.length}
   Chunks skapade   : ${totalChunked}
   Embeddings sparade: ${totalEmbedded}
   Fel               : ${totalFailed}
`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
