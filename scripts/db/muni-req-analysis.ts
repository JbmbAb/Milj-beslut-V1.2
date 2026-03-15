
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function serialize(obj: any) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2
    );
}

async function main() {
    const muniReqs = await prisma.$queryRaw`
    SELECT 
      c.municipality, 
      COUNT(r.id) as req_count,
      COUNT(DISTINCT c.id) as case_count,
      CAST(COUNT(r.id) AS FLOAT) / COUNT(DISTINCT c.id) as avg_reqs
    FROM "RequirementCase" c
    JOIN "RequirementRecord" r ON r."caseId" = c.id
    WHERE c.municipality IS NOT NULL
    GROUP BY c.municipality
    ORDER BY req_count DESC
    LIMIT 10;
  `;

    console.log(serialize(muniReqs));

    const categoryDistribution = await prisma.$queryRaw`
    SELECT 
      c.municipality,
      r.category,
      COUNT(r.id) as count
    FROM "RequirementCase" c
    JOIN "RequirementRecord" r ON r."caseId" = c.id
    WHERE c.municipality IN (SELECT municipality FROM "RequirementCase" GROUP BY municipality ORDER BY COUNT(*) DESC LIMIT 5)
    GROUP BY c.municipality, r.category
    ORDER BY c.municipality, count DESC;
  `;

    console.log(serialize(categoryDistribution));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
