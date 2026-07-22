import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

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
  CROSS_ENCODER_ENABLED: false, // Defaultavstängd (Fas A2 feature-flagga)
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
  metadata?: any;
}

export interface SearchOptions {
  bbox?: [number, number, number, number]; // SW_lng, SW_lat, NE_lng, NE_lat (SRID 4326)
  category?: string;
  config?: Partial<SearchConfig>;
}

export class AlphaevolveSearchService extends EventEmitter {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    super();
    this.prisma = prismaClient;
  }

  /**
   * Huvudsökmetod för Alphaevolve v2.3
   */
  public async search(query: string, options: SearchOptions = {}): Promise<SearchChunkResult[]> {
    const startTime = Date.now();
    const config = { ...DEFAULT_CONFIG, ...options.config };
    
    this.emit('search:start', { query, config });

    try {
      // -----------------------------------------------------------------------
      // STAGE 0: Query Planner Rule (Fas B - Enkel bypass för tomma/special-frågor)
      // -----------------------------------------------------------------------
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        return [];
      }

      // -----------------------------------------------------------------------
      // STAGE 1: Parallell Retrieval (Fas A1 - FTS + pgvector i Promise.all)
      // -----------------------------------------------------------------------
      const ftsQueryString = trimmedQuery;
      
      // Skapa en falsk/stub-vektor för pgvector-sökningen i demo/test (i produktion genereras denna via geminiService)
      const mockQueryEmbedding = new Array(768).fill(0).map(() => Math.random() - 0.5);

      const [ftsCandidates, vectorCandidates] = await Promise.all([
        this.executeFts(ftsQueryString, config.FTS_CANDIDATE_LIMIT),
        this.executeVector(mockQueryEmbedding, config.VECTOR_CANDIDATE_LIMIT)
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
      // STAGE 4: Cross-Encoder Reranking (Fas A2 - Feature-flaggad)
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
   * Fas A1: Exekverar Full-Text sökning mot PostgreSQL med svensk ordstamning
   */
  private async executeFts(query: string, limit: number): Promise<SearchChunkResult[]> {
    // Vi använder websearch_to_tsquery('swedish') och ts_rank_cd för exakt svensk språkhistorik
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
   * Fas A1: KORRIGERAD pgvector-sökning direkt mot chunkens embeddings (LÖSER DÖD VEKTORRECALL)
   */
  private async executeVector(embedding: number[], limit: number): Promise<SearchChunkResult[]> {
    const vectorString = `[${embedding.join(',')}]`;
    
    // Rättat: Vi söker direkt mot legal_corpus_chunks tabellen där embedding_vector ligger (vector_cosine_ops)
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

    // Mappa FTS-ranker
    fts.forEach((item, index) => {
      registry[item.id] = { chunk: item, ftsRank: index + 1, vecRank: -1 };
    });

    // Mappa Vector-ranker
    vector.forEach((item, index) => {
      if (registry[item.id]) {
        registry[item.id].vecRank = index + 1;
      } else {
        registry[item.id] = { chunk: item, ftsRank: -1, vecRank: index + 1 };
      }
    });

    // Beräkna RRF poäng
    return Object.values(registry).map(({ chunk, ftsRank, vecRank }) => {
      let ftsScore = ftsRank !== -1 ? 1 / (k + ftsRank) : 0;
      let vecScore = vecRank !== -1 ? 1 / (k + vecRank) : 0;
      const rrfScore = ftsScore + vecScore;

      return {
        ...chunk,
        rrfScore,
        finalScore: rrfScore // Standard poäng före Cross-Encoder
      };
    });
  }

  /**
   * Fas B: Spatial JOIN mot fastighetsgränser via PostGIS (ST_Intersects)
   */
  private async applySpatialFiltering(
    results: SearchChunkResult[],
    bbox: [number, number, number, number]
  ): Promise<SearchChunkResult[]> {
    // Bygg PostGIS-envelopen i SRID 4326 och transformera till nationella SRID 3006
    const [minLng, minLat, maxLng, maxLat] = bbox;
    
    const validIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT c.id
      FROM public.legal_corpus_chunks c
      JOIN public.legal_corpus_records r ON c.record_id = r.id
      JOIN public.env_registerenhetsomradesytor f ON ST_Intersects(
        f.geom,
        ST_Transform(ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326), 3006)
      )
      WHERE c.id IN (${PrismaClient.raw(results.map(r => `'${r.id}'`).join(','))})
    `;

    const idSet = new Set(validIds.map(v => v.id));
    return results.filter(item => idSet.has(item.id));
  }

  /**
   * Fas A2: Cross-Encoder Reranking via lättvikts Node-workerpool
   */
  private async executeReranker(
    results: SearchChunkResult[],
    query: string,
    limit: number
  ): Promise<SearchChunkResult[]> {
    const candidatesToRank = results
      .sort((a, b) => (b.rrfScore || 0) - (a.rrfScore || 0))
      .slice(0, limit);

    // I full produktion anropar denna modul din installerade Cross-Encoder (t.ex. bge-reranker-base)
    // Här simulerar vi rerank-vikten med distributionsloggning för kalibrering i Fas C
    return candidatesToRank.map((item, index) => {
      const mockRelevanceModifier = Math.sin(index) * 0.1; // Simulerat ranking-tweak
      const finalScore = (item.rrfScore || 0) + mockRelevanceModifier;

      return {
        ...item,
        finalScore
      };
    });
  }

  /**
   * Fas B: Begränsad Kunskapsgrafexpansion (Max 2 grannar, Max 20 extra chunks)
   */
  private async applyGraphExpansion(chunks: SearchChunkResult[]): Promise<SearchChunkResult[]> {
    if (chunks.length === 0) return chunks;

    const expandedResults = [...chunks];
    const maxNewChunksLimit = 20;
    let addedCount = 0;

    for (const chunk of chunks) {
      if (addedCount >= maxNewChunksLimit) break;

      // Hämta strikt begränsade grannar från Kunskapsgrafen (knowledge_edges)
      const neighbors = await this.prisma.$queryRaw<{ id: string; chunk_text: string; title: string }[]>`
        SELECT 
          c.id, 
          c.chunk_text as "chunkText",
          r.title as "documentTitle"
        FROM public.knowledge_edges e
        JOIN public.knowledge_nodes n ON e.target_id = n.id
        JOIN public.extracted_requirements er ON er.id = n.name
        JOIN public.attachments att ON er.attachment_hash = att.attachment_hash
        JOIN public.legal_corpus_chunks c ON att.document_id = c.record_id
        JOIN public.legal_corpus_records r ON c.record_id = r.id
        WHERE e.source_id = ${chunk.documentId}
        LIMIT 2 -- Max 2 grannar per nod (Fas B-restriktion)
      `;

      for (const neighbor of neighbors) {
        if (addedCount >= maxNewChunksLimit) break;
        if (!expandedResults.some(r => r.id === neighbor.id)) {
          expandedResults.push({
            id: neighbor.id,
            chunkText: neighbor.chunk_text,
            documentId: chunk.documentId,
            documentTitle: neighbor.title,
            finalScore: (chunk.finalScore || 0) * 0.9 // dämpad poäng för grafgrannar
          });
          addedCount++;
        }
      }
    }

    return expandedResults;
  }

  /**
   * Sparar rå mätdata för framtida datadriven optimering i Fas C
   */
  private async logSearchMetrics(query: string, metrics: any): Promise<void> {
    await this.prisma.searchQueryLog.create({
      data: {
        userId: "system-alphaevolve",
        projectId: "alphaevolve-log",
        query: query,
        mode: 'hybrid',
        topK: metrics.finalCount,
        resultCount: metrics.finalCount,
        elapsedMs: metrics.totalMs,
      }
    });
  }
}
