import { FunctionDeclaration, Type } from '@google/genai';
import { embedText } from '../../../../services/searchService';
import {
  rerankWithGeminiOrLexical,
} from '../../../../services/legalRerankService';
import { prisma } from '../../../../db/prisma';
import { parseLegalReference } from '../../../legal/services/legalReferenceParser';
import { logger } from '../../../../logger';

export { localLexicalRerank } from '../../../../services/legalRerankService';

/** Alphaevolve A1+A2 — chunk-nivå hybrid retrieval + feature-flaggad rerank. */
const RRF_K_EXACT = 30;
const RRF_K = 60;
const EXACT_LIMIT = 20;
const FTS_CANDIDATE_LIMIT = 50;
const VECTOR_CANDIDATE_LIMIT = 50;
const RRF_CANDIDATE_LIMIT = 30;
const RERANKER_FINAL_K = 8;
const LIKE_FALLBACK_LIMIT = 10;
const DEFAULT_RELATIVE_GAP_SKIP = 0.25;

export type LegalCorpusSearchConfig = {
  rerankerEnabled: boolean;
  rrfCandidateLimit: number;
  rerankerFinalK: number;
  /** Skippa rerank om (s1 - s2) / s1 >= tröskel (relativ RRF-gap). */
  relativeGapSkip: number;
};

export function getLegalCorpusSearchConfig(
  env: NodeJS.ProcessEnv = process.env,
): LegalCorpusSearchConfig {
  const flag = String(env.LEGAL_RERANKER || '').trim().toLowerCase();
  const gapRaw = Number(env.LEGAL_RERANKER_RELATIVE_GAP);
  return {
    rerankerEnabled: flag === '1' || flag === 'true' || flag === 'on',
    rrfCandidateLimit: RRF_CANDIDATE_LIMIT,
    rerankerFinalK: RERANKER_FINAL_K,
    relativeGapSkip:
      Number.isFinite(gapRaw) && gapRaw > 0 ? gapRaw : DEFAULT_RELATIVE_GAP_SKIP,
  };
}

/** Adaptiv skip: dominant top-1 RRF → ingen Cross-Encoder/lexical rerank. */
export function shouldSkipReranker(sortedRrfScores: number[], relativeGapSkip: number): boolean {
  if (sortedRrfScores.length < 2) return true;
  const s1 = sortedRrfScores[0];
  const s2 = sortedRrfScores[1];
  if (!(s1 > 0)) return false;
  return (s1 - s2) / s1 >= relativeGapSkip;
}

export const searchLegalCorpusDeclaration: FunctionDeclaration = {
  name: 'searchLegalCorpus',
  description: 'Söker efter relevanta miljödomar, prejudikat och kunskapsartiklar i Legal Corpus. Använd detta för att ta reda på svensk miljöjuridik, praxis och tillsynsmetodik.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Söksträngen eller nyckelorden (t.ex. "strandskydd dispens", "förorenad mark ansvar").'
      },
      legalArea: {
        type: Type.STRING,
        description: 'Frivillig. Filtrera på specifikt rättsområde eller kategori om känt.'
      }
    },
    required: ['query'],
  },
};

type ChunkCandidate = {
  chunkId: string;
  recordId: string;
  chunkText: string;
  chapter: string | null;
  paragraph: string | null;
  section: string | null;
  similarity?: number;
  rank?: number;
};

type RrfEntry = {
  rrf: number;
  similarity?: number;
  rank?: number;
  candidate?: ChunkCandidate;
};

let cachedVectorColumnName: string | null | undefined = undefined;

/** Test-hjälp: nollställ cache mellan tester. */
export function resetLegalCorpusVectorColumnCache(): void {
  cachedVectorColumnName = undefined;
}

async function getVectorColumnName(): Promise<string | null> {
  if (cachedVectorColumnName !== undefined) {
    return cachedVectorColumnName;
  }
  try {
    const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'legal_corpus_chunks'
         AND (udt_name = 'vector' OR column_name IN ('embedding', 'embeddingVector', 'embedding_vector'))
       LIMIT 1;`
    );
    cachedVectorColumnName = columns.length > 0 ? columns[0].column_name : null;
  } catch (err) {
    console.error('Error checking vector column on legal_corpus_chunks:', err);
    cachedVectorColumnName = null;
  }
  return cachedVectorColumnName;
}

function mapChunkRows(rows: Array<Record<string, unknown>>): ChunkCandidate[] {
  return rows.map((row) => ({
    chunkId: String(row.chunk_id ?? row.id),
    recordId: String(row.record_id),
    chunkText: String(row.chunk_text ?? ''),
    chapter: row.chapter == null ? null : String(row.chapter),
    paragraph: row.paragraph == null ? null : String(row.paragraph),
    section: row.section == null ? null : String(row.section),
    similarity: row.similarity == null ? undefined : Number(row.similarity),
    rank: row.rank == null ? undefined : Number(row.rank),
  }));
}

function addArmToRrf(
  rrfScores: Map<string, RrfEntry>,
  candidates: ChunkCandidate[],
  k: number,
  scoreField?: 'similarity' | 'rank',
): void {
  candidates.forEach((candidate, index) => {
    const current = rrfScores.get(candidate.chunkId) || { rrf: 0 };
    current.rrf += 1 / (k + index + 1);
    current.candidate = current.candidate ?? candidate;
    if (scoreField === 'similarity' && candidate.similarity != null) {
      current.similarity = candidate.similarity;
    }
    if (scoreField === 'rank' && candidate.rank != null) {
      current.rank = candidate.rank;
    }
    rrfScores.set(candidate.chunkId, current);
  });
}

async function runExactArm(query: string): Promise<ChunkCandidate[]> {
  const legalRef = parseLegalReference(query);

  if (legalRef?.chapter && legalRef?.paragraph) {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT c.id AS chunk_id,
              c.record_id,
              c.chunk_text,
              c.chapter,
              c.paragraph,
              c.section
       FROM public.legal_corpus_chunks c
       WHERE c.chapter = $1
         AND c.paragraph = $2
       ORDER BY c.chunk_index ASC
       LIMIT $3`,
      legalRef.chapter,
      legalRef.paragraph,
      EXACT_LIMIT,
    );
    return mapChunkRows(rows);
  }

  if (legalRef?.lawName) {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT c.id AS chunk_id,
              c.record_id,
              c.chunk_text,
              c.chapter,
              c.paragraph,
              c.section
       FROM public.legal_corpus_chunks c
       JOIN public.legal_corpus_records r ON r.id = c.record_id
       WHERE r.title ILIKE $1
          OR c.law_name ILIKE $1
       ORDER BY c.chunk_index ASC
       LIMIT $2`,
      `%${legalRef.lawName}%`,
      EXACT_LIMIT,
    );
    return mapChunkRows(rows);
  }

  return [];
}

async function runFtsArm(query: string, legalArea?: string): Promise<ChunkCandidate[]> {
  let sql = `
    SELECT c.id AS chunk_id,
           c.record_id,
           c.chunk_text,
           c.chapter,
           c.paragraph,
           c.section,
           ts_rank_cd(r.search_vector, websearch_to_tsquery('swedish', $1)) AS rank
    FROM public.legal_corpus_records r
    JOIN public.legal_corpus_chunks c ON c.record_id = r.id
    WHERE r.search_vector @@ websearch_to_tsquery('swedish', $1)
      AND r.search_text IS NOT NULL
  `;
  const params: unknown[] = [query];
  if (legalArea) {
    sql += ` AND r.legal_area ILIKE $2`;
    params.push(legalArea);
  }
  sql += `
    ORDER BY rank DESC, c.chunk_index ASC
    LIMIT ${legalArea ? '$3' : '$2'}
  `;
  params.push(FTS_CANDIDATE_LIMIT);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...params);
  return mapChunkRows(rows);
}

async function runVectorArm(query: string, legalArea?: string): Promise<ChunkCandidate[]> {
  const vectorColumn = await getVectorColumnName();
  if (!vectorColumn) return [];

  try {
    const embedResult = await embedText(query);
    if (!embedResult?.values?.length) return [];

    const vectorLiteral = `[${embedResult.values.join(',')}]`;
    let sql = `
      SELECT c.id AS chunk_id,
             c.record_id,
             c.chunk_text,
             c.chapter,
             c.paragraph,
             c.section,
             1 - (c."${vectorColumn}" <=> $1::vector) AS similarity
      FROM public.legal_corpus_chunks c
      JOIN public.legal_corpus_records r ON r.id = c.record_id
      WHERE c."${vectorColumn}" IS NOT NULL
    `;
    const params: unknown[] = [vectorLiteral];
    if (legalArea) {
      sql += ` AND r.legal_area ILIKE $2`;
      params.push(legalArea);
    }
    sql += `
      ORDER BY c."${vectorColumn}" <=> $1::vector ASC
      LIMIT ${legalArea ? '$3' : '$2'}
    `;
    params.push(VECTOR_CANDIDATE_LIMIT);
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...params);
    return mapChunkRows(rows);
  } catch (vectorErr) {
    console.warn('Vector search failed, continuing with lexical search only:', vectorErr);
    return [];
  }
}

async function runLikeFallback(query: string, legalArea?: string): Promise<ChunkCandidate[]> {
  let sql = `
    SELECT c.id AS chunk_id,
           c.record_id,
           c.chunk_text,
           c.chapter,
           c.paragraph,
           c.section
    FROM public.legal_corpus_records r
    JOIN public.legal_corpus_chunks c ON c.record_id = r.id
    WHERE (r.case_number ILIKE $1
       OR r.title ILIKE $1
       OR r.search_text ILIKE $1
       OR c.chunk_text ILIKE $1)
  `;
  const params: unknown[] = [`%${query}%`];
  if (legalArea) {
    sql += ` AND r.legal_area ILIKE $2`;
    params.push(legalArea);
  }
  sql += `
    ORDER BY c.chunk_index ASC
    LIMIT ${legalArea ? '$3' : '$2'}
  `;
  params.push(LIKE_FALLBACK_LIMIT);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...params);
  return mapChunkRows(rows);
}

export async function searchLegalCorpusHandler(args: { query: string; legalArea?: string }) {
  const { query, legalArea } = args;
  const config = getLegalCorpusSearchConfig();

  if (!query || query.trim().length < 2) {
    return { error: 'Söksträngen är för kort.' };
  }

  try {
    const trimmedQuery = query.trim();

    // Exact körs parallellt med FTS ‖ Vector (A1).
    const startTime = Date.now();
    const [exactResults, ftsResults, vectorResults] = await Promise.all([
      runExactArm(trimmedQuery),
      runFtsArm(trimmedQuery, legalArea),
      runVectorArm(trimmedQuery, legalArea),
    ]);
    const retrievalMs = Date.now() - startTime;
    console.log(
      `[RAG Search] Latency: ${retrievalMs}ms, Exact: ${exactResults.length}, FTS: ${ftsResults.length}, Vector: ${vectorResults.length}`,
    );

    const rrfScores = new Map<string, RrfEntry>();
    addArmToRrf(rrfScores, exactResults, RRF_K_EXACT);
    addArmToRrf(rrfScores, vectorResults, RRF_K, 'similarity');
    addArmToRrf(rrfScores, ftsResults, RRF_K, 'rank');

    if (rrfScores.size === 0) {
      const fallback = await runLikeFallback(trimmedQuery, legalArea);
      addArmToRrf(rrfScores, fallback, RRF_K);
    }

    const sortedChunkIds = Array.from(rrfScores.keys())
      .sort((a, b) => (rrfScores.get(b)?.rrf || 0) - (rrfScores.get(a)?.rrf || 0))
      .slice(0, config.rrfCandidateLimit);

    if (sortedChunkIds.length === 0) {
      logger.info('searchLegalCorpus completed', {
        rerankerEngine: 'none',
        rerankerStatus: 'disabled',
        promptVersion: 'not-triggered',
        exactCount: exactResults.length,
        ftsCount: ftsResults.length,
        vectorCount: vectorResults.length,
        latencyMs: retrievalMs,
      });

      return {
        message: `Inga miljödomar eller lagrum hittades som matchade sökningen "${trimmedQuery}".`,
        results: [],
        meta: {
          topK: config.rerankerEnabled ? config.rerankerFinalK : config.rrfCandidateLimit,
          rrfCandidateLimit: config.rrfCandidateLimit,
          exactCount: exactResults.length,
          ftsCount: ftsResults.length,
          vectorCount: vectorResults.length,
          latencyMs: retrievalMs,
          rerankerEnabled: config.rerankerEnabled,
          rerankerStatus: 'disabled' as const,
          rerankerEngine: 'none' as const,
          promptVersion: 'not-triggered',
          relativeGapSkip: config.relativeGapSkip,
        },
      };
    }

    const sortedRrfValues = sortedChunkIds.map((id) => rrfScores.get(id)?.rrf || 0);
    const skipReranker =
      !config.rerankerEnabled ||
      shouldSkipReranker(sortedRrfValues, config.relativeGapSkip);

    const recordIds = Array.from(
      new Set(
        sortedChunkIds
          .map((chunkId) => rrfScores.get(chunkId)?.candidate?.recordId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const details = recordIds.length
      ? await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT id, title, case_number, published_at, decision_date, authority_name, legal_area, metadata, source_url, source_path
           FROM public.legal_corpus_records
           WHERE id IN (${recordIds.map((_, i) => `$${i + 1}`).join(', ')})`,
          ...recordIds,
        )
      : [];

    type MappedResult = {
      id: string;
      chunkId: string;
      title: unknown;
      caseNumber: unknown;
      decisionDate: unknown;
      publishedAt: unknown;
      authorityName: unknown;
      legalArea: unknown;
      sourceUrl: unknown;
      sourcePath: unknown;
      snippet: string;
      chunkText: string;
      metadata: Record<string, unknown>;
      score: number;
      similarity?: number;
      rank?: number;
      finalScore?: number;
      rerankApplied?: boolean;
    };

    const mappedResults: MappedResult[] = sortedChunkIds
      .map((chunkId) => {
        const rrfInfo = rrfScores.get(chunkId);
        const candidate = rrfInfo?.candidate;
        if (!candidate) return null;

        const detail = details.find((d) => d.id === candidate.recordId);
        if (!detail) return null;

        const meta = (detail.metadata as Record<string, unknown> | null) || {};
        const structuredMeta = {
          lagrum: meta.lagrumLista || [],
          forarbeten: meta.forarbeteLista || [],
          malnummer: meta.malNummerLista || [],
          nyckelord: meta.nyckelordLista || [],
          referatNummer: meta.referatNummerLista || [],
          avgorandedatum: meta.avgorandedatum || detail.decision_date || null,
          chapter: candidate.chapter,
          paragraph: candidate.paragraph,
          section: candidate.section,
        };

        return {
          id: candidate.recordId,
          chunkId: candidate.chunkId,
          title: detail.title,
          caseNumber: detail.case_number,
          decisionDate: detail.decision_date,
          publishedAt: detail.published_at,
          authorityName: detail.authority_name,
          legalArea: detail.legal_area,
          sourceUrl: detail.source_url,
          sourcePath: detail.source_path,
          // Chunk-text är grounding för Gemini — inte hela document_text.
          snippet: candidate.chunkText,
          chunkText: candidate.chunkText,
          metadata: structuredMeta as Record<string, unknown>,
          score: rrfInfo?.rrf ? Number(rrfInfo.rrf.toFixed(6)) : 0,
          similarity: rrfInfo?.similarity,
          rank: rrfInfo?.rank,
        };
      })
      .filter((row) => row != null);

    let finalResults = mappedResults;
    let rerankerStatus: 'disabled' | 'skipped_gap' | 'applied' = 'disabled';
    let rerankerEngine: 'none' | 'gemini' | 'lexical' = 'none';
    let promptVersion = 'not-triggered';

    if (config.rerankerEnabled) {
      if (skipReranker) {
        rerankerStatus = 'skipped_gap';
        finalResults = mappedResults
          .map((row) => ({ ...row, finalScore: row.score, rerankApplied: false }))
          .slice(0, config.rerankerFinalK);
      } else {
        rerankerStatus = 'applied';
        const rerankCandidates = mappedResults.map((row) => ({
          id: row.chunkId,
          chunkText: row.chunkText,
          score: row.score,
          _row: row,
        }));

        const rerankOutcome = await rerankWithGeminiOrLexical(
          trimmedQuery,
          rerankCandidates.map(({ id, chunkText, score }) => ({ id, chunkText, score })),
          config.rerankerFinalK,
        );

        rerankerEngine = rerankOutcome.engine;
        promptVersion = rerankOutcome.promptVersion;

        const byId = new Map(rerankCandidates.map((c) => [c.id, c._row]));
        finalResults = rerankOutcome.items
          .slice(0, config.rerankerFinalK)
          .map((item) => {
            const row = byId.get(item.id);
            if (!row) return null;
            return {
              ...row,
              score: Number(item.finalScore.toFixed(6)),
              finalScore: Number(item.finalScore.toFixed(6)),
              rerankApplied: item.rerankApplied,
            };
          })
          .filter((row): row is MappedResult => row != null);
      }
    }

    logger.info('searchLegalCorpus completed', {
      rerankerEngine,
      rerankerStatus,
      promptVersion,
      exactCount: exactResults.length,
      ftsCount: ftsResults.length,
      vectorCount: vectorResults.length,
      latencyMs: retrievalMs,
    });

    return {
      results: finalResults,
      meta: {
        topK: config.rerankerEnabled ? config.rerankerFinalK : config.rrfCandidateLimit,
        rrfCandidateLimit: config.rrfCandidateLimit,
        exactCount: exactResults.length,
        ftsCount: ftsResults.length,
        vectorCount: vectorResults.length,
        latencyMs: retrievalMs,
        rerankerEnabled: config.rerankerEnabled,
        rerankerStatus,
        rerankerEngine,
        promptVersion,
        relativeGapSkip: config.relativeGapSkip,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('searchLegalCorpus error:', err);
    return { error: 'Databasfel vid sökning i korpusen.', details: message };
  }
}
