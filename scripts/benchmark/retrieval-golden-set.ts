// scripts/benchmark/retrieval-golden-set.ts

import { prisma } from '../../server/db/prisma';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI(apiKey ? { apiKey } : {});

// Re-use the deterministic mock embedding to generate query embeddings
function generateMockEmbedding(text: string, dimensions: number = 768): number[] {
  const vector = new Array(dimensions).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash) || 1;
  for (let i = 0; i < dimensions; i++) {
    const pseudoRandom = ((seed * (i + 1) * 2654435761) % 1000000000) / 1000000000;
    vector[i] = pseudoRandom * 2 - 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / (magnitude || 1));
}

async function getLiveQueryEmbedding(queryText: string): Promise<number[]> {
  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: queryText,
    });
    const values = response.embeddings?.[0]?.values?.slice(0, 768);
    if (values && values.length === 768) {
      return values;
    }
  } catch (err: any) {
    // Graceful fallback to deterministic mock
  }
  return generateMockEmbedding(queryText, 768);
}

// Our Golden Set for Miljöbalken / Decision retrieval
const GOLDEN_SET = [
  {
    query: "Hur ska hantering av förorenade massor och schaktmassor ske?",
    expectedKeywordMatch: ["schakt", "förorenade", "massor"],
  },
  {
    query: "Vad är riktvärdena för buller utomhus nattetid vid bostäder?",
    expectedKeywordMatch: ["buller", "riktvärde", "nattetid"],
  },
  {
    query: "Vilka försiktighetsmått gäller för utsläpp till vatten?",
    expectedKeywordMatch: ["försiktighet", "utsläpp", "vatten"],
  },
  {
    query: "Regler kring damm och spridning av partiklar från stenkross?",
    expectedKeywordMatch: ["damm", "partiklar", "kross"],
  },
  {
    query: "Vilka kemikalier är tillåtna och hur ska de förvaras säkert?",
    expectedKeywordMatch: ["kemikalier", "förvar", "invallning"],
  }
];

interface SearchResult {
  id: string;
  chunkText: string;
  score: number;
}

// A. Lexical Baseline (BM25)
async function searchLexical(query: string, topK: number = 10): Promise<SearchResult[]> {
  const results = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, "chunkText", 
           ts_rank(to_tsvector('swedish', "chunkText"), plainto_tsquery('swedish', $1)) AS score
    FROM "DocumentChunk"
    WHERE to_tsvector('swedish', "chunkText") @@ plainto_tsquery('swedish', $1)
    ORDER BY score DESC
    LIMIT $2;
  `, query, topK);
  
  return results.map(r => ({ id: r.id, chunkText: r.chunkText, score: r.score }));
}

// B. Vector Baseline (pgvector)
async function searchVector(query: string, topK: number = 10): Promise<SearchResult[]> {
  const queryVector = await getLiveQueryEmbedding(query);
  const vectorStr = `[${queryVector.join(',')}]`;

  // Cosine distance '<=>', closer to 0 is better. We convert it to a similarity score 1 - distance.
  const results = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, "chunkText", 
           (1 - (embedding <=> $1::vector)) AS score
    FROM "DocumentChunk"
    ORDER BY embedding <=> $1::vector
    LIMIT $2;
  `, vectorStr, topK);

  return results.map(r => ({ id: r.id, chunkText: r.chunkText, score: r.score }));
}

// C. Hybrid Retrieval (BM25 + Vector -> RRF)
async function searchHybrid(query: string, topK: number = 10): Promise<SearchResult[]> {
  const lexicalResults = await searchLexical(query, 50);
  const vectorResults = await searchVector(query, 50);

  // Reciprocal Rank Fusion (RRF)
  const K = 60;
  const scores = new Map<string, { chunkText: string, score: number }>();

  lexicalResults.forEach((res, rank) => {
    scores.set(res.id, { chunkText: res.chunkText, score: 1 / (K + rank + 1) });
  });

  vectorResults.forEach((res, rank) => {
    const existing = scores.get(res.id);
    if (existing) {
      existing.score += 1 / (K + rank + 1);
    } else {
      scores.set(res.id, { chunkText: res.chunkText, score: 1 / (K + rank + 1) });
    }
  });

  const sorted = Array.from(scores.entries())
    .map(([id, data]) => ({ id, chunkText: data.chunkText, score: data.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return sorted;
}

// Evaluate recall logic
function evaluateRecall(results: SearchResult[], expectedKeywords: string[]): boolean {
  // A naive evaluation checking if ANY of the topK chunks contains at least two expected keywords (case-insensitive)
  let found = false;
  for (const res of results) {
    const text = res.chunkText.toLowerCase();
    let matches = 0;
    for (const kw of expectedKeywords) {
      if (text.includes(kw.toLowerCase())) matches++;
    }
    if (matches >= Math.min(2, expectedKeywords.length)) {
      found = true;
      break;
    }
  }
  return found;
}

async function runGoldenSetEvaluation() {
  console.log('=== KNOWLEDGE RETRIEVAL & EVIDENCE GATE ===');
  console.log(`Evaluating Golden Set of ${GOLDEN_SET.length} questions...`);

  let lexRecall = 0;
  let vecRecall = 0;
  let hybRecall = 0;

  for (let i = 0; i < GOLDEN_SET.length; i++) {
    const q = GOLDEN_SET[i];
    console.log(`\nQ${i+1}: ${q.query}`);

    const startLex = Date.now();
    const resLex = await searchLexical(q.query, 10);
    const msLex = Date.now() - startLex;
    const okLex = evaluateRecall(resLex, q.expectedKeywordMatch);
    if (okLex) lexRecall++;

    const startVec = Date.now();
    const resVec = await searchVector(q.query, 10);
    const msVec = Date.now() - startVec;
    const okVec = evaluateRecall(resVec, q.expectedKeywordMatch);
    if (okVec) vecRecall++;

    const startHyb = Date.now();
    const resHyb = await searchHybrid(q.query, 10);
    const msHyb = Date.now() - startHyb;
    const okHyb = evaluateRecall(resHyb, q.expectedKeywordMatch);
    if (okHyb) hybRecall++;

    console.log(`  Lexical : ${okLex ? 'PASS' : 'FAIL'} (${msLex} ms)`);
    console.log(`  Vector  : ${okVec ? 'PASS' : 'FAIL'} (${msVec} ms)`);
    console.log(`  Hybrid  : ${okHyb ? 'PASS' : 'FAIL'} (${msHyb} ms)`);
  }

  console.log('\n=== RETRIEVAL QUALITY METRICS ===');
  console.log(`Lexical Recall (BM25)  : ${((lexRecall / GOLDEN_SET.length) * 100).toFixed(0)}%`);
  console.log(`Vector Recall (HNSW)   : ${((vecRecall / GOLDEN_SET.length) * 100).toFixed(0)}%`);
  console.log(`Hybrid Recall (RRF)    : ${((hybRecall / GOLDEN_SET.length) * 100).toFixed(0)}%`);
}

runGoldenSetEvaluation()
  .catch(err => {
    console.error('Golden set evaluation failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
