
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const muniCounts = await prisma.$queryRaw`
    SELECT "municipalityNormalized", COUNT(*) as count 
    FROM "DocumentRecord" 
    WHERE "municipalityNormalized" IS NOT NULL 
    GROUP BY "municipalityNormalized" 
    ORDER BY count DESC 
    LIMIT 10;
  `;

    console.log(JSON.stringify(muniCounts, null, 2));

    const decisionCounts = await prisma.$queryRaw`
    SELECT "decisionType", COUNT(*) as count 
    FROM "DocumentRecord" 
    WHERE "decisionType" IS NOT NULL 
    GROUP BY "decisionType" 
    ORDER BY count DESC 
    LIMIT 10;
  `;

    console.log(JSON.stringify(decisionCounts, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
