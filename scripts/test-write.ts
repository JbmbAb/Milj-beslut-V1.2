import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function main() {
    const doc = await prisma.documentRecord.findFirst({
        where: { status: 'TEXT_EXTRACTED' }
    });

    if (!doc) {
        console.log('No doc found');
        return;
    }

    console.log(`Testing with ${doc.id}...`);

    let rCase = await prisma.requirementCase.findUnique({ where: { documentId: doc.id } });
    if (!rCase) {
        rCase = await prisma.requirementCase.create({
            data: {
                caseKey: `TEST_${doc.id.slice(-8)}_${Date.now() % 1000}`,
                projectId: doc.projectId,
                documentId: doc.id,
                organisationId: doc.organisationId,
                sourceFile: doc.originalName,
                sourceSubject: doc.subject || 'Test'
            }
        });
    }
    console.log('Case OK');

    const record = await prisma.requirementRecord.create({
        data: {
            requirementCode: `TEST_REC_${doc.id.slice(-6)}_${Date.now() % 1000}`,
            caseId: rCase.id,
            documentId: doc.id,
            projectId: doc.projectId,
            sourceType: 'DECISION',
            category: 'Test',
            subcategory: 'Test',
            requirementTextQuote: 'Test',
            interpretedRequirement: 'Test',
            level: 'mandatory'
        }
    });
    console.log('Record OK');

    await prisma.requirementCitation.create({
        data: {
            citationCode: `TEST_CIT_${record.id.slice(-6)}_${doc.id.slice(-4)}`,
            requirementId: record.id,
            caseId: rCase.id,
            documentId: doc.id,
            quoteText: 'Test',
            extractor: 'test_v1'
        }
    });
    console.log('Citation OK');

    console.log('--- TEST FINISHED ---');
}

main().catch(console.error).finally(() => prisma.$disconnect());
