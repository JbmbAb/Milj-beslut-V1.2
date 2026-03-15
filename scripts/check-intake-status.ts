import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("--- Document Intake Progress ---");

    const totalDocs = await prisma.documentRecord.count();
    const statusStats = await prisma.documentRecord.groupBy({
        by: ['status'],
        _count: { id: true }
    });

    console.log(`Total DocumentRecords in DB: ${totalDocs}`);
    console.log("Status Distribution:");
    statusStats.forEach(s => {
        console.log(`- ${s.status}: ${s._count.id}`);
    });

    // Check jobs
    const pendingJobs = await prisma.searchJob.count({ where: { status: 'PENDING' } });
    const runningJobs = await prisma.searchJob.count({ where: { status: 'RUNNING' } });
    console.log(`Pending Search Jobs: ${pendingJobs}`);
    console.log(`Running Search Jobs: ${runningJobs}`);

    if (pendingJobs > 0) {
        const jobStats = await prisma.searchJob.groupBy({
            by: ['type'],
            where: { status: 'PENDING' },
            _count: { id: true }
        });
        console.log("Pending Jobs Breakdown:");
        jobStats.forEach(j => {
            console.log(`- ${j.type}: ${j._count.id}`);
        });
    }

    // Check Outlook data
    try {
        const attachments = await prisma.outlookAttachment.count();
        const processedAttachments = await prisma.outlookAttachment.count({
            where: { parsed: true }
        });
        console.log(`Total Outlook Attachments: ${attachments}`);
        console.log(`Parsed Outlook Attachments (PDF Pipeline): ${processedAttachments}`);
        console.log(`Unparsed Outlook Attachments: ${attachments - processedAttachments}`);
    } catch {
        console.log("Outlook tables not available or error checking them.");
    }

    // Check RequirementRecord vs ExtractedRequirement
    const reqRecords = await prisma.requirementRecord.count();
    const extReqs = await prisma.extractedRequirement.count();
    console.log(`RequirementRecords: ${reqRecords}`);
    console.log(`ExtractedRequirements (PDF Pipeline): ${extReqs}`);
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
