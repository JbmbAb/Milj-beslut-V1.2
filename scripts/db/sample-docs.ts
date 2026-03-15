
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const docs = await prisma.documentRecord.findMany({
        take: 5,
        select: {
            id: true,
            subject: true,
            municipalityNormalized: true,
            decisionType: true,
            wasteType: true,
            activityCode: true,
        }
    });

    console.log(JSON.stringify(docs, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
