/**
 * ragSearchService.ts
 *
 * Generell RAG-sökning (Retrieval-Augmented Generation) för slutanvändare.
 *
 * Flöde:
 *   1. Konvertera fråga till inbäddning
 *   2. Hämta topp-semantiska dokumentfragment
 *   3. Sök parallellt i kunskapsgrafen
 *   4. Kombinera kontext och generera svar via Gemini
 *   5. Returnera svar + källhänvisningar
 *
 * Endpoint: POST /api/search/rag
 */

import { embedText } from './searchService';
import { queryTopSemanticChunks } from '../repositories/searchRepository';
import { searchGraph } from './knowledgeGraphService';
import { logger } from '../logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RagSource {
  documentId: string;
  chunkId: string;
  snippet: string;
  score: number;
  documentName?: string;
}

export interface RagGraphNode {
  id: string;
  nodeType: string;
  name: string;
}

export interface RagSearchResult {
  answer: string;
  sources: RagSource[];
  graphNodes: RagGraphNode[];
  queryEmbeddingModel: string;
  generatedAt: string;
  fallback: boolean;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Kör RAG-sökning mot kunskapsbasen och generera ett svar.
 */
export async function runRagSearch(params: {
  query: string;
  projectId?: string;
  limit?: number;
  language?: 'sv' | 'en';
}): Promise<RagSearchResult> {
  const limit = Math.min(params.limit ?? 10, 20);
  const generatedAt = new Date().toISOString();
  const lang = params.language ?? 'sv';

  // Step 1: Embed query
  const embedding = await embedText(params.query);
  const embeddingModel = embedding?.model ?? 'none';

  // Step 2: Semantic document search
  let sources: RagSource[] = [];
  if (embedding && embedding.values.length > 0) {
    try {
      const chunks = await queryTopSemanticChunks({
        queryEmbedding: embedding.values,
        limit,
      });
      sources = chunks.map((c) => ({
        documentId: c.documentId,
        chunkId: String(c.chunkIndex),
        snippet: c.chunkText?.slice(0, 400) ?? '',
        score: c.similarity ?? 0,
      }));
    } catch (err) {
      logger.warn('rag-search: semantic chunk query failed', { err: String(err) });
    }
  }

  // Step 3: Knowledge graph search
  let graphNodes: RagGraphNode[] = [];
  try {
    const graphResult = await searchGraph({ query: params.query, limit: 15 });
    graphNodes = graphResult.nodes.map((n) => ({
      id: n.id,
      nodeType: n.nodeType,
      name: n.name,
    }));
  } catch (err) {
    logger.warn('rag-search: graph search failed', { err: String(err) });
  }

  // Step 4: Generate answer
  const context = sources
    .map((s, i) => `[Källa ${i + 1}, dok:${s.documentId}]\n${s.snippet}`)
    .join('\n\n---\n\n');

  const graphContext = graphNodes
    .slice(0, 5)
    .map((n) => `${n.nodeType}: ${n.name}`)
    .join(', ');

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.VITE_GEMINI_API_KEY;
  let answer = '';
  let fallback = false;

  if (apiKey && (context || graphContext)) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const systemLang = lang === 'sv' ? 'svenska' : 'English';
      const prompt = `Du är en expert på svensk miljörätt och miljöbeslut.
Svara på följande fråga baserat ENBART på den givna kontexten. Svara på ${systemLang}.
Om kontexten inte innehåller svaret, säg det tydligt.

Fråga: ${params.query}

Kontext från dokument:
${context || '(inga dokumentfragment funna)'}

Relevanta noder i kunskapsgrafen: ${graphContext || '(inga)'}

Svar (max 400 ord):`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });
      answer = response.text?.trim() ?? '';
    } catch (err) {
      logger.warn('rag-search: Gemini generation failed', { err: String(err) });
    }
  }

  if (!answer) {
    fallback = true;
    answer = sources.length > 0
      ? `Baserat på tillgängliga dokument: ${sources[0].snippet.slice(0, 300)}…`
      : `Inga relevanta dokument hittades för frågan "${params.query}". Kontrollera att dokument är indexerade.`;
  }

  return {
    answer,
    sources,
    graphNodes,
    queryEmbeddingModel: embeddingModel,
    generatedAt,
    fallback,
  };
}
