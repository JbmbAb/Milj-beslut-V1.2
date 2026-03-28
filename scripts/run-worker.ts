import { processSearchJobsOnce } from '../server/services/searchWorker';
import { prisma } from '../server/db/prisma';

async function main() {
    console.log("Starting Search Job Worker...");
    let totalProcessed = 0;

    while (true) {
        const pending = await prisma.searchJob.count({ where: { status: 'PENDING' } });
        if (pending === 0) {
            console.log("No more pending jobs. Worker done.");
            break;
        }

        console.log(`Processing jobs... Pending: ${pending}`);
        const processed = await processSearchJobsOnce(10);
        totalProcessed += processed;

        if (processed === 0) {
            console.log("Worker returned 0 processed jobs but queue not empty. Check for failures or running jobs.");
            break;
        }
    }

    console.log(`Total jobs processed: ${totalProcessed}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
