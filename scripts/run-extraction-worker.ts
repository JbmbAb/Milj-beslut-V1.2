import { processSearchJobsOnce } from '../server/services/searchWorker';
import { prisma } from '../server/db/prisma';

async function main() {
    console.log("Starting Extraction-Only Worker...");
    let totalProcessed = 0;

    // We use a custom loop to force EXRACT_TEXT priority if needed,
    // but the standard worker already has a preferredType parameter.
    
    while (true) {
        const pending = await prisma.searchJob.count({ 
            where: { 
                status: 'PENDING',
                type: 'EXTRACT_TEXT'
            } 
        });
        
        if (pending === 0) {
            console.log("No more pending EXTRACT_TEXT jobs. Worker done.");
            break;
        }

        console.log(`Processing EXTRACT_TEXT jobs... Pending: ${pending}`);
        // Force the worker to pick EXTRACT_TEXT by passing it as preferredType
        const processed = await processSearchJobsOnce(10, 'EXTRACT_TEXT'); 
        // Note: processSearchJobsOnce in searchWorker.ts has a hardcoded preference for EMBED_DOC at index 0.
        // We might want to bypass that.
        
        totalProcessed += processed;
        if (processed === 0) break;
    }

    console.log(`Total extraction jobs processed: ${totalProcessed}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
