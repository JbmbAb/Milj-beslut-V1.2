import { prisma } from '../server/db/prisma';
import { normalizeMunicipality } from './backfill/_shared';

async function main() {
    console.log('Recalculating municipality normalization for all documents...');

    const docs = await prisma.documentRecord.findMany({
        where: { municipality: { not: null } },
        select: { id: true, municipality: true, municipalityNormalized: true }
    });

    let updatedCount = 0;
    for (const doc of docs) {
        const normalized = normalizeMunicipality(doc.municipality);
        if (normalized !== doc.municipalityNormalized) {
            await prisma.documentRecord.update({
                where: { id: doc.id },
                data: { municipalityNormalized: normalized }
            });
            updatedCount++;
        }
    }

    console.log(`Updated normalization for ${updatedCount} documents.`);

    // Also sync to cases
    const caseUpdates = await prisma.$executeRawUnsafe(`
    UPDATE "RequirementCase"
    SET municipality = d.municipality,
        "authorityName" = d.municipality,
        "updatedAt" = NOW()
    FROM "DocumentRecord" d
    WHERE "RequirementCase"."documentId" = d.id
      AND d.municipality IS NOT NULL;
  `);

    console.log(`Synced ${caseUpdates} requirement cases.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
