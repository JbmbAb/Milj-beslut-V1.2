import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Inspecting raw data for ORSA...');
  const rows = await prisma.$queryRaw<any[]>`
    SELECT kommunnamn, trakt, etikett, registerenhetsreferens
    FROM env.registerenhetsomradesytor
    WHERE kommunnamn = 'ORSA'
    LIMIT 10;
  `;
  console.log('Raw samples:', JSON.stringify(rows, null, 2));

  const searchTrakt = await prisma.$queryRaw<any[]>`
    SELECT kommunnamn, trakt, etikett, registerenhetsreferens
    FROM env.registerenhetsomradesytor
    WHERE trakt = 'STACKMORA' AND etikett = '3:12'
    LIMIT 5;
  `;
  console.log('Search by trakt STACKMORA and etikett 3:12:', JSON.stringify(searchTrakt, null, 2));
}

main().finally(() => prisma.$disconnect());
