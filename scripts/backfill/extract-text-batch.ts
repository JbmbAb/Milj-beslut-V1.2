/**
 * Steg 5 – Textextraktion för METADATA_ONLY-dokument
 * Använder befintlig extractDocumentTextAndChunk från searchService.
 * Kör: npx tsx scripts/backfill/extract-text-batch.ts [--limit=25] [--dry-run]
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
    const limit = Number(arg('limit') || 25);
    const dryRun = flag('dry-run');

    const docs = await prisma.documentRecord.findMany({
        where: { status: 'METADATA_ONLY' },
        select: { id: true, absolutePath: true, originalName: true },
        take: limit,
        orderBy: { createdAt: 'asc' },
    });

    console.error(`Found ${docs.length} METADATA_ONLY docs to process (limit ${limit}, dryRun ${dryRun})`);

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of docs) {
        // Skip if no file on disk
        if (!doc.absolutePath) {
            console.error(`SKIP (no path): ${doc.id}`);
            skipped++;
            continue;
        }

        try {
            if (!dryRun) {
                const result = await extractDocumentTextAndChunk(doc.id);
                console.error(`OK: ${doc.id} → ${result.chunks} chunks`);
            } else {
                console.error(`DRY-RUN: would extract ${doc.originalName}`);
            }
            processed++;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // File not found is expected for email-only records
            if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('hittades inte')) {
                console.error(`SKIP (no file): ${doc.id} - ${msg.slice(0, 80)}`);
                skipped++;
                // Mark as FAILED so we don't retry
                if (!dryRun) {
                    await prisma.$executeRawUnsafe(
                        `UPDATE "DocumentRecord" SET status = 'FAILED', "updatedAt" = NOW() WHERE id = $1`,
                        doc.id,
                    );
                }
            } else {
                console.error(`ERROR: ${doc.id}:`, msg.slice(0, 120));
                errors++;
            }
        }
    }

    console.log(JSON.stringify({ processed, skipped, errors, limit, dryRun }, null, 2));
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
