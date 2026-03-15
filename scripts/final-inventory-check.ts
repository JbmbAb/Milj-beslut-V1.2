import { prisma } from '../server/db/prisma';

async function main() {
    const totalDocs = await prisma.documentRecord.count();
    const embeddedDocs = await prisma.documentRecord.count({ where: { status: 'EMBEDDED' } });
    const docsWithReqs = await prisma.documentRecord.count({ where: { requirements: { some: {} } } });
    const pendingJobs = await prisma.searchJob.count({ where: { status: 'PENDING' } });
    const nullMuni = await prisma.documentRecord.count({ where: { municipality: null } });
    const totalRequirements = await prisma.requirementRecord.count();

    console.log('--- FINAL INVENTORY CHECK ---');
    console.log(`Total DocumentRecords in DB:   ${totalDocs}`);
    console.log(`Fully Indexed (EMBEDDED):      ${embeddedDocs}`);
    console.log(`Docs with Extracted Reqs:      ${docsWithReqs}`);
    console.log(`Total Reqs Extracted:          ${totalRequirements}`);
    console.log(`Pending Search Jobs:           ${pendingJobs}`);
    console.log(`Docs Missing Municipality:     ${nullMuni}`);

    if (totalDocs === embeddedDocs && pendingJobs === 0) {
        console.log('\nRESULT: All technical processing (OCR/Embedding) is DONE.');
    } else {
        console.log('\nRESULT: Some technical processing is still pending.');
    }

    if (docsWithReqs >= totalDocs * 0.9) {
        console.log('RESULT: Requirement extraction coverage is HIGH (>90%).');
    } else {
        console.log(`RESULT: Requirement extraction coverage is at ${Math.round((docsWithReqs / totalDocs) * 100)}%.`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
