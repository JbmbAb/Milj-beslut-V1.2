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
import { DEFAULT_AI_POLICY, ragSystemInstruction } from '../modules/ai/policy';
import { getAiProvider } from './aiProviderImplementation';

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
  explanation?: {
    searchMetadata: {
      embeddingModel: string;
      chunkCount: number;
      topScore: number;
    };
    contextSummary: string;
  };
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Kör en fullständig RAG-sökning (Retrieval-Augmented Generation).
 * 
 * Processen består av följande steg:
 * 1. Embedding: Konverterar användarens fråga till en vektor via Vertex AI.
 * 2. Retrieval: Söker efter de mest relevanta dokumentfragmenten (chunks) i databasen baserat på vektorsimilaritet.
 * 3. Contextualization: Hämtar relaterad information från kunskapsgrafen (municipality, waste types, etc.).
 * 4. Augmentation: Kombinerar dokumentchunks och graf-data till en prompt.
 * 5. Generation: Skickar prompten till Gemini för att generera ett faktabaserat svar med källhänvisningar.
 * 
 * @param params Sökparametrar inkl. fråga, organisations-ID och valfritt projekt-ID.
 * @param params.query Användarens sökfråga i fritext.
 * @param params.organisationId Organisationens ID för att begränsa sökrymden.
 * @param params.projectId Valfritt projekt-ID för att prioritera dokument inom ett specifikt projekt.
 * @param params.limit Antal källor att hämta (standard 10).
 * @param params.language Svarsspråk ('sv' eller 'en').
 * @param params.explain Om true, inkluderas detaljerad metadata om sökningen i svaret.
 * 
 * @returns Ett objekt som innehåller det genererade svaret, källhänvisningar och (om explain=true) sökmetadata.
 */
export async function runRagSearch(params: {
  query: string;
  organisationId: string;
  projectId?: string;
  limit?: number;
  language?: 'sv' | 'en';
  explain?: boolean;
}): Promise<RagSearchResult> {
  const limit = Math.min(params.limit ?? 10, 20);
  const generatedAt = new Date().toISOString();
  const lang = params.language ?? 'sv';
  const shouldExplain = params.explain ?? false;

  // Step 1: Embed query
  let embedding: any = null;
  try {
    embedding = await embedText(params.query);
  } catch (err) {
    logger.warn('rag-search: embedding failed', { err: String(err) });
  }
  const embeddingModel = embedding?.model ?? 'none';

  // Step 2: Semantic document search
  let sources: RagSource[] = [];
  let topScore = 0;
  if (embedding && embedding.values.length > 0) {
    try {
      const chunks = await queryTopSemanticChunks({
        queryEmbedding: embedding.values,
        organisationId: params.organisationId,
        projectId: params.projectId,
        limit,
      });
      sources = chunks.map((c) => ({
        documentId: c.documentId,
        chunkId: `${c.documentId}:${c.chunkIndex}`,
        snippet: c.chunkText?.slice(0, 400) ?? '',
        score: c.similarity ?? 0,
      }));
      if (sources.length > 0) {
        topScore = sources[0].score;
      }
    } catch (err) {
      logger.warn('rag-search: semantic chunk query failed', { err: String(err) });
    }
  }

  // Step 3: Knowledge graph search
  let graphNodes: RagGraphNode[] = [];
  try {
    const graphResult = await searchGraph({ query: params.query, limit: 15 });
    graphNodes = (graphResult.nodes || []).map((n: any) => ({
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

  let answer = '';
  let fallback = false;

  if (process.env.VERTEX_PROJECT_ID?.trim() && (context || graphContext)) {
    try {
      const systemLang = lang === 'sv' ? 'svenska' : 'English';
      const systemInstruction = ragSystemInstruction(DEFAULT_AI_POLICY);
      const prompt = `Svara på ${systemLang}.

Fråga: ${params.query}

Kontext från dokument:
${context || '(inga dokumentfragment funna)'}

Relevanta noder i kunskapsgrafen: ${graphContext || '(inga)'}

Returnera ett svar med korta punkter och inkludera källhänvisningar (Källa 1, Källa 2...) när du använder dem.`;

      const aiProvider = getAiProvider();
      const response = await aiProvider.generateText(prompt, {
        profile: 'fast',
        systemInstruction,
      });
      answer = response.text.trim();
    } catch (err) {
      logger.warn('rag-search: AI generation failed', { err: String(err) });
    }
  }

  if (!answer) {
    fallback = true;
    answer =
      sources.length > 0
        ? `Baserat på tillgängliga dokument: ${sources[0].snippet.slice(0, 300)}…`
        : `Inga relevanta dokument hittades för frågan "${params.query}". Kontrollera att dokument är indexerade.`;
  }

  const result: RagSearchResult = {
    answer,
    sources,
    graphNodes,
    queryEmbeddingModel: embeddingModel,
    generatedAt,
    fallback,
  };

  if (shouldExplain) {
    result.explanation = {
      searchMetadata: {
        embeddingModel,
        chunkCount: sources.length,
        topScore: sources.length > 0 ? sources[0].score : 0,
      },
      contextSummary: `Inkluderade ${sources.length} dokumentsegment och ${graphNodes.length} kunskapsnoder.`,
    };
  }

  return result;
}
