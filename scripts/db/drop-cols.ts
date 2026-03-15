
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    await prisma.$executeRawUnsafe('ALTER TABLE "RequirementRecord" DROP COLUMN IF EXISTS "verificationStatus"');
    await prisma.$executeRawUnsafe('ALTER TABLE "RequirementCitation" DROP COLUMN IF EXISTS "verificationStatus"');
    console.log('Dropped problematic columns.');
}
main().finally(() => prisma.$disconnect());
