import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- PostGIS Type Check ---');
  try {
    const types = await prisma.$queryRawUnsafe(`
      SELECT typname FROM pg_type WHERE typname ILIKE '%geometry%' OR typname ILIKE '%geography%';
    `);
    console.log('✅ PostGIS Types:', JSON.stringify(types, null, 2));

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
