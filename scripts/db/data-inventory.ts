
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const result = {
        totalDocuments: await prisma.documentRecord.count(),
        extractedRequirements: await prisma.requirementRecord.count(),
        materializedCases: await prisma.requirementCase.count(),
        uniqueMunicipalitiesWithData: (await prisma.$queryRaw<any[]>`SELECT COUNT(DISTINCT municipality) FROM "RequirementCase"`)[0].count,
        municipalityRanking: await prisma.$queryRaw<any[]>`SELECT municipality, COUNT(*) as count FROM "RequirementCase" GROUP BY municipality ORDER BY count DESC LIMIT 10`,
        decisionTypes: await prisma.$queryRaw<any[]>`SELECT "decisionType", COUNT(*) as count FROM "DocumentRecord" GROUP BY "decisionType" ORDER BY count DESC`
    };
    console.log(JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}
main().finally(() => prisma.$disconnect());
