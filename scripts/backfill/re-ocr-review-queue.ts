/**
 * Fas 5 – Högkvalitativ Re-OCR för Review Queue
 * Kör om textextraktion med forceOcr: true (Gemini 1.5 Pro) för alla 'OPEN' ärenden.
 *
 * Kör: npx tsx scripts/backfill/re-ocr-review-queue.ts [--limit=50] [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { extractDocumentTextAndChunk } from '../../server/services/searchService';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
    const entry = process.argv.find((v) => v.startsWith(`--${name}=`));
    return entry ? entry.slice(name.length + 3).trim() : undefined;
}
function flag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

async function main() {
    const limit = Number(arg('limit') || 50);
    const dryRun = flag('dry-run');

    // Hämta öppna ärenden från granskningskön
    const reviewItems = await prisma.metadataReviewQueue.findMany({
        where: { status: 'OPEN' },
        select: { id: true, documentId: true },
        take: limit,
        orderBy: { createdAt: 'desc' },
    });

    console.error(`Found ${reviewItems.length} open review items to re-OCR (limit ${limit}, dryRun ${dryRun})`);

    let processed = 0;
    let errors = 0;

    for (const item of reviewItems) {
        const doc = await prisma.documentRecord.findUnique({
            where: { id: item.documentId },
            select: { id: true, originalName: true }
        });

        if (!doc) {
            console.error(`SKIP: Document ${item.documentId} not found for review item ${item.id}`);
            continue;
        }

        try {
            if (!dryRun) {
                console.error(`FORCING HIGH-QUALITY OCR: ${doc.originalName} (${doc.id})`);
                const result = await extractDocumentTextAndChunk(doc.id, true); // forceOcr = true

                // Efter lyckad OCR, nollställ metadataReviewStatus så att nästa LLM-pass kan försöka igen med bättre text
                await prisma.documentRecord.update({
                    where: { id: doc.id },
                    data: {
                        status: 'TEXT_EXTRACTED', // Återställer status för att trigga om-indexering/extraktion
                        metadataReviewStatus: 'AUTO'
                    }
                });

                console.error(`OK: ${doc.id} → ${result.chunks} chunks via Gemini 1.5 Pro`);
            } else {
                console.error(`DRY-RUN: would re-OCR ${doc.originalName}`);
            }
            processed++;
        } catch (e) {
            console.error(`ERROR: ${doc.id}:`, e instanceof Error ? e.message : String(e));
            errors++;
        }
    }

    console.log(JSON.stringify({ processed, errors, limit, dryRun }, null, 2));
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
