import { prisma } from '../server/db/prisma';

async function main() {
    const latest = await prisma.$queryRawUnsafe('SELECT * FROM "DocumentMetadataEvidence" ORDER BY "createdAt" DESC LIMIT 5');
    console.log(JSON.stringify(latest, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
