import { prisma } from '../server/db/prisma';

async function main() {
    const total = await prisma.documentRecord.count();
    const nullMuni = await prisma.documentRecord.count({ where: { municipality: null } });
    const embedded = await prisma.documentRecord.count({ where: { status: 'EMBEDDED' } });
    const openQueue = await prisma.metadataReviewQueue.count({ where: { status: 'OPEN' } });
    const totalReqs = await prisma.requirementRecord.count();

    const munis = await prisma.documentRecord.groupBy({
        by: ['municipalityNormalized'],
        _count: { id: true },
        where: { municipalityNormalized: { not: null } }
    });

    const rawMunis = await prisma.documentRecord.groupBy({
        by: ['municipality'],
        _count: { id: true },
        where: { municipality: { not: null } }
    });

    console.log('--- FINAL SYSTEM AUDIT ---');
    console.log(`Total DocumentRecords:      ${total}`);
    console.log(`Embedded (Vector DB):       ${embedded}`);
    console.log(`Missing Municipality:       ${nullMuni}`);
    console.log(`Open Review Queue Items:    ${openQueue}`);
    console.log(`Total Extractions:          ${totalReqs}`);
    console.log(`Unique Normalized Munis:    ${munis.length}`);
    console.log(`Unique Raw Munis (In DB):   ${rawMunis.length}`);

    if (nullMuni > 0) {
        console.log(`\nADVISORY: There are still ${nullMuni} documents without a municipality assigned.`);
        console.log('Recommendation: Run scripts/backfill/extract-metadata-pass3-llm.ts to fill these in.');
    } else {
        console.log('\nRESULT: All documents have been assigned a municipality.');
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
