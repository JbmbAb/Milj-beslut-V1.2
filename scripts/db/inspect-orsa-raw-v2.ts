import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Searching for STACKMORA anywhere...');
  const rows = await prisma.$queryRaw<any[]>`
    SELECT kommunnamn, trakt, etikett, count(*)::text as count
    FROM env.registerenhetsomradesytor
    WHERE trakt ILIKE '%STACKMORA%' OR etikett ILIKE '%STACKMORA%'
    GROUP BY kommunnamn, trakt, etikett
    LIMIT 10;
  `;
  console.log('Results:', JSON.stringify(rows, null, 2));

  console.log('Searching for 3:12 in ORSA...');
  const orsa312 = await prisma.$queryRaw<any[]>`
    SELECT kommunnamn, trakt, etikett
    FROM env.registerenhetsomradesytor
    WHERE kommunnamn = 'ORSA' AND etikett = '3:12'
    LIMIT 10;
  `;
  console.log('ORSA 3:12 results:', JSON.stringify(orsa312, null, 2));
}

main().finally(() => prisma.$disconnect());
