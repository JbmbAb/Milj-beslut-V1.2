
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const result: any[] = await prisma.$queryRawUnsafe(`
    SELECT trigger_name, event_manipulation, event_object_table, action_statement
    FROM information_schema.triggers;
  `);
    console.log(JSON.stringify(result, null, 2));
}
main().finally(() => prisma.$disconnect());
