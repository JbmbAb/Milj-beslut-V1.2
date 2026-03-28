import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- DB Context Check ---');
  try {
    const context = await prisma.$queryRawUnsafe(`
      SELECT current_database(), current_user, current_schema();
    `);
    console.log('✅ Context:', JSON.stringify(context, null, 2));

    const extensions = await prisma.$queryRawUnsafe(`
      SELECT extname, extversion FROM pg_extension;
    `);
    console.log('✅ Extensions:', JSON.stringify(extensions, null, 2));

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
