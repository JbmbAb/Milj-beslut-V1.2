import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const result: any[] = await prisma.$queryRaw`
    SELECT enumlabel 
    FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'RequirementVerificationStatus';
  `;
  console.log(result.map((r) => r.enumlabel));
}
main().finally(() => prisma.$disconnect());
