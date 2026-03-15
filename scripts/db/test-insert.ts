
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    try {
        const code = 'REQ-TEST-' + Date.now();
        const caseId = (await prisma.requirementCase.findFirst())?.id;
        if (!caseId) {
            console.log('No case found');
            return;
        }
        const docId = (await prisma.documentRecord.findFirst())?.id;
        const projId = (await prisma.project.findFirst())?.id;

        await prisma.requirementRecord.create({
            data: {
                requirementCode: code,
                caseId: caseId,
                documentId: docId!,
                projectId: projId!,
                sourceType: 'DEBUG',
                category: 'Test',
                subcategory: 'Test',
                requirementTextQuote: 'Test',
                interpretedRequirement: 'Test',
                level: 'MANDATORY'
            }
        });
        console.log('Created test record');
    } catch (e: any) {
        console.error('Error detail:', JSON.stringify(e, null, 2));
    }
}

main().finally(() => prisma.$disconnect());

