import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const result: any[] = await prisma.$queryRaw`
    SELECT column_name, data_type, udt_name 
    FROM information_schema.columns 
    WHERE table_name = 'RequirementRecord' AND column_name = 'verificationStatus';
  `;
  console.log(JSON.stringify(result, null, 2));
}
main().finally(() => prisma.$disconnect());
