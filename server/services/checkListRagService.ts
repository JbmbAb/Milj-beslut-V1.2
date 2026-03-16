import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import { embedText } from './searchService';
import { queryTopSemanticChunks } from '../repositories/searchRepository';
import { serverGenerateText } from '../../services/geminiService';
import { prisma } from '../db/prisma';

const db = prisma;

export interface RagExtractionResult {
    requirementsCreated: number;
    casesCreated: number;
    citationsCreated: number;
    message: string;
}

export async function extractAndGenerateChecklistFromRag(
    projectId: string,
    organisationId: string,
    query: string,
    activityCode: string
): Promise<RagExtractionResult> {
    // 1. Convert query to embedding
    const embeddingResult = await embedText(query);
    if (!embeddingResult || embeddingResult.values.length === 0) {
        throw new Error('Failed to generate embedding for the search query.');
    }

    // 2. Perform RAG search to get Top Document Chunks
    const semanticHits = await queryTopSemanticChunks({
        queryEmbedding: embeddingResult.values,
        limit: 15,
    });

    if (!semanticHits || semanticHits.length === 0) {
        return { requirementsCreated: 0, casesCreated: 0, citationsCreated: 0, message: 'No relevant documents found.' };
    }

    // Extract the text of the hits
    const combinedText = semanticHits
        .map(hit => `[Document: ${hit.documentId}]\nSnippet: ${hit.chunkText}`)
        .join('\n\n---\n\n');

    // 3. Prompt Gemini to extract requirements
    const prompt = `
You are an expert Swedish Environmental Law analyst. 
Based on the following document snippets retrieved regarding activity code "${activityCode}" (and context: "${query}"), extract a structured list of MUST-FOLLOW requirements.

Data Snippets:
${combinedText}

Output your response ONLY as a JSON array of requirement objects. Each object should have the exact following structure:
{
  "documentId": "The ID of the document where you found this requirement",
  "category": "Broad category, e.g. Lakvatten, Buller, Damning",
  "subcategory": "More specific context, e.g. Provtagning",
  "requirementTextQuote": "Exact quote from the text",
  "interpretedRequirement": "Your short, professional interpretation of the rule",
  "level": "mandatory, recommended, conditional",
  "legalReference": "E.g. Miljöbalken, Naturvårdsverkets Allmänna Råd, if mentioned"
}

Do not include markdown blocks like \`\`\`json. Return strictly the raw JSON array. If nothing is found, return an empty array [].
`;

    const aiTextResponse = await serverGenerateText(prompt);
    let parsedRequirements: any[] = [];
    try {
        const rawMatch = aiTextResponse?.match(/\[\s*\{.*\}\s*\]/s);
        const jsonToParse = rawMatch ? rawMatch[0] : (aiTextResponse || '[]');
        parsedRequirements = JSON.parse(jsonToParse);
    } catch {
        logger.error('Failed to parse JSON from AI model', { response: aiTextResponse });
        throw new Error('AI failed to return valid JSON format.');
    }

    if (!Array.isArray(parsedRequirements) || parsedRequirements.length === 0) {
        return { requirementsCreated: 0, casesCreated: 0, citationsCreated: 0, message: 'No requirements could be extracted.' };
    }

    let reqsCreated = 0;
    let casesCreated = 0;
    let citationsCreated = 0;

    // 4. Group by documentId to create cases if they don't exist
    for (const req of parsedRequirements) {
        const docId = req.documentId;
        if (!docId) continue;

        // Verify document exists
        const document = await db.documentRecord.findUnique({
            where: { id: docId }
        });

        if (!document) continue;

        // Create or find RequirementCase
        const caseKey = `case_${docId}`;
        let reqCase = await db.requirementCase.findUnique({ where: { caseKey } });

        if (!reqCase) {
            reqCase = await db.requirementCase.create({
                data: {
                    caseKey,
                    projectId,
                    documentId: docId,
                    organisationId,
                    municipality: document.municipality || 'Unknown',
                    sourceFile: document.diskName,
                    sourceSubject: document.subject || null,
                }
            });
            casesCreated++;
        }

        // Create RequirementRecord
        const requirementCode = `REQ_${docId.substring(0, 5)}_${randomUUID().substring(0, 6)}`;
        const requirementRec = await db.requirementRecord.create({
            data: {
                requirementCode,
                caseId: reqCase.id,
                documentId: docId,
                projectId,
                sourceType: 'EXTRACTED',
                category: req.category || 'Övrigt',
                subcategory: req.subcategory || 'Annat',
                requirementTextQuote: req.requirementTextQuote || '',
                interpretedRequirement: req.interpretedRequirement || '',
                level: req.level || 'mandatory',
                legalReference: req.legalReference || null,
            }
        });
        reqsCreated++;

        // Create RequirementCitation
        await db.requirementCitation.create({
            data: {
                citationCode: `CIT_${requirementCode}`,
                requirementId: requirementRec.id,
                caseId: reqCase.id,
                documentId: docId,
                quoteText: req.requirementTextQuote || '',
                extractor: 'Gemini-2.5-Pro',
            }
        });
        citationsCreated++;
    }

    return {
        requirementsCreated: reqsCreated,
        casesCreated,
        citationsCreated,
        message: `Successfully generated ${reqsCreated} requirements and checklists.`
    };
}
