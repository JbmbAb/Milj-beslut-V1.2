
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("--- Thesis Statistics Check ---");

    // 1. Total Municipalities (as seen in documents)
    const munisDocsRawFilter = await prisma.documentRecord.groupBy({
        by: ['municipality'],
        where: {
            municipality: { not: null, notIn: ['Okänd', ''] }
        }
    });
    console.log(`Unique Municipalities (Documents Raw Filtered): ${munisDocsRawFilter.length}`);

    const _allRaw = munisDocsRawFilter.map(m => m.municipality).sort();
    // console.log("List of Raw Municipalities:", allRaw);

    const munisDocsRawAll = await prisma.documentRecord.groupBy({
        by: ['municipality'],
    });
    console.log(`Unique Municipalities (Documents Raw All): ${munisDocsRawAll.length}`);

    // List cases muni count
    const munisCasesAll = await prisma.requirementCase.groupBy({
        by: ['municipality'],
    });
    console.log(`Unique Municipalities (Cases All Raw): ${munisCasesAll.length}`);

    // Combined unique (Raw)
    const combinedSet = new Set([
        ...munisDocsRawAll.map(m => m.municipality),
        ...munisCasesAll.map(m => m.municipality)
    ].filter(m => m && m !== 'Okänd' && m !== ''));
    console.log(`Combined Set (Raw, non-empty, non-Okänd): ${combinedSet.size}`);

    const munisDocsNorm = await prisma.documentRecord.groupBy({
        by: ['municipalityNormalized'],
        where: {
            municipalityNormalized: {
                not: null,
                notIn: ['Okänd', '']
            }
        }
    });
    console.log(`Unique Municipalities (Documents Normalized Filtered): ${munisDocsNorm.length}`);

    // 2. Total Municipalities (as seen in requirement cases)
    const munisCases = await prisma.requirementCase.groupBy({
        by: ['municipality'],
        where: {
            municipality: { not: null, notIn: ['Okänd', ''] }
        }
    });
    console.log(`Unique Municipalities (Cases): ${munisCases.length}`);

    // 3. Total Requirement Cases (Ärenden)
    const casesCount = await prisma.requirementCase.count();
    console.log(`Total Requirement Cases (Ärenden): ${casesCount}`);

    // 4. Unique Municipalities (from RequirementRecords)
    const reqs = await prisma.requirementRecord.findMany({
        include: {
            document: true
        }
    });
    const reqMunis = new Set();
    for (const r of reqs) {
        if (r.document?.municipality && r.document.municipality !== 'Okänd') {
            reqMunis.add(r.document.municipality);
        }
    }
    console.log(`Unique Municipalities (Requirements): ${reqMunis.size}`);

    const reqMunisNorm = new Set();
    for (const r of reqs) {
        if (r.document?.municipalityNormalized && r.document.municipalityNormalized !== 'Okänd') {
            reqMunisNorm.add(r.document.municipalityNormalized);
        }
    }
    console.log(`Unique Municipalities (Requirements Normalized): ${reqMunisNorm.size}`);

    // 5. Total Requirement Records (Kravrader)
    const requirementsCount = await prisma.requirementRecord.count();
    console.log(`Total Requirement Records (Kravrader): ${requirementsCount}`);

    // 6. Projects Detail
    const projects = await prisma.project.findMany();
    console.log(`Total Projects: ${projects.length}`);
    for (const project of projects) {
        const docCount = await prisma.documentRecord.count({
            where: { projectId: project.id }
        });
        console.log(`- Project [${project.propertyDesignation}]: ${docCount} documents`);
    }

    // 7. Total Extracted Requirements (from PDF pipeline)
    const extractedCount = await prisma.extractedRequirement.count();
    console.log(`Total Extracted Requirements (PDF Pipeline): ${extractedCount}`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
