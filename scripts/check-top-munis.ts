import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const top = await prisma.documentRecord.groupBy({
        by: ['municipalityNormalized'],
        _count: { _all: true },
        where: { municipalityNormalized: { not: null } },
        orderBy: { _count: { municipalityNormalized: 'desc' } },
        take: 10,
    });
    console.log(JSON.stringify(top, null, 2));
}

main().finally(() => prisma.$disconnect());
