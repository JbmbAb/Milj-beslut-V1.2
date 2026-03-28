import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const BATCH_SIZE = 15; // Specific worker for Mariestad set

interface DeepRequirement {
    rule: string;
    category: string;
    subcategory: string;
    level: string;
    citation: string;
    reasoning: string;
}

async function extractDeepRequirements(docId: string, text: string): Promise<DeepRequirement[]> {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const prompt = `Analysera miljöbeslutstexten för Mariestad. Identifiera alla tekniska och juridiska KRAV.
Fokus: Mark, Vatten, Avfall, Buller, Kontroller.

Returnera JSON:
[
  {
    "rule": "Kravtext",
    "category": "Kategori",
    "subcategory": "Underkategori",
    "level": "mandatory/recommended/conditional",
    "citation": "Citat ur text",
    "reasoning": "Juridisk grund"
  }
]

Text:
${text.slice(0, 30000)}
`;

    try {
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
            },
        });
        const textResp = result.response.text();
        return JSON.parse(textResp);
    } catch {
        return [];
    }
}

async function main() {
    console.log('--- STARTING MARIESTAD-FOCUSED AI WORKER ---');

    const docs = await prisma.documentRecord.findMany({
        where: {
            status: { in: ['TEXT_EXTRACTED', 'EMBEDDED'] },
            requirementCitations: { none: { extractor: 'gemini_deep_v1' } },
            OR: [
                { originalName: { contains: 'Mariestad', mode: 'insensitive' } },
                { content: { searchText: { contains: 'Mariestad', mode: 'insensitive' } } }
            ]
        },
        select: { id: true, originalName: true, projectId: true, organisationId: true, subject: true },
        take: 300
    });

    console.log(`Mariestad Worker: Found ${docs.length} documents left for Mariestad set.`);

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = docs.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (doc) => {
            try {
                let rCase = await prisma.requirementCase.findUnique({ where: { documentId: doc.id } });
                if (!rCase) {
                    rCase = await prisma.requirementCase.create({
                        data: {
                            caseKey: `M_${doc.id.slice(-8)}_${Date.now() % 1000}`,
                            projectId: doc.projectId,
                            documentId: doc.id,
                            organisationId: doc.organisationId,
                            sourceFile: doc.originalName,
                            sourceSubject: doc.subject || 'Mariestad'
                        }
                    });
                }

                const content = await prisma.documentContent.findUnique({ where: { documentId: doc.id } });
                const text = content?.searchText || '';
                if (text.length < 100) return;

                const requirements = await extractDeepRequirements(doc.id, text);
                
                for (const req of requirements) {
                    const reqHash = Buffer.from(`${req.category}:${req.rule}`).toString('base64').slice(0, 64);
                    const record = await prisma.requirementRecord.upsert({
                        where: { requirementCode: `M3_${doc.id.slice(-6)}_${reqHash.slice(0, 6)}` },
                        update: {},
                        create: {
                            requirementCode: `M3_${doc.id.slice(-6)}_${reqHash.slice(0, 6)}`,
                            requirementHash: reqHash,
                            caseId: rCase.id,
                            documentId: doc.id,
                            projectId: doc.projectId,
                            sourceType: 'DECISION',
                            category: req.category,
                            subcategory: req.subcategory || 'Mariestad',
                            requirementTextQuote: req.citation,
                            interpretedRequirement: req.rule,
                            level: req.level,
                            codingConfidence: 'HIGH'
                        }
                    });

                    await prisma.requirementCitation.create({
                        data: {
                            citationCode: `MC3_${Math.random().toString(36).slice(2, 6)}_${Date.now()}`,
                            requirementId: record.id,
                            caseId: rCase.id,
                            documentId: doc.id,
                            quoteText: req.citation,
                            extractor: 'gemini_deep_v1'
                        }
                    });
                }
                console.log(`[MARIESTAD] OK: ${doc.originalName}: ${requirements.length} found.`);
            } catch (error) {
                console.warn(`[MARIESTAD] Failed for ${doc.originalName}:`, error);
            }
        }));
        console.log(`Mariestad Progress: ${i + batch.length}/${docs.length}`);
    }

    console.log('--- MARIESTAD-FOCUSED WORKER FINISHED ---');
}

main().catch(console.error).finally(() => prisma.$disconnect());
