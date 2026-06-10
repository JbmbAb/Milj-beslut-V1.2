import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const unparsed = await prisma.outlookAttachment.findMany({
    where: { requirements: { none: {} } },
    select: { filename: true, storedPath: true, parsed: true, attachmentHash: true },
    take: 10
  });
  console.log(JSON.stringify(unparsed, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
