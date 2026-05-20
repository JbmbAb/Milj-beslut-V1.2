import { prisma } from '../server/db/prisma';

const normalizeMuni = (m: string) => {
    return m.toLowerCase()
        .replace(/ kommun$/, '')
        .replace(/s kommun$/, '')
        .trim();
};

async function main() {
    console.log('Starting municipality backfill...');
    const docs = await prisma.documentRecord.findMany({
        where: {
            municipality: { not: null },
            OR: [
                { municipalityRaw: null },
                { municipalityNormalized: null }
            ]
        },
        select: { id: true, municipality: true }
    });

    console.log(`Found ${docs.length} documents to backfill.`);

    let count = 0;
    for (const doc of docs) {
        if (!doc.municipality) continue;

        await prisma.documentRecord.update({
            where: { id: doc.id },
            data: {
                municipalityRaw: doc.municipality,
                municipalityNormalized: normalizeMuni(doc.municipality)
            }
        });
        count++;
        if (count % 100 === 0) console.log(`Processed ${count}...`);
    }

    console.log(`Successfully backfilled ${count} documents.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
