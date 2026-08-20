/**
 * LEGAL-RETRIEVAL-BULK-EMBEDDING-01.
 *
 * Scale phase on top of the already-frozen identity/persistence/provider-path contract
 * (LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01, LEGAL-RETRIEVAL-BOUNDED-PILOT-01). Nothing about
 * identity, retrieval policy, or the provider decision is re-opened here -- this only proves the
 * SAME contract holds at the scale of the full frozen corpus baseline. No retrieval tuning, no
 * reranker, no query rewriting, no UI/RAG chat -- explicitly out of scope.
 *
 * Provider: Gemini API-key path only (gemini-embedding-001, pinned), same as the pilot.
 * NO Vertex/ADC fallback, NO synthetic/mock embeddings under any failure condition. A dimension
 * mismatch (provider drift) aborts the ENTIRE run immediately (STOP). A batch that exhausts its
 * retries aborts the run with a PARTIAL report -- never skipped-and-continued past silently,
 * because that would leave an untracked coverage gap.
 *
 * Batch-wise and source/materialization-aware: chunks are loaded and reported grouped by their
 * owning materialization (source_family, chunk_policy_version), not as one opaque stream.
 * Resumable and cost-safe: before calling the provider for any chunk, its embedding_identity_hash
 * is checked against existing rows -- an already-embedded chunk (from the pilot, or a prior
 * partial run) is never re-sent to the API.
 *
 * Usage:
 *   npx tsx scripts/db/legal-retrieval-bulk-embedding-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import { bindEmbeddingIdentity } from '@miljobeslut/mps-embedding-identity';
import {
  createGeminiEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  EmbeddingProviderError,
} from '../../server/modules/legal/retrieval/GeminiEmbeddingProvider';
import { persistChunkEmbedding } from '../../server/modules/legal/retrieval/LegalCorpusChunkEmbeddingPersistence';

const BATCH_SIZE = 20;
const INTER_BATCH_DELAY_MS = 150;
const MAX_RETRIES_PER_BATCH = 3;
const RETRY_BACKOFF_BASE_MS = 2000;

const REAL_POLICY_VERSIONS = ['legal-chunker-v2.3', 'legal-chunker-v2.4', 'legal-chunker-v2.4.1'] as const;

interface ScopedChunk {
  fragment_id: string;
  materialization_id: string;
  content_hash: string;
  chunk_text: string;
  structure_kind: string;
  chunk_policy_version: string;
  source_family: string;
  logical_source_id: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Loads the exact governed scope -- same filter discipline as
 *  LEGAL-CORPUS-V1-TEXT-STRUCTURE-BASELINE-V2: real chunk_policy_versions only, excluding the
 *  known synthetic F2 persistence-proof fixtures (never real content). */
async function loadScopedChunks(): Promise<ScopedChunk[]> {
  const materializations = await prisma.legalCorpusMaterialization.findMany({
    where: {
      chunkPolicyVersion: { in: [...REAL_POLICY_VERSIONS] },
      NOT: { logicalSourceId: { startsWith: 'pilot-persistence-proof' } },
    },
    select: { id: true, logicalSourceId: true, chunkPolicyVersion: true, corpusRecord: { select: { sourceFamily: true } } },
  });
  const matById = new Map(materializations.map((m) => [m.id, m]));

  const out: ScopedChunk[] = [];
  const pageSize = 2000;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.legalCorpusMaterializedChunk.findMany({
      where: { materializationId: { in: materializations.map((m) => m.id) } },
      take: pageSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, fragmentId: true, materializationId: true, contentHash: true, chunkText: true, structureKind: true },
    });
    if (page.length === 0) break;
    for (const c of page) {
      const mat = matById.get(c.materializationId);
      if (!mat) continue; // defensive -- should be impossible given the `in` filter above
      out.push({
        fragment_id: c.fragmentId,
        materialization_id: c.materializationId,
        content_hash: c.contentHash,
        chunk_text: c.chunkText,
        structure_kind: c.structureKind,
        chunk_policy_version: mat.chunkPolicyVersion,
        source_family: mat.corpusRecord.sourceFamily,
        logical_source_id: mat.logicalSourceId,
      });
    }
    cursor = page[page.length - 1]!.id;
    if (page.length < pageSize) break;
  }
  return out;
}

interface RunStats {
  attempted: number;
  created: number;
  replay_resolved: number; // already existed before this run -- skipped, not re-sent to provider
  failures: number;
  null_vectors: number;
  dimension_mismatches: number;
  batches: number;
  retries: number;
  requests: number;
  provider_call_ms_total: number;
  db_write_ms_total: number;
}

async function main() {
  const startedAt = Date.now();
  console.log('########## LEGAL-RETRIEVAL-BULK-EMBEDDING-01 ##########\n');

  const provider = createGeminiEmbeddingProvider();
  console.log('provider:', provider.model_id, provider.model_version, provider.pipeline_version, '| expected dim:', EMBEDDING_DIMENSIONS);

  console.log('\n--- loading scoped chunks from the frozen corpus baseline ---');
  const chunks = await loadScopedChunks();
  console.log('scoped chunk count:', chunks.length);

  const byFamily = new Map<string, number>();
  const byPolicy = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const c of chunks) {
    byFamily.set(c.structure_kind, (byFamily.get(c.structure_kind) ?? 0) + 1);
    byPolicy.set(c.chunk_policy_version, (byPolicy.get(c.chunk_policy_version) ?? 0) + 1);
    bySource.set(c.logical_source_id, (bySource.get(c.logical_source_id) ?? 0) + 1);
  }
  console.log('by family (structure_kind):', Object.fromEntries(byFamily));
  console.log('by chunk_policy_version:', Object.fromEntries(byPolicy));

  console.log('\n--- resolving which chunks already have this exact embedding identity (skip, no API call) ---');
  const identities = chunks.map((c) =>
    bindEmbeddingIdentity({
      fragment_id: c.fragment_id,
      materialization_id: c.materialization_id,
      chunk_content_hash: c.content_hash,
      embedding_model_id: provider.model_id,
      embedding_model_version: provider.model_version,
      embedding_pipeline_version: provider.pipeline_version,
    }),
  );
  const allHashes = identities.map((i) => i.embedding_identity_hash);
  const existingRows = await prisma.$queryRawUnsafe<Array<{ embedding_identity_hash: string }>>(
    `SELECT embedding_identity_hash FROM "legal_corpus_chunk_embeddings" WHERE embedding_identity_hash = ANY($1::text[])`,
    allHashes,
  );
  const existingSet = new Set(existingRows.map((r) => r.embedding_identity_hash));
  console.log('already embedded under this exact identity (skipped, resumable/cost-safe):', existingSet.size, 'of', chunks.length);

  const pending: { chunk: ScopedChunk; identity: (typeof identities)[number] }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!existingSet.has(identities[i]!.embedding_identity_hash)) {
      pending.push({ chunk: chunks[i]!, identity: identities[i]! });
    }
  }
  console.log('pending (need embedding this run):', pending.length);

  const stats: RunStats = {
    attempted: chunks.length,
    created: 0,
    replay_resolved: existingSet.size,
    failures: 0,
    null_vectors: 0,
    dimension_mismatches: 0,
    batches: 0,
    retries: 0,
    requests: 0,
    provider_call_ms_total: 0,
    db_write_ms_total: 0,
  };

  let runStatus: 'PROVEN' | 'PARTIAL' | 'STOPPED_DIMENSION_DRIFT' = 'PROVEN';
  let stopReason: string | undefined;

  console.log('\n--- embedding pending chunks (batch size', BATCH_SIZE, ') ---');
  const totalBatches = Math.ceil(pending.length / BATCH_SIZE);

  outer: for (let b = 0; b < totalBatches; b++) {
    const batch = pending.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    stats.batches++;

    let attempt = 0;
    let vectors: readonly number[][] | null = null;
    while (attempt <= MAX_RETRIES_PER_BATCH) {
      attempt++;
      stats.requests++;
      const t0 = Date.now();
      try {
        vectors = await provider.embedBatch(batch.map((p) => p.chunk.chunk_text));
        stats.provider_call_ms_total += Date.now() - t0;
        break;
      } catch (err) {
        stats.provider_call_ms_total += Date.now() - t0;
        if (err instanceof EmbeddingProviderError && err.code === 'EMBEDDING_BATCH_SIZE_MISMATCH') {
          // Could be legitimate provider drift OR a rate-limit-shaped partial response --
          // either way, do not guess: STOP the whole run rather than silently accept a
          // reshaped batch.
          runStatus = 'STOPPED_DIMENSION_DRIFT';
          stopReason = `batch ${b + 1}/${totalBatches}: provider returned a different shape than requested -- ${err.message}`;
          break outer;
        }
        if (attempt > MAX_RETRIES_PER_BATCH) {
          runStatus = 'PARTIAL';
          stopReason = `batch ${b + 1}/${totalBatches} failed after ${MAX_RETRIES_PER_BATCH} retries: ${err instanceof Error ? err.message : String(err)}`;
          stats.failures += batch.length;
          break outer;
        }
        stats.retries++;
        const backoff = RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1);
        console.log(`  batch ${b + 1}/${totalBatches} attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}) -- retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
    if (!vectors) break;

    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j]!;
      if (!vec || vec.length === 0) {
        stats.null_vectors++;
        continue;
      }
      if (vec.length !== EMBEDDING_DIMENSIONS) {
        stats.dimension_mismatches++;
        runStatus = 'STOPPED_DIMENSION_DRIFT';
        stopReason = `batch ${b + 1}/${totalBatches}, item ${j}: vector dimension ${vec.length} != expected ${EMBEDDING_DIMENSIONS} -- provider drift, aborting`;
        console.log(`\n!!! DIMENSION DRIFT DETECTED: ${stopReason}`);
        break outer;
      }
      const dbT0 = Date.now();
      const result = await persistChunkEmbedding(batch[j]!.identity, vec);
      stats.db_write_ms_total += Date.now() - dbT0;
      if (result.inserted) stats.created++;
      else stats.replay_resolved++;
    }

    if ((b + 1) % 25 === 0 || b === totalBatches - 1) {
      const elapsedS = (Date.now() - startedAt) / 1000;
      const done = (b + 1) * BATCH_SIZE;
      console.log(
        `  batch ${b + 1}/${totalBatches} | created=${stats.created} skipped=${stats.replay_resolved - existingSet.size} failures=${stats.failures} | ` +
        `elapsed=${elapsedS.toFixed(0)}s | ~${(done / elapsedS).toFixed(1)} chunks/s`,
      );
    }

    await sleep(INTER_BATCH_DELAY_MS);
  }

  const finishedAt = Date.now();
  const wallTimeS = (finishedAt - startedAt) / 1000;

  console.log('\n\n--- POST-RUN VERIFICATION (independent DB queries, not just script counters) ---');
  const finalTotal = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "legal_corpus_chunk_embeddings"`,
  );
  const finalDistinctHashes = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(DISTINCT embedding_identity_hash)::bigint AS count FROM "legal_corpus_chunk_embeddings"`,
  );
  const finalNullVectors = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "legal_corpus_chunk_embeddings" WHERE embedding_vector IS NULL`,
  );
  console.log('total embedding rows in DB:', Number(finalTotal[0]!.count));
  console.log('distinct embedding_identity_hash (must equal total -- zero duplicates ever landed):', Number(finalDistinctHashes[0]!.count));
  console.log('rows with NULL vector in DB (must be 0):', Number(finalNullVectors[0]!.count));

  // Coverage breakdown by family/policy/source, from the DB, not script memory.
  const coverageByFamily = await prisma.$queryRawUnsafe<Array<{ structure_kind: string; total: bigint; embedded: bigint }>>(
    `SELECT c.structure_kind, COUNT(DISTINCT c.id)::bigint AS total,
            COUNT(DISTINCT e.id)::bigint AS embedded
     FROM "legal_corpus_materialized_chunks" c
     JOIN "legal_corpus_materializations" m ON m.id = c.materialization_id
     LEFT JOIN "legal_corpus_chunk_embeddings" e
       ON e.fragment_id = c.fragment_id AND e.materialization_id = c.materialization_id
       AND e.embedding_model_id = $1 AND e.embedding_pipeline_version = $2
     WHERE m.chunk_policy_version = ANY($3::text[])
       AND m.logical_source_id NOT LIKE 'pilot-persistence-proof%'
     GROUP BY c.structure_kind`,
    provider.model_id, provider.pipeline_version, [...REAL_POLICY_VERSIONS],
  );
  console.log('\ncoverage by family:', coverageByFamily.map((r) => ({ family: r.structure_kind, total: Number(r.total), embedded: Number(r.embedded) })));

  const coverageByPolicy = await prisma.$queryRawUnsafe<Array<{ chunk_policy_version: string; total: bigint; embedded: bigint }>>(
    `SELECT m.chunk_policy_version, COUNT(DISTINCT c.id)::bigint AS total,
            COUNT(DISTINCT e.id)::bigint AS embedded
     FROM "legal_corpus_materialized_chunks" c
     JOIN "legal_corpus_materializations" m ON m.id = c.materialization_id
     LEFT JOIN "legal_corpus_chunk_embeddings" e
       ON e.fragment_id = c.fragment_id AND e.materialization_id = c.materialization_id
       AND e.embedding_model_id = $1 AND e.embedding_pipeline_version = $2
     WHERE m.chunk_policy_version = ANY($3::text[])
       AND m.logical_source_id NOT LIKE 'pilot-persistence-proof%'
     GROUP BY m.chunk_policy_version`,
    provider.model_id, provider.pipeline_version, [...REAL_POLICY_VERSIONS],
  );
  console.log('coverage by chunk_policy_version:', coverageByPolicy.map((r) => ({ policy: r.chunk_policy_version, total: Number(r.total), embedded: Number(r.embedded) })));

  const coverageBySource = await prisma.$queryRawUnsafe<Array<{ logical_source_id: string; total: bigint; embedded: bigint }>>(
    `SELECT m.logical_source_id, COUNT(DISTINCT c.id)::bigint AS total,
            COUNT(DISTINCT e.id)::bigint AS embedded
     FROM "legal_corpus_materialized_chunks" c
     JOIN "legal_corpus_materializations" m ON m.id = c.materialization_id
     LEFT JOIN "legal_corpus_chunk_embeddings" e
       ON e.fragment_id = c.fragment_id AND e.materialization_id = c.materialization_id
       AND e.embedding_model_id = $1 AND e.embedding_pipeline_version = $2
     WHERE m.chunk_policy_version = ANY($3::text[])
       AND m.logical_source_id NOT LIKE 'pilot-persistence-proof%'
     GROUP BY m.logical_source_id
     ORDER BY total DESC`,
    provider.model_id, provider.pipeline_version, [...REAL_POLICY_VERSIONS],
  );
  console.log('coverage by source:', coverageBySource.map((r) => ({ source: r.logical_source_id, total: Number(r.total), embedded: Number(r.embedded) })));

  if (stopReason) {
    console.log('\n!!! RUN STOPPED:', stopReason);
  }

  // Rough, explicitly-estimated cost: character count as a token proxy (no usage metadata is
  // exposed by embedContent's response type -- see PROVEN doc for the exact check performed).
  const totalChars = pending.reduce((sum, p) => sum + p.chunk.chunk_text.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4); // rough en/sv heuristic, ~4 chars/token

  const summary = {
    status: runStatus,
    stop_reason: stopReason ?? null,
    scope: { total_scoped_chunks: chunks.length, by_family: Object.fromEntries(byFamily), by_chunk_policy_version: Object.fromEntries(byPolicy), distinct_sources: bySource.size },
    identity_proof: {
      attempted: stats.attempted,
      embeddings_created_this_run: stats.created,
      embeddings_replay_resolved_total: stats.replay_resolved,
      duplicates: Number(finalTotal[0]!.count) - Number(finalDistinctHashes[0]!.count),
      failures: stats.failures,
      null_vectors: stats.null_vectors,
      dimension_mismatches: stats.dimension_mismatches,
    },
    operational_metrics: {
      total_wall_time_s: Math.round(wallTimeS),
      batches: stats.batches,
      requests: stats.requests,
      retries: stats.retries,
      chunks_per_second: pending.length > 0 ? Number((pending.length / wallTimeS).toFixed(2)) : null,
      provider_call_ms_total: stats.provider_call_ms_total,
      db_write_ms_total: stats.db_write_ms_total,
      estimated_tokens_this_run: estimatedTokens,
      cost_estimate_note: 'estimated from character count (~4 chars/token), embedContent response exposes no usage/token metadata -- not an exact billed figure',
    },
  };

  console.log('\n\n========== LEGAL-RETRIEVAL-BULK-EMBEDDING-01 SUMMARY ==========');
  console.log(JSON.stringify(summary, null, 2));

  await prisma.$disconnect();
  if (runStatus !== 'PROVEN') process.exitCode = 2;
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
