import { prisma } from '../server/db/prisma';

async function main() {
    console.log('Syncing municipalities from DocumentRecord to RequirementCase...');

    const updates = await prisma.$executeRawUnsafe(`
    UPDATE "RequirementCase"
    SET municipality = d.municipality,
        "authorityName" = d.municipality,
        "updatedAt" = NOW()
    FROM "DocumentRecord" d
    WHERE "RequirementCase"."documentId" = d.id
      AND ("RequirementCase".municipality IS NULL OR "RequirementCase".municipality = '')
      AND d.municipality IS NOT NULL;
  `);

    console.log(`Synced ${updates} requirement cases.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
