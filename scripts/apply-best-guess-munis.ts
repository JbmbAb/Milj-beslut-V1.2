import { prisma } from '../server/db/prisma';
import { normalizeMunicipality } from './backfill/_shared';

async function main() {
    console.log('Applying best-guess municipalities from evidence...');

    const docsMissingMuni = await prisma.documentRecord.findMany({
        where: {
            municipality: null,
            requirements: { some: {} }
        },
        select: { id: true }
    });

    const docIds = docsMissingMuni.map(d => d.id);

    // Find best evidence for each
    const allEvidence = await prisma.documentMetadataEvidence.findMany({
        where: {
            documentId: { in: docIds },
            fieldName: 'municipality',
            confidence: { gte: 0.5 }
        },
        orderBy: [
            { documentId: 'asc' },
            { confidence: 'desc' }
        ]
    });

    // Group by documentId, taking the highest confidence one
    const bestEvidence = new Map<string, any>();
    for (const e of allEvidence) {
        if (!bestEvidence.has(e.documentId)) {
            bestEvidence.set(e.documentId, e);
        }
    }

    console.log(`Found best guesses for ${bestEvidence.size} documents.`);

    let updatedCount = 0;
    for (const [docId, evidence] of bestEvidence.entries()) {
        const muniValue = evidence.fieldValue;
        if (!muniValue) continue;

        const normalized = normalizeMunicipality(muniValue);

        await prisma.documentRecord.update({
            where: { id: docId },
            data: {
                municipality: muniValue,
                municipalityRaw: muniValue,
                municipalityNormalized: normalized,
                municipalityConfidence: evidence.confidence,
                municipalitySource: 'best_guess_evidence'
            }
        });
        updatedCount++;
    }

    console.log(`Applied ${updatedCount} municipalities to DocumentRecord.`);

    // Now sync to RequirementCase
    const syncCount = await prisma.$executeRawUnsafe(`
    UPDATE "RequirementCase"
    SET municipality = d.municipality,
        "authorityName" = d.municipality,
        "updatedAt" = NOW()
    FROM "DocumentRecord" d
    WHERE "RequirementCase"."documentId" = d.id
      AND ("RequirementCase".municipality IS NULL OR "RequirementCase".municipality = '')
      AND d.municipality IS NOT NULL;
  `);

    console.log(`Synced ${syncCount} requirement cases.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
