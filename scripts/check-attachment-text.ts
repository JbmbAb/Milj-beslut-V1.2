import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const total = await prisma.outlookAttachment.count();
  const withText = await prisma.outlookAttachment.count({ where: { NOT: { extractedText: null } } });
  const parsed = await prisma.outlookAttachment.count({ where: { parsed: true } });
  console.log(JSON.stringify({ total, withText, parsed }));
}
main().catch(console.error).finally(() => prisma.$disconnect());
