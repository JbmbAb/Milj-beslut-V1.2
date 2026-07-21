import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.outlookAttachment.count({
    where: {
      NOT: { extractedText: null },
      requirements: { none: {} }
    }
  });
  console.log(JSON.stringify({ attachmentsWithTextButNoReqs: count }));
}
main().catch(console.error).finally(() => prisma.$disconnect());
