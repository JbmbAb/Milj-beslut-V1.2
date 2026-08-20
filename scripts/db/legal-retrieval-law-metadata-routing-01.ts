/**
 * LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01.
 *
 * Reruns the EXACT SAME 24 queries from LEGAL-RETRIEVAL-QUALITY-BASELINE-01 (imported, not
 * copied -- see that file's QUERIES export) with one change: for `law`-category queries, if
 * routeLawQuery() finds an explicit statute/chapter signal in the query text, the vector search
 * is constrained to that source (and chapter, if named) before ranking. `court`/`court_citation`/
 * `standard` queries run through the exact same unconstrained search as the baseline -- routing
 * only makes sense once already inside the law family (a separate, not-yet-built "family
 * routing" step per the design), so those categories cannot regress by construction, not just by
 * observation.
 *
 * This is a COMPARISON run against the frozen baseline, not a replacement of it or a retune of
 * the 24 queries -- the baseline file and its scoring logic (resolveAcceptableFragmentIds,
 * classifyFailure, provenanceIntact) are imported unchanged.
 *
 * Usage: npx tsx scripts/db/legal-retrieval-law-metadata-routing-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import { evaluateLegalRetrieval } from '@miljobeslut/mps-retrieval-governance';
import { createGeminiEmbeddingProvider } from '../../server/modules/legal/retrieval/GeminiEmbeddingProvider';
import { describeRoutingDecision, routeLawQuery, type RoutingDecision } from '../../server/modules/legal/retrieval/LawSourceRouter';
import { buildCandidateWhereClause } from '../../server/modules/legal/retrieval/LawSourceRoutingSql';
import {
  classifyFailure,
  provenanceIntact,
  QUERIES,
  resolveAcceptableFragmentIds,
  type HitRow,
} from './legal-retrieval-quality-baseline-01';

async function searchRouted(
  queryVector: readonly number[],
  modelId: string,
  pipelineVersion: string,
  decision: RoutingDecision,
  topK = 10,
): Promise<HitRow[]> {
  const vectorLiteral = `[${queryVector.join(',')}]`;
  const baseParams: unknown[] = [vectorLiteral, modelId, pipelineVersion];
  const where = buildCandidateWhereClause(decision, baseParams.length);
  const params = [...baseParams, ...where.params, topK];
  const topKParam = `$${params.length}`;

  return prisma.$queryRawUnsafe<HitRow[]>(
    `SELECT
       e.fragment_id, e.materialization_id, c.chapter, c.court_section, c.structure_kind,
       m.logical_source_id, rec.title,
       (e.embedding_vector <=> $1::vector) AS distance
     FROM "legal_corpus_chunk_embeddings" e
     JOIN "legal_corpus_materialized_chunks" c
       ON c.materialization_id = e.materialization_id AND c.fragment_id = e.fragment_id
     JOIN "legal_corpus_materializations" m ON m.id = c.materialization_id
     JOIN "legal_corpus_records" rec ON rec.id = c.record_id
     WHERE e.embedding_model_id = $2 AND e.embedding_pipeline_version = $3
       ${where.sql}
     ORDER BY e.embedding_vector <=> $1::vector
     LIMIT ${topKParam}`,
    ...params,
  );
}

async function main() {
  console.log('########## LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01 (comparison run) ##########\n');
  const provider = createGeminiEmbeddingProvider();
  const decision = evaluateLegalRetrieval('LEGAL_CORPUS_SEARCH');

  const results: Record<string, unknown>[] = [];

  for (const spec of QUERIES) {
    const acceptable = await resolveAcceptableFragmentIds(spec);
    const routing: RoutingDecision = spec.category === 'law' ? routeLawQuery(spec.query) : { routing_version: 'n/a', source_candidates: [] };
    const routingLabel = spec.category === 'law' ? describeRoutingDecision(routing) : 'not_applicable_outside_law_family';

    const [queryVector] = await provider.embedBatch([spec.query]);
    const hits = await searchRouted(queryVector!, provider.model_id, provider.pipeline_version, routing, 10);

    let firstCorrectRank: number | null = null;
    for (let i = 0; i < hits.length; i++) {
      if (acceptable.has(hits[i]!.fragment_id)) { firstCorrectRank = i + 1; break; }
    }
    const top1 = firstCorrectRank === 1;
    const top3 = firstCorrectRank !== null && firstCorrectRank <= 3;
    const top5 = firstCorrectRank !== null && firstCorrectRank <= 5;
    const top10 = firstCorrectRank !== null && firstCorrectRank <= 10;
    const reciprocalRank = firstCorrectRank ? 1 / firstCorrectRank : 0;
    const failureMode = classifyFailure(spec, hits, acceptable, firstCorrectRank);
    const top1ProvenanceIntact = hits.length > 0 ? await provenanceIntact(hits[0]!, provider, decision.policy.policy_version) : false;

    console.log(`\n[${spec.query_id}/${spec.category}] "${spec.query}"`);
    console.log(`  routing: ${routingLabel}`);
    console.log(`  top-3 hits:`, hits.slice(0, 3).map((h, i) => `#${i + 1} [${h.structure_kind}/${h.logical_source_id}${h.chapter ? ` ch.${h.chapter}` : ''}] dist=${h.distance.toFixed(4)}${acceptable.has(h.fragment_id) ? ' ✓CORRECT' : ''}`));
    console.log(`  first correct rank: ${firstCorrectRank ?? 'not in top-10'} | RR=${reciprocalRank.toFixed(3)} | top1/3/5/10: ${top1}/${top3}/${top5}/${top10} | failure_mode: ${failureMode}`);

    results.push({
      query_id: spec.query_id, query: spec.query, category: spec.category,
      routing_decision: routingLabel,
      top1, top3, top5, top10, reciprocal_rank: reciprocalRank, first_correct_rank: firstCorrectRank,
      failure_mode: failureMode, top1_provenance_intact: top1ProvenanceIntact,
    });
  }

  console.log('\n\n========== ROUTING COMPARISON RUN — RAW RESULTS ==========');
  console.log(JSON.stringify(results, null, 2));

  const byCategory = new Map<string, typeof results>();
  for (const r of results) {
    const key = r.category as string;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(r);
  }
  const agg = (rows: typeof results) => ({
    n: rows.length,
    top1: rows.filter((r) => r.top1).length,
    top3: rows.filter((r) => r.top3).length,
    top5: rows.filter((r) => r.top5).length,
    top10: rows.filter((r) => r.top10).length,
    mrr: Number((rows.reduce((s, r) => s + (r.reciprocal_rank as number), 0) / rows.length).toFixed(3)),
  });

  console.log('\n--- Aggregate (routed run) ---');
  console.log('overall:', agg(results));
  for (const [cat, rows] of byCategory) console.log(`  ${cat}:`, agg(rows));

  const routedCount = results.filter((r) => (r.routing_decision as string).includes('sources=')).length;
  console.log(`\nlaw queries with a routing constraint applied: ${routedCount} of ${byCategory.get('law')?.length ?? 0}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
