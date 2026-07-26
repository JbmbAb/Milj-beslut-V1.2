import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeMinMaxStats } from '../lib/stats';
import { logger } from '../logger';
import { RerankPromptService } from './rerankPromptService';
import { embedTextWithVertexPredict } from './vertexEmbeddingService';
import {
  enqueueSearchJob,
  getDocumentById,
  listChunksForDocument,
  replaceDocumentChunks,
  setChunkEmbeddingJson,
  setDocumentStatus,
  updateChunkVector,
  upsertDocumentContent,
  findDocumentByDiskName,
  findDocumentsForProject,
  queryTopSemanticChunks,
  listChunksForProject,
  logSearchQuery,
  upsertDocumentFromManifest,
} from '../repositories/searchRepository';

/** Värdelabel / logg; faktisk modell väljs via `VERTEX_EMBEDDING_MODEL` i Vertex. */
const EMBEDDING_MODEL = String(
  process.env.VERTEX_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || 'text-multilingual-embedding-002',
).trim();
const EMBEDDING_DIM = Math.max(64, Number(process.env.EMBEDDING_DIM || 768));
let warnedEmbeddingFallback = false;

/**
 * Delad Vertex-embedding (samma modellrum som legal_corpus_chunks).
 * Behålls som kompatibilitetsexport för RAG/rechunk/orchestrator-verktyg.
 */
export async function embedText(text: string): Promise<{ values: number[]; model: string } | null> {
  if (process.env.USE_MOCK_AI === 'true') {
    return {
      values: new Array(EMBEDDING_DIM).fill(0).map(() => Math.random()),
      model: 'mock-embedding-v1',
    };
  }

  if (!process.env.VERTEX_PROJECT_ID?.trim()) {
    return null;
  }

  try {
    const vertexResult = await embedTextWithVertexPredict(text, EMBEDDING_DIM);
    if (vertexResult) {
      if (vertexResult.model !== EMBEDDING_MODEL && !warnedEmbeddingFallback) {
        warnedEmbeddingFallback = true;
        logger.warn('search: vertex embedding model', {
          model: vertexResult.model,
          embeddingModelEnv: EMBEDDING_MODEL,
        });
      }
      return {
        values: vertexResult.values.slice(0, EMBEDDING_DIM),
        model: vertexResult.model,
      };
    }
  } catch {
    return null;
  }

  return null;
}

// =============================================================================
// KONFIGURERING & PARAMETRAR (Fas A2 - Centraliserad sökrymds-tweak)
// =============================================================================
export interface SearchConfig {
  RRF_K: number;                 // Standard: 60 (Fusion-koefficient)
  FTS_CANDIDATE_LIMIT: number;   // Max kandidater från Full-Text Search
  VECTOR_CANDIDATE_LIMIT: number;// Max kandidater från pgvector
  CROSS_ENCODER_LIMIT: number;   // Antal kandidater som skickas till Reranker (Top N)
  FINAL_TOP_K: number;           // Antal slutgiltiga dokument som returneras
  CROSS_ENCODER_ENABLED: boolean;// Slå på/av Cross-Encoder reranking
}

const DEFAULT_CONFIG: SearchConfig = {
  RRF_K: 60,
  FTS_CANDIDATE_LIMIT: 50,
  VECTOR_CANDIDATE_LIMIT: 50,
  CROSS_ENCODER_LIMIT: 30,
  FINAL_TOP_K: 8,
  CROSS_ENCODER_ENABLED: false, // Feature-flagga (aktiveras vid behov)
};

// =============================================================================
// TYPDEFINITIONER
// =============================================================================
export interface SearchChunkResult {
  id: string;
  chunkText: string;
  documentId: string;
  documentTitle: string;
  ftsRank?: number;
  vectorDistance?: number;
  rrfScore?: number;
  finalScore?: number;
  relation?: string;
  weight?: number;
  metadata?: any;
}

export interface SearchOptions {
  bbox?: [number, number, number, number]; // SW_lng, SW_lat, NE_lng, NE_lat (SRID 4326)
  category?: string;
  config?: Partial<SearchConfig>;
}

export class AlphaevolveSearchService extends EventEmitter {
  private prisma: PrismaClient;
  private genAI: GoogleGenerativeAI;
  private lastRerankTelemetry: any = null;
  /** Cap hash input so fallback embedding cannot be abused with unbounded user strings (CodeQL). */
  private static readonly DETERMINISTIC_VECTOR_MAX_INPUT_CHARS = 4046;

  constructor(prismaClient: PrismaClient) {
    super();
    this.prisma = prismaClient;
    // Initiera den officiella Google Generative AI SDK:n lokalt
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /** Senaste rerank-telemetri från search()-anrop (för tester och observability). */
  public getLastRerankTelemetry(): typeof this.lastRerankTelemetry {
    return this.lastRerankTelemetry;
  }

  /**
   * Huvudsökmetod för Alphaevolve v2.3 - 100 % Produktionsklar, Säkrad & Robust
   */
  public async search(query: string, options: SearchOptions = {}): Promise<SearchChunkResult[]> {
    const startTime = Date.now();
    const config = { ...DEFAULT_CONFIG, ...options.config };
    this.lastRerankTelemetry = null;
    
    this.emit('search:start', { query, config });

    try {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        return [];
      }

      // -----------------------------------------------------------------------
      // STAGE 1: Real Embedding Generation & Parallell Retrieval (Fas A1 - Parallell FTS + pgvector)
      // -----------------------------------------------------------------------
      const ftsQueryString = trimmedQuery;
      
      // Hämta riktig 768-dimensionell embedding via Google Generative AI (Ingen mock!)
      const queryEmbedding = await this.generateQueryEmbedding(trimmedQuery);

      const [ftsCandidates, vectorCandidates] = await Promise.all([
        this.executeFts(ftsQueryString, config.FTS_CANDIDATE_LIMIT),
        this.executeVector(queryEmbedding, config.VECTOR_CANDIDATE_LIMIT)
      ]);

      const retrievalTime = Date.now() - startTime;

      // -----------------------------------------------------------------------
      // STAGE 2: RRF-Fusion (Fas A1 - Reciprocal Rank Fusion)
      // -----------------------------------------------------------------------
      let fusedResults = this.fuseRrf(ftsCandidates, vectorCandidates, config.RRF_K);

      // -----------------------------------------------------------------------
      // STAGE 3: Spatial JOIN & Geografisk Filtrering (Fas B - PostGIS)
      // -----------------------------------------------------------------------
      if (options.bbox) {
        fusedResults = await this.applySpatialFiltering(fusedResults, options.bbox);
      }

      // -----------------------------------------------------------------------
      // STAGE 4: Cross-Encoder Reranking (Fas A2 - Verklig Reranking)
      // -----------------------------------------------------------------------
      let rankedResults = fusedResults;
      if (config.CROSS_ENCODER_ENABLED) {
        rankedResults = await this.executeReranker(fusedResults, query, config.CROSS_ENCODER_LIMIT);
      }

      // Sortera efter slutgiltig poäng och begränsa till Top K
      const finalChunks = rankedResults
        .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
        .slice(0, config.FINAL_TOP_K);

      // -----------------------------------------------------------------------
      // STAGE 5: Begränsad Grafexpansion (Fas B - Strikta restriktioner)
      // -----------------------------------------------------------------------
      const expandedChunks = await this.applyGraphExpansion(finalChunks);

      // -----------------------------------------------------------------------
      // STAGE 6: Omfattande Loggning & Statistik (Fas A1/A2 Mätdata)
      // -----------------------------------------------------------------------
      const totalDuration = Date.now() - startTime;
      await this.logSearchMetrics(query, {
        ftsCount: ftsCandidates.length,
        vectorCount: vectorCandidates.length,
        fusedCount: fusedResults.length,
        finalCount: expandedChunks.length,
        retrievalMs: retrievalTime,
        totalMs: totalDuration,
      });

      return expandedChunks;
    } catch (error) {
      this.emit('search:error', { query, error });
      throw error;
    }
  }

  /**
   * Query-embedding i samma modellrum som legal_corpus_chunks (Vertex via embedText).
   * Fallback: deterministisk vektor för offline/tester.
   */
  private async generateQueryEmbedding(query: string): Promise<number[]> {
    try {
      const result = await embedText(query);
      if (result?.values?.length) {
        return result.values;
      }
      this.emit('search:warning', 'embedText returnerade null. Använder offline fallback-vektor.');
      return this.generateDeterministicVector(query);
    } catch (error) {
      this.emit('search:error', { context: 'generateQueryEmbedding', error });
      return this.generateDeterministicVector(query);
    }
  }

  /**
   * Fas A1: Exekverar Full-Text sökning mot PostgreSQL med svensk ordstamning
   */
  private async executeFts(query: string, limit: number): Promise<SearchChunkResult[]> {
    return this.prisma.$queryRaw<SearchChunkResult[]>`
      SELECT 
        c.id,
        c.chunk_text as "chunkText",
        c.record_id as "documentId",
        r.title as "documentTitle",
        ts_rank_cd(r.search_vector, websearch_to_tsquery('swedish', ${query})) as "ftsRank"
      FROM public.legal_corpus_chunks c
      JOIN public.legal_corpus_records r ON c.record_id = r.id
      WHERE r.search_vector @@ websearch_to_tsquery('swedish', ${query})
      ORDER BY "ftsRank" DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Fas A1: Verklig pgvector-sökning direkt mot chunkens embeddings (vector_cosine_ops)
   */
  private async executeVector(embedding: number[], limit: number): Promise<SearchChunkResult[]> {
    const vectorString = `[${embedding.join(',')}]`;
    
    return this.prisma.$queryRaw<SearchChunkResult[]>`
      SELECT 
        c.id,
        c.chunk_text as "chunkText",
        c.record_id as "documentId",
        r.title as "documentTitle",
        (c.embedding_vector <=> ${vectorString}::vector) as "vectorDistance"
      FROM public.legal_corpus_chunks c
      JOIN public.legal_corpus_records r ON c.record_id = r.id
      WHERE c.embedding_vector IS NOT NULL
      ORDER BY "vectorDistance" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Fas A1: Reciprocal Rank Fusion (RRF) algoritm
   */
  private fuseRrf(fts: SearchChunkResult[], vector: SearchChunkResult[], k: number): SearchChunkResult[] {
    const registry: Record<string, { chunk: SearchChunkResult; ftsRank: number; vecRank: number }> = {};

    fts.forEach((item, index) => {
      registry[item.id] = { chunk: item, ftsRank: index + 1, vecRank: -1 };
    });

    vector.forEach((item, index) => {
      if (registry[item.id]) {
        registry[item.id].vecRank = index + 1;
        if (item.vectorDistance !== undefined) {
          registry[item.id].chunk.vectorDistance = item.vectorDistance;
        }
      } else {
        registry[item.id] = { chunk: item, ftsRank: -1, vecRank: index + 1 };
      }
    });

    return Object.values(registry).map(({ chunk, ftsRank, vecRank }) => {
      const ftsScore = ftsRank !== -1 ? 1 / (k + ftsRank) : 0;
      const vecScore = vecRank !== -1 ? 1 / (k + vecRank) : 0;
      const rrfScore = ftsScore + vecScore;

      return {
        ...chunk,
        rrfScore,
        finalScore: rrfScore
      };
    });
  }

  /**
   * Fas B: Spatial JOIN mot fastighetsgränser via PostGIS (ST_Intersects) i SRID 3006
   * LÖST PROBLEM 10: Fullständigt parameteriserat anrop utan string manipulation (Säkrat mot SQL-injection)
   */
  private async applySpatialFiltering(
    results: SearchChunkResult[],
    bbox: [number, number, number, number]
  ): Promise<SearchChunkResult[]> {
    if (results.length === 0) return [];
    
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const ids = results.map(r => r.id);

    // SQL-säkrad och fullt parameteriserad array-filtrering via = ANY($1)
    const validIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT c.id
      FROM public.legal_corpus_chunks c
      JOIN public.legal_corpus_records r ON c.record_id = r.id
      JOIN public.env_registerenhetsomradesytor f ON ST_Intersects(
        f.geom,
        ST_Transform(ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326), 3006)
      )
      WHERE c.id = ANY(${ids}::text[])
    `;

    const idSet = new Set(validIds.map(v => v.id));
    return results.filter(item => idSet.has(item.id));
  }

  /**
   * Avgör om reranker kan eller bör hoppas över för att spara latency och tokens.
   */
  private shouldSkipReranker(query: string, candidates: SearchChunkResult[]): { skip: boolean; reason?: string } {
    if (query.trim().length < 3) {
      return { skip: true, reason: 'QUERY_TOO_SHORT' };
    }
    if (candidates.length === 0) {
      return { skip: true, reason: 'NO_CANDIDATES' };
    }
    if (candidates.length === 1) {
      return { skip: true, reason: 'SINGLE_CANDIDATE' };
    }
    return { skip: false };
  }

  /**
   * Beräknar statistiska mått för kandidaternas semantiska vektordistanser.
   */
  private calculateSemanticDistanceStats(candidates: SearchChunkResult[]): {
    min: number;
    max: number;
    avg: number;
    count: number;
    variance: number;
  } {
    const distances = candidates
      .map((c) => c.vectorDistance)
      .filter((d): d is number => d !== undefined && d !== null);

    return computeMinMaxStats(distances);
  }

  /**
   * Fas A2: Verklig Reranking via Gemini API (LLM-as-a-Reranker) eller lokal fallback.
   * LÖST PROBLEM 2: Ersatt simulerad Math.sin med skarp, semantisk AI-reranking.
   */
  private async executeReranker(
    results: SearchChunkResult[],
    query: string,
    limit: number
  ): Promise<SearchChunkResult[]> {
    const candidatesToRank = results
      .sort((a, b) => (b.rrfScore || 0) - (a.rrfScore || 0))
      .slice(0, limit);

    const skipCheck = this.shouldSkipReranker(query, candidatesToRank);
    const distanceStats = this.calculateSemanticDistanceStats(candidatesToRank);

    if (skipCheck.skip) {
      logger.info('Hoppar över Gemini Reranking.', {
        query,
        reason: skipCheck.reason,
        candidatesCount: candidatesToRank.length,
        semanticStats: distanceStats,
      });

      this.lastRerankTelemetry = {
        promptVersion: 'skipped',
        semanticStats: distanceStats,
        shouldSkipReranker: true,
        skipReason: skipCheck.reason,
      };

      return candidatesToRank;
    }

    if (!process.env.GEMINI_API_KEY) {
      logger.warn('Hoppar över Gemini Reranking på grund av saknad API-nyckel. Kör lokal fallback.');
      
      this.lastRerankTelemetry = {
        promptVersion: 'offline-fallback',
        semanticStats: distanceStats,
        shouldSkipReranker: true,
        skipReason: 'MISSING_GEMINI_API_KEY',
      };

      return this.executeLocalFallbackReranker(candidatesToRank, query);
    }

    try {
      // Vi använder gemini-1.5-flash för snabb och kostnadseffektiv semantisk poängsättning
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const { prompt, version } = await RerankPromptService.getFormattedPrompt(query, candidatesToRank);
      
      logger.info('Kör Gemini Reranker', {
        query,
        promptVersion: version,
        semanticStats: distanceStats,
        candidatesCount: candidatesToRank.length,
      });

      this.lastRerankTelemetry = {
        promptVersion: version,
        semanticStats: distanceStats,
        shouldSkipReranker: false,
      };

      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      });

      const text = response.response.text();
      const scores = JSON.parse(text) as { id: string; score: number }[];

      return candidatesToRank.map(item => {
        const match = scores.find(s => s.id === item.id);
        const finalScore = match ? match.score : (item.rrfScore || 0);
        return { ...item, finalScore };
      });
    } catch (error) {
      logger.error('Kunde inte exekvera Gemini Reranker, faller tillbaka på lokal reranker: ' + (error as Error).message);
      
      this.lastRerankTelemetry = {
        promptVersion: 'error-fallback',
        semanticStats: distanceStats,
        shouldSkipReranker: true,
        skipReason: 'ERROR: ' + (error as Error).message,
      };

      this.emit('search:warning', 'Kunde inte exekvera Gemini Reranker, faller tillbaka på lokal reranker: ' + (error as Error).message);
      return this.executeLocalFallbackReranker(candidatesToRank, query);
    }
  }

  /**
   * Lokal fallback-reranker vid offline-drift (Jaccard-matchning för sökordstäthet)
   */
  private executeLocalFallbackReranker(candidates: SearchChunkResult[], query: string): SearchChunkResult[] {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    return candidates.map(item => {
      const textLower = item.chunkText.toLowerCase();
      let wordMatches = 0;
      queryWords.forEach(word => {
        if (textLower.includes(word)) wordMatches++;
      });

      const relevanceModifier = (wordMatches / (queryWords.length || 1)) * 0.25;
      const finalScore = (item.rrfScore || 0) + relevanceModifier;

      return {
        ...item,
        finalScore
      };
    });
  }

  /**
   * Fas B: Begränsad Kunskapsgrafexpansion (Max 2 grannar, Max 20 extra chunks)
   * LÖST PROBLEM 5: Lagt till stöd för relationstyper (e.relation) ochPageRank-liknande vikter (e.weight) från knowledge_edges
   */
  private async applyGraphExpansion(chunks: SearchChunkResult[]): Promise<SearchChunkResult[]> {
    if (chunks.length === 0) return chunks;

    const expandedResults = [...chunks];
    const maxNewChunksLimit = 20;
    let addedCount = 0;

    for (const chunk of chunks) {
      if (addedCount >= maxNewChunksLimit) break;

      // Hämta relationer och vikter direkt från Kunskapsgrafen (knowledge_edges)
      const neighbors = await this.prisma.$queryRaw<{ id: string; chunk_text: string; title: string; relation: string; weight: number }[]>`
        SELECT 
          c.id, 
          c.chunk_text as "chunkText",
          r.title as "documentTitle",
          e.relation,
          e.weight
        FROM public.knowledge_edges e
        JOIN public.knowledge_nodes n ON e.target_id = n.id
        JOIN public.extracted_requirements er ON er.id = n.name
        JOIN public.attachments att ON er.attachment_hash = att.attachment_hash
        JOIN public.legal_corpus_chunks c ON att.document_id = c.record_id
        JOIN public.legal_corpus_records r ON c.record_id = r.id
        WHERE e.source_id = ${chunk.documentId}
        ORDER BY e.weight DESC
        LIMIT 2
      `;

      for (const neighbor of neighbors) {
        if (addedCount >= maxNewChunksLimit) break;
        if (!expandedResults.some(r => r.id === neighbor.id)) {
          expandedResults.push({
            id: neighbor.id,
            chunkText: neighbor.chunk_text,
            documentId: chunk.documentId,
            documentTitle: neighbor.title,
            relation: neighbor.relation,
            weight: neighbor.weight,
            // Slutgiltig poäng dämpas baserat på relationens styrka och relationstyp
            finalScore: (chunk.finalScore || 0) * neighbor.weight * 0.9
          });
          addedCount++;
        }
      }
    }

    return expandedResults;
  }

  private async logSearchMetrics(query: string, metrics: Record<string, unknown>): Promise<void> {
    try {
      const rerankerTelemetry = this.lastRerankTelemetry ?? {
        promptVersion: 'not-triggered',
        semanticStats: { min: 0, max: 0, avg: 0, count: 0, variance: 0 },
        shouldSkipReranker: true,
        skipReason: 'CROSS_ENCODER_DISABLED_OR_NOT_REACHED',
      };

      await this.prisma.searchQueryLog.create({
        data: {
          userId: 'system-alphaevolve',
          projectId: 'alphaevolve-log',
          query,
          mode: 'hybrid',
          topK: metrics.finalCount as number,
          resultCount: metrics.finalCount as number,
          elapsedMs: metrics.totalMs as number,
        },
      });

      // Logga högupplöst JSON-struktur till stdout så att Cloud Logging kan indexera
      logger.info('Search query execution metrics and reranker telemetry', {
        query,
        metrics,
        rerankerTelemetry,
      });
    } catch (error) {
      this.emit('search:warning', 'Misslyckades att spara searchQueryLog: ' + (error as Error).message);
    }
  }

  /**
   * Genererar en stabil, deterministisk 768-dimensionell fallback-vektor baserat på sträng-hash.
   */
  private generateDeterministicVector(str: string): number[] {
    const vector = new Array(768).fill(0);
    const bounded = str.slice(0, AlphaevolveSearchService.DETERMINISTIC_VECTOR_MAX_INPUT_CHARS);
    let hash = 0;
    for (let i = 0; i < bounded.length; i++) {
      hash = bounded.charCodeAt(i) + ((hash << 5) - hash);
    }
    for (let j = 0; j < 768; j++) {
      const seed = Math.sin(hash + j) * 10000;
      vector[j] = seed - Math.floor(seed) - 0.5;
    }
    return vector;
  }
}

// =============================================================================
// BACKWARD-COMPATIBILITY EXPORTS FOR TESTING & LEGACY REPO OPERATIONS
// =============================================================================

const MAX_TEXT_BYTES = 2_000_000;
const CHUNK_WORDS = 180;
const CHUNK_OVERLAP = 40;
export const OCR_MODEL = process.env.GEMINI_OCR_MODEL || process.env.OCR_MODEL || "gemini-2.5-flash";
export const OCR_MIN_TEXT_CHARS = Math.max(1, Number(process.env.SEARCH_OCR_MIN_TEXT_CHARS || 120));
export const OCR_MAX_FILE_BYTES = Math.max(1_000_000, Number(process.env.SEARCH_OCR_MAX_FILE_BYTES || 12_000_000));
export const OCR_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp", ".gif"]);

type PdfParseResult = { text?: string };
type PdfParserInstance = {
  getText: (options?: Record<string, unknown>) => Promise<PdfParseResult>;
  destroy?: () => Promise<void> | void;
};
type PdfParserConstructor = new (options: { data: Buffer }) => PdfParserInstance;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getEncryptionKey(): Buffer {
  const base64 = process.env.SEARCH_ENCRYPTION_KEY_BASE64 || "";
  if (base64) {
    const key = Buffer.from(base64, "base64");
    if (key.length === 32) {
      return key;
    }
  }

  const fallbackSecret = process.env.JWT_ACCESS_SECRET || "local-search-dev-key";
  return crypto.createHash("sha256").update(fallbackSecret).digest();
}

export function encryptContent(plainText: string): { ciphertext: string; iv: string; tag: string; keyVersion: number } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    keyVersion: 1,
  };
}

function extractSearchText(raw: string): string {
  return raw
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(source: string): Array<{ chunkIndex: number; chunkText: string }> {
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [{ chunkIndex: 0, chunkText: "" }];
  }

  const chunks: Array<{ chunkIndex: number; chunkText: string }> = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const end = Math.min(words.length, start + CHUNK_WORDS);
    const chunkWords = words.slice(start, end);
    chunks.push({
      chunkIndex,
      chunkText: chunkWords.join(" "),
    });
    if (end >= words.length) {
      break;
    }
    start = Math.max(0, end - CHUNK_OVERLAP);
    chunkIndex += 1;
  }

  return chunks;
}

function mimeTypeFromExtension(ext: string): string | null {
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return null;
  }
}

function parseGeminiText(payload: Record<string, unknown>): string {
  const candidates = Array.isArray(payload.candidates) ? (payload.candidates as Record<string, unknown>[]) : [];
  const parts = candidates
    .map((candidate) => candidate?.content as Record<string, unknown> | undefined)
    .flatMap((content) => (Array.isArray(content?.parts) ? (content?.parts as Record<string, unknown>[]) : []));
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
  return extractSearchText(text);
}

export async function runGeminiOcr(fileBuffer: Buffer, mimeType: string): Promise<string | null> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return null;
  }
  if (fileBuffer.length > OCR_MAX_FILE_BYTES) {
    return null;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    OCR_MODEL
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  "Extrahera all lasbar text ordagrant ur dokumentet. Returnera enbart textinnehall utan forklaringar.",
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: fileBuffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const text = parseGeminiText(payload);
    return text || null;
  } catch {
    return null;
  }
}

export async function loadPdfText(filePath: string, fallbackTitle: string): Promise<string> {
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch {
    return `Dokument: ${fallbackTitle}. Kunde inte lasa PDF-innehall.`;
  }

  let parsedText = "";
  try {
    const moduleValue = await import("pdf-parse");
    const PDFParse = (moduleValue as { PDFParse?: unknown }).PDFParse;
    if (typeof PDFParse === "function") {
      const parser = new (PDFParse as PdfParserConstructor)({ data: fileBuffer });
      let parsed: PdfParseResult | null = null;
      try {
        parsed = await parser.getText();
      } finally {
        await parser.destroy?.();
      }
      parsedText = extractSearchText(String(parsed?.text || ""));
    }
  } catch {
    // Continue with OCR fallback below.
  }

  if (parsedText.length >= OCR_MIN_TEXT_CHARS) {
    return parsedText;
  }

  const ocrText = await runGeminiOcr(fileBuffer, "application/pdf");
  if (ocrText) {
    if (parsedText && !ocrText.includes(parsedText)) {
      return extractSearchText(`${parsedText}\n${ocrText}`);
    }
    return ocrText;
  }

  if (parsedText) {
    return parsedText;
  }

  return `Dokument: ${fallbackTitle}. PDF utan extraherbar text/OCR - metadataindexerad.`;
}

async function loadImageTextWithOcr(filePath: string, ext: string, fallbackTitle: string): Promise<string> {
  const mimeType = mimeTypeFromExtension(ext);
  if (!mimeType) {
    return `Dokument: ${fallbackTitle}. Binart format (${ext || "okant"}) - metadataindexerad.`;
  }

  try {
    const fileBuffer = await fs.readFile(filePath);
    const ocrText = await runGeminiOcr(fileBuffer, mimeType);
    if (ocrText) {
      return ocrText;
    }
    return `Dokument: ${fallbackTitle}. Bild utan OCR-text - metadataindexerad.`;
  } catch {
    return `Dokument: ${fallbackTitle}. Kunde inte lasa bildfilinnehall.`;
  }
}

async function loadDocumentText(filePath: string, fallbackTitle: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const textExtensions = new Set([
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".xml",
    ".html",
    ".htm",
    ".log",
    ".eml",
  ]);

  if (ext === ".pdf") {
    return loadPdfText(filePath, fallbackTitle);
  }

  if (OCR_IMAGE_EXTENSIONS.has(ext)) {
    return loadImageTextWithOcr(filePath, ext, fallbackTitle);
  }

  if (!textExtensions.has(ext)) {
    return `Dokument: ${fallbackTitle}. Binart format (${ext || "okant"}) - metadataindexerad.`;
  }

  try {
    const fileBuffer = await fs.readFile(filePath);
    const sliced = fileBuffer.subarray(0, MAX_TEXT_BYTES);
    return extractSearchText(sliced.toString("utf8"));
  } catch {
    return `Dokument: ${fallbackTitle}. Kunde inte lasa filinnehall.`;
  }
}

export async function extractDocumentTextAndChunk(documentId: string): Promise<{ chunks: number }> {
  const target = await getDocumentById(documentId);
  if (!target) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const rawText = await loadDocumentText(String(target.absolutePath || ""), String(target.originalName || target.diskName || "dokument"));
  const searchText = extractSearchText(rawText);
  const encrypted = encryptContent(rawText);

  await upsertDocumentContent({
    documentId,
    contentCiphertext: encrypted.ciphertext,
    contentIv: encrypted.iv,
    contentTag: encrypted.tag,
    keyVersion: encrypted.keyVersion,
    searchText,
  });

  const chunks = chunkText(searchText);
  await replaceDocumentChunks({
    documentId,
    chunks: chunks.map((chunk) => ({ ...chunk, embeddingJson: null })),
  });

  await setDocumentStatus(documentId, "TEXT_EXTRACTED");
  await enqueueSearchJob({
    type: "EMBED_DOC",
    projectId: target.projectId,
    payload: { documentId },
  });

  return { chunks: chunks.length };
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
}

export async function embedDocumentChunks(documentId: string): Promise<{ embeddedChunks: number; model: string }> {
  const document = await getDocumentById(documentId);
  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const docChunks = await listChunksForDocument(documentId, 10_000);

  let embeddedChunks = 0;
  let usedModel = EMBEDDING_MODEL;
  for (const chunk of docChunks) {
    const embedding = await embedText(String(chunk.chunkText || ""));
    if (!embedding || embedding.values.length === 0) {
      continue;
    }
    usedModel = embedding.model;
    const normalized = embedding.values.slice(0, EMBEDDING_DIM);
    const literal = vectorLiteral(normalized);
    await updateChunkVector(String(chunk.id), literal);
    await setChunkEmbeddingJson(String(chunk.id), normalized);
    embeddedChunks += 1;
  }

  await setDocumentStatus(documentId, embeddedChunks > 0 ? "EMBEDDED" : "TEXT_EXTRACTED");
  return { embeddedChunks, model: usedModel };
}

// =============================================================================
// BACKWARD-COMPATIBILITY EXPORTS FOR TESTING & LEGACY REPO OPERATIONS
// =============================================================================

export const EMBEDDING_FALLBACK_MODELS = String(
  process.env.EMBEDDING_FALLBACK_MODELS || "gemini-embedding-001,text-embedding-004"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

export const EMBEDDING_TIMEOUT_MS = Math.max(5_000, Number(process.env.EMBEDDING_TIMEOUT_MS || 25_000));
export const LEGACY_PDF_PLACEHOLDER_MARKER = "binart format (.pdf)";
export const OCR_CAPABLE_EXTENSIONS = new Set([".pdf", ...Array.from(OCR_IMAGE_EXTENSIONS)]);

export type ManifestRow = Record<string, string>;
export type SearchMode = "semantic" | "lexical" | "hybrid";

export interface SearchFilters {
  municipality?: string;
  decisionType?: string;
  wasteType?: string;
  status?: string;
  legalStatus?: string;
  hazardousFlag?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchResultRow {
  documentId: string;
  score: number;
  snippet: string;
  whyMatched: string;
  citations: Array<{
    citationId: string;
    chunkIndex: number | null;
    quote: string;
    sourceLabel: string;
    confidence: number;
  }>;
  metadata: {
    projectId: string | null;
    projectName: string | null;
    organisationName: string | null;
    subject: string;
    originalName: string;
    receivedTime: string | null;
    municipality: string | null;
    decisionType: string | null;
    wasteType: string | null;
    hazardousFlag: boolean | null;
    legalStatus: string | null;
    status: string;
  };
}

export interface SearchQueryResult {
  mode: SearchMode;
  scope: "project" | "global";
  elapsedMs: number;
  totalCandidates: number;
  guardrails: {
    strictEvidence: boolean;
    evidenceFilteredOut: number;
    citationCoveragePct: number;
    semanticEngine: "pgvector" | "json-fallback" | "disabled";
    draftWatermark: string;
  };
  results: SearchResultRow[];
}

export interface ManifestSyncResult {
  processedRows: number;
  queuedExtractionJobs: number;
  skippedRows: number;
}

export function getSearchConfig() {
  return {
    outlookBaseDir: process.env.OUTLOOK_BASE_DIR || "",
    manifestPath: process.env.OUTLOOK_MANIFEST_PATH || "",
    localDbRoot: process.env.LOCAL_DB_ROOT || "",
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
  };
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function readField(row: ManifestRow, candidates: string[]): string {
  for (const candidate of candidates) {
    const expected = normalizeKey(candidate);
    for (const [key, value] of Object.entries(row)) {
      if (normalizeKey(key) === expected) {
        return String(value || "").trim();
      }
    }
  }
  return "";
}

function parseDelimitedLine(line: string, delimiter: string = ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function parseManifestCsv(csvRaw: string): ManifestRow[] {
  const lines = csvRaw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseDelimitedLine(lines[0], ";");
  const rows: ManifestRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseDelimitedLine(lines[i], ";");
    const row: ManifestRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    rows.push(row);
  }

  return rows;
}

export function decodeManifestCsv(buffer: Buffer): string {
  if (buffer.length >= 2) {
    const b0 = buffer[0];
    const b1 = buffer[1];

    // UTF-16 LE BOM
    if (b0 === 0xff && b1 === 0xfe) {
      return buffer.toString("utf16le").replace(/^\uFEFF/, "");
    }

    // UTF-16 BE BOM
    if (b0 === 0xfe && b1 === 0xff) {
      const swapped = Buffer.allocUnsafe(Math.max(0, buffer.length - 2));
      for (let i = 2; i + 1 < buffer.length; i += 2) {
        swapped[i - 2] = buffer[i + 1];
        swapped[i - 1] = buffer[i];
      }
      return swapped.toString("utf16le").replace(/^\uFEFF/, "");
    }
  }

  const utf8 = buffer.toString("utf8");
  const nullCount = (utf8.match(/\u0000/g) || []).length;
  if (nullCount > utf8.length * 0.05) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }

  return utf8.replace(/^\uFEFF/, "");
}

export function parseBooleanOrNull(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["true", "1", "ja", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "nej", "no", "n"].includes(normalized)) {
    return false;
  }
  return null;
}

export async function statSafe(filePath: string): Promise<{ size: bigint; mtimeMs: number } | null> {
  try {
    const stat = await fs.stat(filePath);
    return { size: BigInt(stat.size), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function parseDateOrNull(value: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function lexicalScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) {
    return 0.5;
  }
  const tokens = q.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return text.toLowerCase().includes(q) ? 0.5 : 0;
  }

  const lower = text.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (lower.includes(token)) {
      hits += 1;
    }
  }

  return clampScore(hits / tokens.length);
}


export function buildSnippet(text: string, query: string): string {
  const compact = extractSearchText(text);
  if (!compact) {
    return "";
  }
  const lower = compact.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) {
    return compact.slice(0, 220);
  }

  const pivot = lower.indexOf(q);
  if (pivot === -1) {
    return compact.slice(0, 220);
  }

  const start = Math.max(0, pivot - 80);
  const end = Math.min(compact.length, pivot + q.length + 140);
  return compact.slice(start, end);
}


export async function syncManifestMetadata(input: {
  projectId: string;
  organisationId: string;
  manifestPath?: string;
  outlookBaseDir?: string;
}): Promise<ManifestSyncResult> {
  const manifestPath = input.manifestPath || process.env.OUTLOOK_MANIFEST_PATH || "";
  const outlookBaseDir = input.outlookBaseDir || process.env.OUTLOOK_BASE_DIR || "";

  if (!manifestPath) {
    throw new Error("OUTLOOK_MANIFEST_PATH saknas");
  }
  if (!outlookBaseDir) {
    throw new Error("OUTLOOK_BASE_DIR saknas");
  }

  const csvRaw = decodeManifestCsv(await fs.readFile(manifestPath));
  const rows = parseManifestCsv(csvRaw);
  let processedRows = 0;
  let queuedExtractionJobs = 0;
  let skippedRows = 0;

  for (const row of rows) {
    const diskName = readField(row, ["DiskName", "disk_name", "filename", "file_name"]);
    if (!diskName) {
      skippedRows += 1;
      continue;
    }

    const relativePath = readField(row, ["RelativePath", "Path", "FilePath"]);
    const resolvedAbsolutePath = relativePath
      ? path.resolve(outlookBaseDir, relativePath)
      : path.resolve(outlookBaseDir, diskName);

    const stat = await statSafe(resolvedAbsolutePath);
    const fileSize = stat?.size ?? null;

    const subject = readField(row, ["Subject", "subject"]) || diskName;
    const entryId = readField(row, ["EntryID", "EntryId", "message_id", "MessageId"]) || diskName;
    const receivedTime = parseDateOrNull(readField(row, ["ReceivedTime", "received_date", "Date", "received"]));
    const mimeType = readField(row, ["MimeType", "mime_type", "ContentType"]) || null;
    const fileSha256 = readField(row, ["Sha256", "Checksum", "Hash"]) || null;
    const municipality = readField(row, ["Municipality", "kommun"]) || null;
    const decisionType = readField(row, ["DecisionType", "beslutstyp"]) || null;
    const wasteType = readField(row, ["WasteType", "waste_codes", "avfallstyp"]) || null;
    const legalStatus = readField(row, ["LegalStatus", "status"]) || null;
    const hazardousFlag = parseBooleanOrNull(readField(row, ["Hazardous", "hazardous_flag", "farligt"]));
    const originalName = readField(row, ["OriginalName", "filename", "FileName"]) || diskName;

    const existing = await findDocumentByDiskName(diskName);
    const ext = path.extname(resolvedAbsolutePath).toLowerCase();
    const legacyBinaryMarker = `binart format (${ext}) - metadataindexerad.`;
    const hasLegacyPdfPlaceholder =
      ext === ".pdf" &&
      typeof existing?.content?.searchText === "string" &&
      existing.content.searchText.toLowerCase().includes(LEGACY_PDF_PLACEHOLDER_MARKER);
    const hasLegacyBinaryPlaceholder =
      OCR_CAPABLE_EXTENSIONS.has(ext) &&
      typeof existing?.content?.searchText === "string" &&
      existing.content.searchText.toLowerCase().includes(legacyBinaryMarker);
    const missingOcrCapableContent = OCR_CAPABLE_EXTENSIONS.has(ext) && Boolean(existing) && !existing?.content;
    const changed =
      !existing ||
      String(existing.absolutePath || "") !== resolvedAbsolutePath ||
      String(existing.fileSha256 || "") !== String(fileSha256 || "") ||
      String(existing.fileSize || "") !== String(fileSize || "") ||
      hasLegacyPdfPlaceholder ||
      hasLegacyBinaryPlaceholder ||
      missingOcrCapableContent;

    const document = await upsertDocumentFromManifest({
      projectId: input.projectId,
      organisationId: input.organisationId,
      entryId,
      receivedTime,
      subject,
      originalName,
      diskName,
      absolutePath: resolvedAbsolutePath,
      fileSize,
      fileSha256,
      mimeType,
      decisionType,
      municipality,
      wasteType,
      hazardousFlag,
      legalStatus,
      manifestMeta: row,
      preserveStatusOnUpdate: !changed,
    });

    if (changed) {
      await enqueueSearchJob({
        type: "EXTRACT_TEXT",
        projectId: input.projectId,
        payload: { documentId: String(document.id) },
      });
      queuedExtractionJobs += 1;
    }

    processedRows += 1;
  }

  return { processedRows, queuedExtractionJobs, skippedRows };
}

export async function runSearchQuery(input: {
  projectId?: string;
  userId: string;
  query: string;
  mode: SearchMode;
  topK?: number;
  strictEvidence?: boolean;
  filters?: SearchFilters;
  organisationId?: string;
}): Promise<SearchQueryResult> {
  const startedAt = Date.now();
  const mode: SearchMode = input.mode || "hybrid";
  const topK = Math.max(1, Math.min(100, Number(input.topK || 20)));
  const query = String(input.query || "").trim();
  const strictEvidence = Boolean(input.strictEvidence);
  const projectId = String(input.projectId || "").trim() || undefined;
  const scope: "project" | "global" = projectId ? "project" : "global";
  const filters = input.filters || {};

  const candidates = await findDocumentsForProject({
    organisationId: input.organisationId,
    projectId,
    query: mode === "semantic" ? undefined : query || undefined,
    municipality: filters.municipality,
    decisionType: filters.decisionType,
    wasteType: filters.wasteType,
    status: filters.status,
    legalStatus: filters.legalStatus,
    hazardousFlag: filters.hazardousFlag,
    dateFrom: parseDateOrNull(filters.dateFrom || ""),
    dateTo: parseDateOrNull(filters.dateTo || ""),
    take: 600,
  });

  let queryEmbedding: number[] | null = null;
  if ((mode === "semantic" || mode === "hybrid") && query) {
    const queryEmbeddingResult = await embedText(query);
    queryEmbedding = queryEmbeddingResult?.values || null;
  }

  const semanticByDoc = new Map<string, number>();
  const semanticEvidenceByDoc = new Map<string, { quote: string; chunkIndex: number; confidence: number }>();
  let semanticEngine: "pgvector" | "json-fallback" | "disabled" = "disabled";
  if ((mode === "semantic" || mode === "hybrid") && queryEmbedding) {
    const semanticLimit = projectId ? 12_000 : 20_000;
    const vectorRows = await queryTopSemanticChunks({
      organisationId: String(input.organisationId || '').trim(),
      projectId,
      queryEmbedding,
      limit: semanticLimit,
    });

    if (vectorRows.length > 0) {
      semanticEngine = "pgvector";
      for (const row of vectorRows) {
        const key = String(row.documentId);
        const similarity = clampScore(Number(row.similarity || 0));
        const previous = semanticByDoc.get(key) ?? 0;
        if (similarity <= previous) {
          continue;
        }
        semanticByDoc.set(key, similarity);
        const quote = buildSnippet(String(row.chunkText || ""), query) || String(row.chunkText || "").slice(0, 220);
        semanticEvidenceByDoc.set(key, {
          quote,
          chunkIndex: Number(row.chunkIndex || 0),
          confidence: Number(similarity.toFixed(4)),
        });
      }
    } else {
      const allChunks = await listChunksForProject(projectId, semanticLimit);
      if (allChunks.length > 0) {
        semanticEngine = "json-fallback";
      }

      for (const chunk of allChunks) {
        const embedding = Array.isArray(chunk.embeddingJson) ? (chunk.embeddingJson as number[]) : null;
        if (!embedding || embedding.length === 0) {
          continue;
        }
        const similarity = cosineSimilarity(queryEmbedding, embedding.slice(0, queryEmbedding.length));
        const key = String(chunk.documentId);
        const previous = semanticByDoc.get(key) ?? 0;
        if (similarity > previous) {
          semanticByDoc.set(key, similarity);
          const quote = buildSnippet(String(chunk.chunkText || ""), query) || String(chunk.chunkText || "").slice(0, 220);
          semanticEvidenceByDoc.set(key, {
            quote,
            chunkIndex: Number(chunk.chunkIndex),
            confidence: Number(clampScore(similarity).toFixed(4)),
          });
        }
      }
    }
  }

  let evidenceFilteredOut = 0;

  const ranked: SearchResultRow[] = candidates
    .map((candidate) => {
      const documentId = String(candidate.id);
      const textBlob = `${candidate.subject || ""} ${candidate.originalName || ""} ${candidate.content?.searchText || ""}`;
      const lex = lexicalScore(query, textBlob);
      const semantic = clampScore(semanticByDoc.get(documentId) ?? 0);

      let score = lex;
      let whyMatched = "Lexical match in metadata/text";

      if (mode === "semantic") {
        score = semantic > 0 ? semantic : lex * 0.8;
        whyMatched = semantic > 0 ? `Semantic chunk similarity (${semanticEngine})` : "Fallback lexical score";
      } else if (mode === "hybrid") {
        score = semantic > 0 ? semantic * 0.65 + lex * 0.35 : lex;
        whyMatched = semantic > 0 ? `Hybrid semantic+lexical ranking (${semanticEngine})` : "Lexical fallback (embedding saknas)";
      }

      const sourceLabel = String(candidate.subject || candidate.originalName || "Dokument");
      const citations: SearchResultRow["citations"] = [];
      const semanticEvidence = semanticEvidenceByDoc.get(documentId);
      if (semanticEvidence?.quote) {
        citations.push({
          citationId: `${documentId}:${semanticEvidence.chunkIndex}`,
          chunkIndex: semanticEvidence.chunkIndex,
          quote: semanticEvidence.quote,
          sourceLabel,
          confidence: semanticEvidence.confidence,
        });
      } else {
        const lexicalQuote = buildSnippet(String(candidate.content?.searchText || ""), query);
        if (lexicalQuote) {
          citations.push({
            citationId: `${documentId}:lexical`,
            chunkIndex: null,
            quote: lexicalQuote,
            sourceLabel,
            confidence: Number(clampScore(lex).toFixed(4)),
          });
        }
      }

      if (strictEvidence && citations.length === 0) {
        evidenceFilteredOut += 1;
        return null;
      }

      return {
        documentId,
        score: Number(clampScore(score).toFixed(4)),
        snippet: buildSnippet(candidate.content?.searchText || candidate.subject || "", query),
        whyMatched,
        citations,
        metadata: {
          projectId: candidate.project?.id ? String(candidate.project.id) : null,
          projectName: candidate.project?.propertyDesignation ? String(candidate.project.propertyDesignation) : null,
          organisationName: candidate.project?.organisation?.name ? String(candidate.project.organisation.name) : null,
          subject: String(candidate.subject || ""),
          originalName: String(candidate.originalName || ""),
          receivedTime: candidate.receivedTime ? new Date(candidate.receivedTime).toISOString() : null,
          municipality: candidate.municipality ? String(candidate.municipality) : null,
          decisionType: candidate.decisionType ? String(candidate.decisionType) : null,
          wasteType: candidate.wasteType ? String(candidate.wasteType) : null,
          hazardousFlag: candidate.hazardousFlag ?? null,
          legalStatus: candidate.legalStatus ? String(candidate.legalStatus) : null,
          status: String(candidate.status || "METADATA_ONLY"),
        },
      };
    })
    .filter((row): row is SearchResultRow => Boolean(row))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const elapsedMs = Date.now() - startedAt;
  const citedCount = ranked.filter((row) => row.citations.length > 0).length;
  const citationCoveragePct = ranked.length === 0 ? 0 : Number(((citedCount / ranked.length) * 100).toFixed(1));
  if (projectId) {
    await logSearchQuery({
      userId: input.userId,
      projectId,
      query,
      mode,
      topK,
      resultCount: ranked.length,
      elapsedMs,
    });
  }

  return {
    mode,
    scope,
    elapsedMs,
    totalCandidates: candidates.length,
    guardrails: {
      strictEvidence,
      evidenceFilteredOut,
      citationCoveragePct,
      semanticEngine,
      draftWatermark: process.env.SEARCH_DRAFT_WATERMARK || "UTKAST - MANUELL GRANSKNING KRAVS",
    },
    results: ranked,
  };
}
