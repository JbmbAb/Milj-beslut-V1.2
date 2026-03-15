import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function run() {
  const totalDocs = await db.documentRecord.count();
  const totalChunks = await db.documentChunk.count();
  const embeddedDocs = await db.documentRecord.count({ where: { status: 'EMBEDDED' } });
  const metaOnly = await db.documentRecord.count({ where: { status: 'METADATA_ONLY' } });
  const municipalities = await db.documentRecord.groupBy({ by: ['municipality'], where: { municipality: { not: null } }, _count: { _all: true }, orderBy: { _count: { municipality: 'desc' } }, take: 10 });
  const decisionTypes = await db.documentRecord.groupBy({ by: ['decisionType'], where: { decisionType: { not: null } }, _count: { _all: true }, orderBy: { _count: { decisionType: 'desc' } }, take: 10 });
  const emailCount = await db.emailMessage.count();
  const attachCount = await db.outlookAttachment.count();
  console.log(JSON.stringify({ totalDocs, embeddedDocs, metaOnly, totalChunks, emailCount, attachCount, topMunicipalities: municipalities, topDecisionTypes: decisionTypes }, null, 2));
}
run().catch(console.error).finally(() => db.$disconnect());
