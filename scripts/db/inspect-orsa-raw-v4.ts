import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Searching for STACKMORA 3:12 with any suffix...');
  const rows = await prisma.$queryRaw<any[]>`
    SELECT kommunnamn, trakt, etikett, count(*)::text as count
    FROM env.registerenhetsomradesytor
    WHERE trakt = 'STACKMORA' AND etikett LIKE '3:12%'
    GROUP BY kommunnamn, trakt, etikett;
  `;
  console.log('Results:', JSON.stringify(rows, null, 2));
}

main().finally(() => prisma.$disconnect());
