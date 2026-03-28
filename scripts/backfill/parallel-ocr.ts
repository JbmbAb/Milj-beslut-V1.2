import { prisma } from '../../server/db/prisma';
import { extractDocumentTextAndChunk } from '../../server/services/searchService';

async function main() {
    const limit = 2000;
    const concurrency = 5;

    const docs = await prisma.documentRecord.findMany({
        where: {
            OR: [
                { status: 'METADATA_ONLY' },
                { status: 'FAILED' }
            ]
        },
        select: { id: true, originalName: true },
        take: limit
    });

    console.log(`Found ${docs.length} documents needing OCR/extraction. Using concurrency: ${concurrency}`);

    let success = 0;
    let fail = 0;
    let completed = 0;

    const runBatch = async (batch: typeof docs) => {
        await Promise.all(batch.map(async (doc) => {
            try {
                console.log(`Processing [${doc.id}] ${doc.originalName}...`);
                await extractDocumentTextAndChunk(doc.id, false); 
                success++;
            } catch (e) {
                console.error(`FAILED [${doc.id}] ${doc.originalName}:`, e);
                fail++;
            } finally {
                completed++;
                if (completed % 1 === 0) console.log(`  Progress: ${completed}/${docs.length} (${success} OK, ${fail} FAIL)`);
            }
        }));
    };

    for (let i = 0; i < docs.length; i += concurrency) {
        const batch = docs.slice(i, i + concurrency);
        await runBatch(batch);
    }

    console.log(`Parallel OCR Batch Complete: ${success} success, ${fail} failed.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
