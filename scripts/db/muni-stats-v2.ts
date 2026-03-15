
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function serialize(obj: any) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2
    );
}

async function main() {
    const muniCounts = await prisma.$queryRaw`
    SELECT "municipalityNormalized", COUNT(*) as count 
    FROM "DocumentRecord" 
    WHERE "municipalityNormalized" IS NOT NULL 
    GROUP BY "municipalityNormalized" 
    ORDER BY count DESC 
    LIMIT 20;
  `;

    console.log(serialize(muniCounts));

    const decisionCounts = await prisma.$queryRaw`
    SELECT "decisionType", COUNT(*) as count 
    FROM "DocumentRecord" 
    WHERE "decisionType" IS NOT NULL 
    GROUP BY "decisionType" 
    ORDER BY count DESC 
    LIMIT 20;
  `;

    console.log(serialize(decisionCounts));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
