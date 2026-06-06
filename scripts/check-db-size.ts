import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const size: any = await prisma.$queryRawUnsafe("SELECT pg_size_pretty(pg_database_size('miljobeslut'));");
  console.log('DB Size:', size);

  const tables: any = await prisma.$queryRawUnsafe(`
    SELECT relname as table_name,
           pg_size_pretty(pg_total_relation_size(relid)) as total_size,
           pg_total_relation_size(relid) as raw_size
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 20;
  `);
  console.log('Top Tables:', tables);
  
  const counts = await prisma.$transaction([
    prisma.legalSourceRecord.count(),
    prisma.legalCorpusRecord.count(),
    prisma.judgmentRecord.count()
  ]);
  console.log('Counts:', { legalSourceRecord: counts[0], legalCorpusRecord: counts[1], judgmentRecord: counts[2] });
}

main().finally(() => prisma.$disconnect());
