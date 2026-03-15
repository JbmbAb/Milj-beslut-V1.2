import { demoSearch } from '../server/services/demoSearchService';
import { prisma } from '../server/db/prisma';

async function test() {
    const userId = "cmm4xvu9l0002cuh4aqp40zlm";
    const projectId = "cmm55w57p0004cuisfrtpqly8";

    console.log(`Testing search for project: ${projectId}...`);
    const results = await demoSearch({
        projectId,
        userId,
        query: 'dagvatten lakvatten tät platta',
        topK: 3
    });

    console.log(JSON.stringify(results, null, 2));
}

test().finally(() => prisma.$disconnect());
