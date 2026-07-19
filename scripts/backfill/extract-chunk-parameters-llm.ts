/**
 * scripts/backfill/extract-chunk-parameters-llm.ts
 *
 * Batched, schema-validated, and robust LLM-based parameter extraction for Document Chunks.
 * Extracts exact chemical concentrations, volumes, and units with exponential backoff and checkpointing.
 * Runs using Gemini-1.5-flash with OpenAI fallback.
 *
 * Run: npx tsx scripts/backfill/extract-chunk-parameters-llm.ts [--limit=50] [--batch-size=5] [--dry-run]
 */

import dotenv from 'dotenv';
dotenv.config();
import { prisma } from '../../server/db/prisma';
import { z } from 'zod';

// Fetch API keys
const geminiAvailable = !!process.env.GEMINI_API_KEY;
const openaiAvailable = !!process.env.OPENAI_API_KEY;

// Command line arguments
const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;

const batchSizeArg = args.find((a) => a.startsWith('--batch-size='));
const batchSize = batchSizeArg ? Number(batchSizeArg.split('=')[1]) : 5;

const dryRun = args.includes('--dry-run');

// Zod schemas for validation
const ParameterLimitSchema = z.object({
  parameterTyp: z.enum([
    'PFAS_4', 'PFAS_11', 'BLY', 'ZINK', 'KOBOLT', 'KADMIUM', 'ARSENIK', 'KOPPAR', 'NICKEL', 'KROM', 'KVICKSILVER',
    'BENS_A_PYREN', 'PAH_H', 'PAH_M', 'PAH_L', 'OLJA', 'TOC', 'VOLYM_SCHAKT', 'MELLANLAGRING_VOLYM', 'MELLANLAGRING_TID', 'BULLER'
  ]),
  gransvarde: z.number(),
  enhet: z.enum(['UG_L', 'MG_KG_TS', 'TON', 'DBA', 'MANADER', 'AR', 'M3']),
  comparisonOperator: z.enum(['LT', 'LTE', 'GT', 'GTE', 'EQ', 'BETWEEN']),
  sourceText: z.string().optional().nullable(),
  originalValue: z.string().optional().nullable(),
  confidence: z.number().optional().nullable(),
});

const ChunkResultSchema = z.object({
  chunkId: z.string(),
  limits: z.array(ParameterLimitSchema),
});

const LlmBatchResultSchema = z.object({
  results: z.array(ChunkResultSchema),
});

type LlmBatchResult = z.infer<typeof LlmBatchResultSchema>;

async function callLlmWithTimeout(prompt: string, modelName: 'gemini' | 'openai'): Promise<LlmBatchResult> {
  const timeoutMs = 25000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (modelName === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
      const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return parseJsonResponse(text);
    } else {
      // OpenAI fallback
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 1024,
      });
      return parseJsonResponse(response.choices[0]?.message?.content ?? '{}');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function callLlmWithBackoff(prompt: string, modelName: 'gemini' | 'openai'): Promise<LlmBatchResult> {
  const maxRetries = 4;
  let delay = 1500; // Start with 1.5 seconds

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callLlmWithTimeout(prompt, modelName);
    } catch (err: any) {
      const errMessage = err.message || '';
      const isRateLimit = errMessage.includes('429') || errMessage.includes('Quota') || errMessage.includes('credits') || errMessage.includes('limit');
      const isServerError = errMessage.includes('500') || errMessage.includes('503') || errMessage.includes('timeout') || errMessage.includes('abort');
      
      if ((isRateLimit || isServerError) && attempt < maxRetries) {
        console.warn(`LLM request failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms... Error: ${errMessage}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // exponential backoff
      } else {
        throw err;
      }
    }
  }
  throw new Error('LLM call failed after exhausting all retries.');
}

function parseJsonResponse(text: string): LlmBatchResult {
  try {
    // Strip markdown formatting if present
    const cleaned = text.replace(/```json|```/g, '').trim();
    const json = JSON.parse(cleaned);
    
    // Validate with Zod
    const parsed = LlmBatchResultSchema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    } else {
      console.warn('Zod validation failed for LLM response:', parsed.error.message);
      return { results: [] };
    }
  } catch (err: any) {
    console.error('JSON parse failed:', err.message);
    return { results: [] };
  }
}

function buildPrompt(chunks: Array<{ id: string; text: string }>): string {
  const formattedChunks = chunks
    .map((c) => `--- CHUNK_ID: ${c.id} ---\n${c.text}`)
    .join('\n\n');

  return `Du är en expert på svensk miljölagstiftning och tillsyn. Analysera följande textavsnitt (chunks) och extrahera alla mätbara gränsvärden, halter av miljögifter (kemiska ämnen), lagringsvolymer och bullernivåer.

Mappa parametrar till följande exakta typer ('parameterTyp'):
- PFAS_4, PFAS_11, BLY, ZINK, KOBOLT, KADMIUM, ARSENIK, KOPPAR, NICKEL, KROM, KVICKSILVER, BENS_A_PYREN, PAH_H, PAH_M, PAH_L, OLJA, TOC
- VOLYM_SCHAKT (för tillåten mängd massor)
- MELLANLAGRING_VOLYM (för lagringskapacitet på platta)
- MELLANLAGRING_TID (för maximal lagringstid)
- BULLER (för dBA-krav)

Mappa enheter till ('enhet'):
- UG_L (för µg/l), MG_KG_TS (för mg/kg TS, mg/kg), TON (för ton), DBA (för dBA, dB(A)), MANADER (för månader), AR (för år), M3 (för m3, kubikmeter)

Mappa operatörer till ('comparisonOperator'):
- LT (<), LTE (<=), GT (>), GTE (>=), EQ (=), BETWEEN (för intervall)

TEXTAVSNITT ATT ANALYSERA:
${formattedChunks}

Svara ENBART med ett giltigt JSON-objekt med följande struktur:
{
  "results": [
    {
      "chunkId": "id-på-chunken",
      "limits": [
        {
          "parameterTyp": "PFAS_4" | "BLY" | "VOLYM_SCHAKT" | "BULLER" etc,
          "gransvarde": 0.15 (Float-siffervärde),
          "enhet": "UG_L" | "MG_KG_TS" | "TON" | "DBA" | "MANADER" | "AR" | "M3",
          "comparisonOperator": "LT" | "LTE" | "GT" | "GTE" | "EQ" | "BETWEEN",
          "sourceText": "exakt mening från texten där kravet framgår",
          "originalValue": "t.ex. '0,15 µg/l' eller 'maximalt 10 000 ton'",
          "confidence": 0.0-1.0 (din bedömning av extraktionens säkerhet)
        }
      ]
    }
  ]
}

VIKTIGT: Returnera enbart det giltiga JSON-objektet. Om en chunk inte innehåller några gränsvärden eller krav, returnera en tom lista för den chunken: "limits": [].`;
}

async function run() {
  const modelVersion = geminiAvailable ? 'gemini-flash-latest' : 'gpt-4o-mini';
  const promptVersion = 'v2_batched_traceable_checkpointed';
  const extractedBy = 'gemini-pipeline';

  console.log(`Starting robust batched parameter extraction pipeline...`);
  console.log(`Limit: ${limit}, Batch size: ${batchSize}, Dry-run: ${dryRun}`);
  console.log(`Model version: ${modelVersion}`);

  if (!geminiAvailable && !openaiAvailable) {
    console.error('No LLM API keys found in environment variables (GEMINI_API_KEY / OPENAI_API_KEY).');
    process.exit(1);
  }

  // Expanded Swedish regulatory vocabulary keywords
  const keywords = [
    'pfas', 'gränsvärde', 'halt', 'mg/kg', 'µg/l', 'ton', 'volym', 'buller', 'dba', 
    'max', 'maximal', 'skall', 'ska', 'riktvärde', 'överskrida', 'högst', 'lägst', 
    'får inte överstiga', 'ska understiga', 'koncentration', 'kg TS', 'm³'
  ];

  // Find candidate chunks that haven't been processed yet (checkpointing)
  const chunks = await prisma.documentChunk.findMany({
    where: {
      parametersExtracted: false,
      OR: keywords.map(kw => ({
        chunkText: {
          contains: kw,
          mode: 'insensitive'
        }
      }))
    },
    take: limit,
    select: {
      id: true,
      chunkText: true,
    }
  });

  console.log(`Found ${chunks.length} candidate chunks for extraction.`);

  if (chunks.length === 0) {
    console.log('No new chunks to process.');
    return;
  }

  // Batch process chunks
  let processedCount = 0;
  let parametersStored = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const chunkBatch = chunks.slice(i, i + batchSize);
    console.log(`\n--- Processing Batch ${Math.floor(i / batchSize) + 1} (${chunkBatch.length} chunks) ---`);
    
    const prompt = buildPrompt(chunkBatch.map(c => ({ id: c.id, text: c.chunkText })));
    
    try {
      const batchResult = geminiAvailable 
        ? await callLlmWithBackoff(prompt, 'gemini')
        : await callLlmWithBackoff(prompt, 'openai');

      for (const chunkResult of batchResult.results) {
        const chunk = chunkBatch.find(c => c.id === chunkResult.chunkId);
        if (!chunk) continue;

        console.log(`Chunk ${chunk.id}: Extracted ${chunkResult.limits.length} parameters.`);

        if (chunkResult.limits.length > 0) {
          if (!dryRun) {
            for (const limit of chunkResult.limits) {
              try {
                // Upsert to prevent duplicate records
                await prisma.kravParametrar.upsert({
                  where: {
                    chunkId_parameterTyp_gransvarde_enhet_comparisonOperator: {
                      chunkId: chunk.id,
                      parameterTyp: limit.parameterTyp,
                      gransvarde: limit.gransvarde,
                      enhet: limit.enhet,
                      comparisonOperator: limit.comparisonOperator,
                    }
                  },
                  update: {
                    sourceText: limit.sourceText,
                    confidence: limit.confidence,
                    originalValue: limit.originalValue,
                    extractedBy,
                    modelVersion,
                    promptVersion,
                    processedAt: new Date(),
                  },
                  create: {
                    chunkId: chunk.id,
                    parameterTyp: limit.parameterTyp,
                    gransvarde: limit.gransvarde,
                    enhet: limit.enhet,
                    comparisonOperator: limit.comparisonOperator,
                    sourceText: limit.sourceText,
                    confidence: limit.confidence,
                    originalValue: limit.originalValue,
                    extractedBy,
                    modelVersion,
                    promptVersion,
                  }
                });
                parametersStored++;
              } catch (err: any) {
                console.error(`Failed to upsert parameter for chunk ${chunk.id}:`, err.message);
              }
            }
          } else {
            console.log(`[DRY-RUN] Limits for chunk ${chunk.id}:`, JSON.stringify(chunkResult.limits, null, 2));
          }
        }
        
        // Mark chunk as processed (checkpointing)
        if (!dryRun) {
          await prisma.documentChunk.update({
            where: { id: chunk.id },
            data: { parametersExtracted: true }
          });
        }
        
        processedCount++;
      }
    } catch (e: any) {
      console.error(`Batch processing failed:`, e.message);
    }
  }

  console.log(`\nExtraction finished. Chunks processed: ${processedCount}. Parameters stored/updated: ${parametersStored}.`);
  await prisma.$disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
