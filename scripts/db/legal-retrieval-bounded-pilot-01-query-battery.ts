/**
 * LEGAL-RETRIEVAL-BOUNDED-PILOT-01 -- retrieval-QUALITY battery.
 *
 * Deliberately separate from the identity/provenance proof (legal-retrieval-bounded-pilot-01.ts):
 * this measures whether real embeddings + a real similarity search actually find the right
 * governed chunk for a real query, not whether the identity/replay/fail-closed contract holds.
 * Both must be judged on their own terms, not blended into one pass/fail.
 *
 * Usage: run legal-retrieval-bounded-pilot-01.ts FIRST (this reads the rows it persisted).
 *   npx tsx scripts/db/legal-retrieval-bounded-pilot-01-query-battery.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import {
  buildRetrievalResult,
  createInMemoryGovernedChunkLookup,
  type GovernedChunkRef,
} from '@miljobeslut/mps-legal-retrieval-contract';
import { bindEmbeddingIdentity } from '@miljobeslut/mps-embedding-identity';
import { evaluateLegalRetrieval } from '@miljobeslut/mps-retrieval-governance';
import { createGeminiEmbeddingProvider } from '../../server/modules/legal/retrieval/GeminiEmbeddingProvider';
import { fetchGovernedChunkRefs } from '../../server/modules/legal/retrieval/LegalCorpusChunkEmbeddingPersistence';

interface QuerySpec {
  readonly query: string;
  readonly expected_family: string;
  /** A predicate over a hit row deciding whether THIS hit counts as "correct" for this query. */
  readonly isCorrect: (hit: HitRow) => boolean;
  readonly expected_description: string;
}

interface HitRow {
  fragment_id: string;
  materialization_id: string;
  chapter: string | null;
  court_section: string | null;
  chunk_text: string;
  source_family: string;
  title: string;
  distance: number;
}

const QUERIES: QuerySpec[] = [
  {
    query: 'Vad är miljöbalkens mål och tillämpningsområde?',
    expected_family: 'SFS',
    expected_description: 'Miljöbalken chapter 1 (mål/tillämpningsområde)',
    isCorrect: (hit) => hit.source_family === 'SFS' && hit.chapter === '1',
  },
  {
    query: 'Regeringens prövning av överklagade avgöranden enligt miljöbalken',
    expected_family: 'SFS',
    expected_description: 'Miljöbalken chapter 18 (regeringens prövning)',
    isCorrect: (hit) => hit.source_family === 'SFS' && hit.chapter === '18',
  },
  {
    query: 'Mark- och miljööverdomstolens dom i mål P 13258-25',
    expected_family: 'MMOD',
    expected_description: 'the specific MMÖD decision P 13258-25 (self-retrieval by case number)',
    isCorrect: (hit) => hit.title.includes('P_13258-25') || hit.title.includes('P 13258-25'),
  },
  {
    query: 'Mark- och miljööverdomstolens dom i mål M 6089-24',
    expected_family: 'MMOD',
    expected_description: 'the specific MMÖD decision M 6089-24 (self-retrieval by case number)',
    isCorrect: (hit) => hit.title.includes('M_6089-24') || hit.title.includes('M 6089-24'),
  },
  {
    query: 'Mark- och miljööverdomstolens dom i mål P 1329-26',
    expected_family: 'MMOD',
    expected_description: 'the specific MMÖD decision P 1329-26 (self-retrieval by case number)',
    isCorrect: (hit) => hit.title.includes('P_1329-26') || hit.title.includes('P 1329-26'),
  },
  {
    query: 'Hur borrar man en brunn på rätt sätt enligt SGU:s vägledning?',
    expected_family: 'SGU',
    expected_description: 'SGU vägledning för att borra brunn',
    isCorrect: (hit) => hit.source_family === 'SGU',
  },
];

async function search(
  queryVector: readonly number[],
  modelId: string,
  pipelineVersion: string,
  topK = 5,
): Promise<HitRow[]> {
  const vectorLiteral = `[${queryVector.join(',')}]`;
  return prisma.$queryRawUnsafe<HitRow[]>(
    `SELECT
       e.fragment_id, e.materialization_id, c.chapter, c.court_section, c.chunk_text,
       rec.source_family AS source_family, rec.title,
       (e.embedding_vector <=> $1::vector) AS distance
     FROM "legal_corpus_chunk_embeddings" e
     JOIN "legal_corpus_materialized_chunks" c
       ON c.materialization_id = e.materialization_id AND c.fragment_id = e.fragment_id
     JOIN "legal_corpus_records" rec ON rec.id = c.record_id
     WHERE e.embedding_model_id = $2 AND e.embedding_pipeline_version = $3
     ORDER BY e.embedding_vector <=> $1::vector
     LIMIT $4`,
    vectorLiteral,
    modelId,
    pipelineVersion,
    topK,
  );
}

async function main() {
  console.log('########## LEGAL-RETRIEVAL-BOUNDED-PILOT-01 -- retrieval-quality battery ##########\n');
  const provider = createGeminiEmbeddingProvider();
  const decision = evaluateLegalRetrieval('LEGAL_CORPUS_SEARCH');

  const report: Record<string, unknown>[] = [];

  for (const spec of QUERIES) {
    const [queryVector] = await provider.embedBatch([spec.query]);
    const hits = await search(queryVector!, provider.model_id, provider.pipeline_version, 5);

    const top1Correct = hits.length > 0 && spec.isCorrect(hits[0]!);
    const top3Correct = hits.slice(0, 3).some((h) => spec.isCorrect(h));
    const top5Correct = hits.some((h) => spec.isCorrect(h));

    // Provenance-intact check: does the top hit actually resolve back through the governed
    // chunk contract (not just "a row came back from SQL")?
    let provenanceIntact = false;
    if (hits.length > 0) {
      const top = hits[0]!;
      const refs: GovernedChunkRef[] = await fetchGovernedChunkRefs([top.fragment_id]);
      const lookup = createInMemoryGovernedChunkLookup(refs);
      const chunkRow = await prisma.legalCorpusMaterializedChunk.findUnique({
        where: { materializationId_fragmentId: { materializationId: top.materialization_id, fragmentId: top.fragment_id } },
      });
      try {
        const identity = bindEmbeddingIdentity({
          fragment_id: top.fragment_id,
          materialization_id: top.materialization_id,
          chunk_content_hash: chunkRow!.contentHash,
          embedding_model_id: provider.model_id,
          embedding_model_version: provider.model_version,
          embedding_pipeline_version: provider.pipeline_version,
        });
        const result = buildRetrievalResult(
          {
            fragment_id: top.fragment_id,
            materialization_id: top.materialization_id,
            source_provenance_refs: [`materialization:${top.materialization_id}`],
            embedding_identity: identity,
            retrieval_policy_version: decision.policy.policy_version,
            query_run_identity: `query-battery:${spec.query.slice(0, 20)}`,
            score: 1 - top.distance,
            rank: 1,
          },
          lookup,
        );
        provenanceIntact = result.resolved_against_governed_chunk;
      } catch {
        provenanceIntact = false;
      }
    }

    console.log(`\nQUERY: "${spec.query}"`);
    console.log('  expected:', spec.expected_description);
    console.log('  top-5 hits:', hits.map((h, i) => `#${i + 1} [${h.source_family}${h.chapter ? ` ch.${h.chapter}` : ''}${h.court_section ? ` ${h.court_section}` : ''}] "${h.title}" dist=${h.distance.toFixed(4)}`));
    console.log('  correct in top-1/top-3/top-5:', top1Correct, '/', top3Correct, '/', top5Correct);
    console.log('  top-1 score (1-distance):', hits[0] ? (1 - hits[0].distance).toFixed(4) : 'n/a', '| provenance intact:', provenanceIntact);

    report.push({
      query: spec.query,
      expected_family: spec.expected_family,
      expected_description: spec.expected_description,
      top1_hit: hits[0] ? { family: hits[0].source_family, title: hits[0].title, chapter: hits[0].chapter, court_section: hits[0].court_section, distance: hits[0].distance } : null,
      correct_in_top1: top1Correct,
      correct_in_top3: top3Correct,
      correct_in_top5: top5Correct,
      top1_score: hits[0] ? 1 - hits[0].distance : null,
      provenance_intact: provenanceIntact,
    });
  }

  const correctTop1 = report.filter((r) => r.correct_in_top1).length;
  const correctTop3 = report.filter((r) => r.correct_in_top3).length;
  const correctTop5 = report.filter((r) => r.correct_in_top5).length;

  console.log('\n\n========== RETRIEVAL-QUALITY BATTERY SUMMARY ==========');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\ncorrect@1: ${correctTop1}/${QUERIES.length} | correct@3: ${correctTop3}/${QUERIES.length} | correct@5: ${correctTop5}/${QUERIES.length}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
