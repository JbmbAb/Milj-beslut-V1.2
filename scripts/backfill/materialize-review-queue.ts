import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const fields = ['municipality', 'legalStatus', 'decisionType', 'wasteType', 'activityCode'];

    for (const fieldName of fields) {
        const queue = await prisma.metadataReviewQueue.findMany({
            where: { status: 'OPEN', fieldName },
            select: { id: true, documentId: true, proposedValue: true, confidence: true }
        });

        console.log(`Fält [${fieldName}]: Hittade ${queue.length} möjliga uppdateringar.`);

        let updated = 0;
        for (const item of queue) {
            if (!item.proposedValue) continue;

            const docField = fieldName === 'municipality' ? 'municipalityNormalized' : fieldName;
            const confField = fieldName === 'municipality' ? 'municipalityConfidence' : (fieldName === 'legalStatus' ? 'diarieConfidence' : null);

            const doc = await prisma.documentRecord.findUnique({
                where: { id: item.documentId },
                select: { [docField]: true } as any
            });

            if (doc && !doc[docField]) {
                await prisma.documentRecord.update({
                    where: { id: item.documentId },
                    data: {
                        [docField]: item.proposedValue,
                        ...(confField ? { [confField]: item.confidence } : {}),
                        metadataReviewStatus: 'AUTO'
                    } as any
                });

                await prisma.metadataReviewQueue.update({
                    where: { id: item.id },
                    data: { status: 'APPROVED' }
                });
                updated++;
            }
        }
        console.log(`Fält [${fieldName}]: Materialiserat ${updated} st.`);
    }
}

main().finally(() => prisma.$disconnect());
