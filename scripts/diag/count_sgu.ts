import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const ground = await prisma.$queryRawUnsafe('SELECT count(*) FROM env.sgu_ground_layer;');
    const landslide = await prisma.$queryRawUnsafe('SELECT count(*) FROM env.sgu_landslide_feature;');
    console.log({ ground, landslide });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
