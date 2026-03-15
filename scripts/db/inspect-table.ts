
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const result: any[] = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns 
    WHERE table_name = 'RequirementRecord'
    ORDER BY ordinal_position;
  `);
    console.log(JSON.stringify(result, null, 2));
}
main().finally(() => prisma.$disconnect());
