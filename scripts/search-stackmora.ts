import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<any[]>`SELECT designation FROM core.property_unit WHERE designation LIKE 'ORSA STACKMORA%' ORDER BY designation;`;
  console.log(`Found ${rows.length} matches in core.`);
  const has312 = rows.some(r => r.designation.includes('3:12'));
  console.log(`Has 3:12: ${has312}`);
  if (has312) {
      console.log(rows.find(r => r.designation.includes('3:12')).designation);
  } else {
      console.log('Sample of 3:x results:');
      console.log(JSON.stringify(rows.filter(r => r.designation.startsWith('ORSA STACKMORA 3:')).map(r => r.designation), null, 2));
  }
  await prisma.$disconnect();
}
main();
