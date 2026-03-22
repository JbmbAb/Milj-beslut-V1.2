import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
const prisma = new PrismaClient();
async function main() {
  const result: any[] = await prisma.$queryRaw`
    SELECT
        indexname,
        indexdef
    FROM
        pg_indexes
    WHERE
        tablename = 'RequirementRecord';
  `;
  let out = '';
  for (const idx of result) {
    out += `Index: ${idx.indexname}\n`;
    out += `Def: ${idx.indexdef}\n`;
    out += '---\n';
  }
  fs.writeFileSync('indexes_output.txt', out);
  console.log('Wrote to indexes_output.txt');
}
main().finally(() => prisma.$disconnect());
