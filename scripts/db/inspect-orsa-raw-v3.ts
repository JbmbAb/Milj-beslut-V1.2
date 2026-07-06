import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Searching for etikett 3:12 anywhere...');
  const rows = await prisma.$queryRaw<any[]>`
    SELECT kommunnamn, trakt, etikett, count(*)::text as count
    FROM env.registerenhetsomradesytor
    WHERE etikett = '3:12'
    GROUP BY kommunnamn, trakt, etikett
    ORDER BY count DESC
    LIMIT 20;
  `;
  console.log('Results:', JSON.stringify(rows, null, 2));

  console.log('Searching for anything STACKMORA 3...');
  const stackmora3 = await prisma.$queryRaw<any[]>`
    SELECT kommunnamn, trakt, etikett
    FROM env.registerenhetsomradesytor
    WHERE trakt = 'STACKMORA' AND etikett LIKE '3:%'
    LIMIT 10;
  `;
  console.log('STACKMORA 3:X results:', JSON.stringify(stackmora3, null, 2));
}

main().finally(() => prisma.$disconnect());
