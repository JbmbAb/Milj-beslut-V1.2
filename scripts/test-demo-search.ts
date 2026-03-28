import { runSearchQuery } from '../server/services/searchService';
import { prisma } from '../server/db/prisma';

async function test() {
    const userId = "cmm4xvu9l0002cuh4aqp40zlm";
    const projectId = "cmm55w57p0004cuisfrtpqly8";
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { organisationId: true },
    });

    if (!project?.organisationId) {
        throw new Error(`Project '${projectId}' is missing organisationId or does not exist.`);
    }

    console.log(`Testing search for project: ${projectId}...`);
    const results = await runSearchQuery({
        projectId,
        organisationId: project.organisationId,
        userId,
        query: 'dagvatten lakvatten tat platta',
        mode: 'hybrid',
        strictEvidence: false,
        topK: 3
    });

    console.log(JSON.stringify(results, null, 2));
}

test().finally(() => prisma.$disconnect());
