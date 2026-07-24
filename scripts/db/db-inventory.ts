import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('==================================================');
  console.log('         MILJÖBESLUT DATABAS-INVENTERING          ');
  console.log('==================================================');

  // Hämta alla scheman och tabeller
  const tables = await prisma.$queryRaw<Array<{ schemaname: string; tablename: string }>>`
    SELECT schemaname, tablename 
    FROM pg_tables 
    WHERE schemaname IN ('public', 'core', 'env', 'topo10')
    ORDER BY schemaname, tablename
  `;

  console.log(`Hittade ${tables.length} tabeller i de relevanta schemana.\n`);

  const results: Array<{ schema: string; table: string; rows: number }> = [];

  for (const { schemaname, tablename } of tables) {
    try {
      const countRes = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "${schemaname}"."${tablename}"`,
      );
      const count = Number(countRes[0]?.count ?? 0n);
      results.push({ schema: schemaname, table: tablename, rows: count });
    } catch (err) {
      // Om tabellen t.ex. saknar rättigheter eller har andra problem, logga det
      results.push({ schema: schemaname, table: tablename, rows: -1 });
    }
  }

  // Gruppera och skriv ut resultat per schema
  const schemas = ['public', 'core', 'env', 'topo10'];
  for (const schema of schemas) {
    console.log(`\n--- Schema: ${schema.toUpperCase()} ---`);
    const schemaTables = results.filter((r) => r.schema === schema);
    if (schemaTables.length === 0) {
      console.log('  (inga tabeller)');
      continue;
    }

    // Skapa en snygg tabellutskrift
    const longestName = Math.max(...schemaTables.map((t) => t.table.length), 10);
    console.log(`  ${'Tabellnamn'.padEnd(longestName)} | Antal rader`);
    console.log(`  ${'-'.repeat(longestName)}|${'-'.repeat(12)}`);

    for (const { table, rows } of schemaTables) {
      const rowsStr = rows === -1 ? 'FEL' : rows.toLocaleString('sv-SE');
      console.log(`  ${table.padEnd(longestName)} | ${rowsStr}`);
    }
  }

  console.log('\n==================================================');
  console.log('            INVENTERING SLUTFÖRD!                 ');
  console.log('==================================================');
}

main()
  .catch((err) => {
    console.error('Allvarligt fel vid databasinventering:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
