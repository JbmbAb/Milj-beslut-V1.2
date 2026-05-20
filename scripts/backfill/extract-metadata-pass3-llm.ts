/**
 * Steg 8 – Pass 3: LLM-extraktion för osäkra/saknade fält
 * Gemini primär, OpenAI fallback. maxRetries=2, timeout=15s.
 * LLM får aldrig skriva över LOCKED eller högre confidence.
 * Kör: npx tsx scripts/backfill/extract-metadata-pass3-llm.ts [--limit=10] [--dry-run]
 */
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();
import { prisma } from '../../server/db/prisma';
import {
    arg, flag, startPipelineRun, finishPipelineRun, failPipelineRun,
    conditionalUpdate, BATCH, LLM, CONFIDENCE_THRESHOLDS, MetadataField,
} from './_shared';

// ─── Hämta Gemini/OpenAI-klienter från befintliga services ──────────────────
const geminiAvailable = !!process.env.GEMINI_API_KEY;
const openaiAvailable = !!process.env.OPENAI_API_KEY;

interface LlmExtractionResult {
    municipality?: { value: string | null; confidence: number };
    legalStatus?: { value: string | null; confidence: number };
    decisionType?: { value: string | null; confidence: number };
    activityCode?: { value: string | null; confidence: number };
    wasteType?: { value: string | null; confidence: number };
}

async function callLlmWithTimeout(prompt: string, modelName: 'gemini' | 'openai'): Promise<LlmExtractionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM.timeoutMs);

    try {
        if (modelName === 'gemini') {
            const { GoogleGenerativeAI } = await import('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
            const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            return parseJsonResponse(text);
        } else {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    max_tokens: 512,
                }),
            });
            if (!response.ok) {
                throw new Error(`OpenAI HTTP ${response.status}`);
            }
            const payload = await response.json() as {
                choices?: Array<{ message?: { content?: string | null } }>;
            };
            return parseJsonResponse(payload.choices?.[0]?.message?.content ?? '{}');
        }
    } finally {
        clearTimeout(timer);
    }
}

function parseJsonResponse(text: string): LlmExtractionResult {
    try {
        const json = JSON.parse(text.replace(/```json|```/g, '').trim());
        return json as LlmExtractionResult;
    } catch {
        return {};
    }
}

function buildPrompt(docText: string, missingFields: MetadataField[]): string {
    return `Du är ett system som extraherar och klassificerar metadata från svenska miljödokument (beslut, anmälningar, tillsynsrapporter).
Extrahera eller inferera följande fält: ${missingFields.join(', ')}.

DOKUMENT (första 1500 tecken):
${docText.slice(0, 1500)}

Svara ENBART med giltig JSON med strukturen:
{
  "municipality": { "value": "Nacka" eller null, "confidence": 0.0-1.0 },
  "legalStatus": { "value": "Dnr 2024-12345" eller null, "confidence": 0.0-1.0 },
  "decisionType": { "value": "Beslut", "Anmälan", "Tillsyn", "Föreläggande" etc or null, "confidence": 0.0-1.0 },
  "activityCode": { "value": "90.40" (för avfall), "90.30" (för massor/schakt), "06.00" (för energi) etc or null, "confidence": 0.0-1.0 },
  "wasteType": { "value": "Farligt avfall", "Schaktmassor", "Inert avfall" etc or null, "confidence": 0.0-1.0 }
}

VIKTIGT: För 'activityCode' (verksamhetskod enligt miljöprövningsförordningen): 
- Om texten nämner 'mellanlagring av avfall' -> "90.40"
- Om texten nämner 'mellanlagring av massor/schakt' -> "90.30"
- Om texten nämner 'sortering' -> "90.40"
- Om du är osäker, gör din bästa gissning baserat på ärendebeskrivningen och sätt confidence därefter.`;
}

async function callWithRetry(prompt: string): Promise<{ result: LlmExtractionResult; modelName: string }> {
    for (let attempt = 0; attempt <= LLM.maxRetries; attempt++) {
        try {
            if (geminiAvailable) {
                const result = await callLlmWithTimeout(prompt, 'gemini');
                return { result, modelName: 'gemini-2.5-flash' };
            }
        } catch (e: any) {
            console.error(`Gemini failed (attempt ${attempt}):`, e.message);
            if (attempt < LLM.maxRetries && openaiAvailable) {
                try {
                    const result = await callLlmWithTimeout(prompt, 'openai');
                    return { result, modelName: 'gpt-4o-mini' };
                } catch (e2: any) {
                    console.error('OpenAI fallback failed:', e2.message);
                }
            }
        }
    }
    return { result: {}, modelName: 'none' };
}

async function main() {
    const limit = Number(arg('limit') || BATCH.llmPass);
    const dryRun = flag('dry-run');
    const runId = await startPipelineRun({ runType: 'META_PASS3_LLM', stageName: 'extract-metadata-pass3-llm', config: { limit, dryRun } });
    let processed = 0;
    let errors = 0;

    try {
        // Find docs where key fields are still missing or below threshold
        const docs = await prisma.documentRecord.findMany({
            where: {
                metadataReviewStatus: { not: 'LOCKED' },
                content: { isNot: null },
                OR: [
                    { municipalityNormalized: null },
                    { legalStatus: null },
                    { decisionType: null },
                    { activityCode: null },
                    { wasteType: null },
                ],
            },
            select: {
                id: true,
                municipalityNormalized: true,
                legalStatus: true,
                decisionType: true,
                activityCode: true,
                wasteType: true,
                municipalityConfidence: true,
                diarieConfidence: true,
                decisionTypeConfidence: true,
                content: { select: { searchText: true } },
            },
            take: limit,
        });

        for (const doc of docs) {
            const text = doc.content?.searchText ?? '';
            if (!text) continue;

            const missingFields: MetadataField[] = [];
            if (!doc.municipalityNormalized || (doc.municipalityConfidence ?? 0) < CONFIDENCE_THRESHOLDS.municipality) {
                missingFields.push('municipality');
            }
            if (!doc.legalStatus || (doc.diarieConfidence ?? 0) < CONFIDENCE_THRESHOLDS.legalStatus) {
                missingFields.push('legalStatus');
            }
            if (!doc.decisionType || (doc.decisionTypeConfidence ?? 0) < CONFIDENCE_THRESHOLDS.decisionType) {
                missingFields.push('decisionType');
            }
            if (!doc.activityCode) missingFields.push('activityCode');
            if (!doc.wasteType) missingFields.push('wasteType');
            if (missingFields.length === 0) continue;

            const prompt = buildPrompt(text, missingFields);
            const promptHash = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 32);

            try {
                const { result, modelName } = await callWithRetry(prompt);
                const responseStr = JSON.stringify(result);

                for (const field of missingFields) {
                    const extracted = result[field];
                    if (!extracted?.value) continue;
                    if (!dryRun) {
                        const updateResult = await conditionalUpdate({
                            documentId: doc.id,
                            field,
                            value: extracted.value,
                            confidence: extracted.confidence,
                            sourceType: 'llm_inference',
                            extractorVersion: '1.0',
                            llmPromptHash: promptHash,
                            llmResponse: responseStr.slice(0, 1000),
                            modelName,
                            dryRun: false,
                        });
                        if (updateResult === 'updated') {
                            console.log(`  [UPDATED] ${field} for doc ${doc.id} to ${extracted.value} (conf: ${extracted.confidence})`);
                        } else {
                            console.log(`  [SKIPPED] ${field} for doc ${doc.id} (reason: ${updateResult})`);
                        }
                    }
                }
                processed++;
            } catch (e) {
                console.error(`LLM error on doc ${doc.id}:`, e);
                errors++;
            }
        }

        await finishPipelineRun(runId, processed, errors);
    } catch (e) {
        await failPipelineRun(runId, e);
        throw e;
    }

    console.log(JSON.stringify({ runId, dryRun, processed, errors }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
