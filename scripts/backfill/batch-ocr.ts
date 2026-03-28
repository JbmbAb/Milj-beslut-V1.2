import { prisma } from '../../server/db/prisma';
import { extractDocumentTextAndChunk } from '../../server/services/searchService';

async function main() {
    const limit = 1000; // Process all remaining in one batch
    const docs = await prisma.documentRecord.findMany({
        where: {
            OR: [
                { status: 'METADATA_ONLY' },
                { content: { is: null } }
            ]
        },
        select: { id: true, originalName: true },
        take: limit
    });

    console.log(`Found ${docs.length} documents needing OCR/extraction.`);

    let success = 0;
    let fail = 0;

    for (const doc of docs) {
        try {
            console.log(`Processing [${doc.id}] ${doc.originalName}...`);
            await extractDocumentTextAndChunk(doc.id, false); // false = try regular PDF parse first, then OCR
            success++;
        } catch (e) {
            console.error(`FAILED [${doc.id}]:`, e);
            fail++;
        }
    }

    console.log(`OCR Batch Complete: ${success} success, ${fail} failed.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
