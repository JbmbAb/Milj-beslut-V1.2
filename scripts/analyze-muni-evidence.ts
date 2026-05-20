import { prisma } from '../server/db/prisma';

async function main() {
    const docsMissingMuni = await prisma.documentRecord.findMany({
        where: {
            municipality: null,
            requirements: { some: {} }
        },
        select: { id: true }
    });

    const docIds = docsMissingMuni.map(d => d.id);

    const evidence = await prisma.documentMetadataEvidence.findMany({
        where: {
            documentId: { in: docIds },
            fieldName: 'municipality'
        },
        orderBy: { confidence: 'desc' }
    });

    console.log(`Docs missing muni (with reqs): ${docIds.length}`);
    console.log(`Docs with at least one muni evidence: ${new Set(evidence.map(e => e.documentId)).size}`);

    const over05 = evidence.filter(e => e.confidence >= 0.5);
    console.log(`Docs with muni evidence >= 0.5: ${new Set(over05.map(e => e.documentId)).size}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
