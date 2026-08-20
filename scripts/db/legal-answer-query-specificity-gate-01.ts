/**
 * LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01 -- real end-to-end proof.
 *
 * Confirms live, against the real composed chain, that the demonstrated gap from
 * LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01 ("Vad gäller?" -- answered with technically-real but
 * non-responsive citations) is now caught BEFORE retrieval, and that real, content-bearing queries
 * are entirely unaffected -- the gate is a narrow addition, not a general query-quality filter.
 *
 * Usage: npx tsx scripts/db/legal-answer-query-specificity-gate-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import { composeLegalAnswer, createLegalAnswerComposition } from '../../server/modules/legal/answer/LegalAnswerComposition';
import { createLegalRetrievalComposition } from '../../server/modules/legal/retrieval/LegalRetrievalComposition';

async function main() {
  console.log('########## LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01 ##########\n');
  const retrievalDeps = createLegalRetrievalComposition();
  const deps = createLegalAnswerComposition(retrievalDeps);

  console.log('--- PROOF 1: "Vad gäller?" (the exact X5 case from the frozen 40-query baseline) is now gated ---');
  const t0 = Date.now();
  const underspecified = await composeLegalAnswer({ query: 'Vad gäller?' }, deps);
  const elapsedMs = Date.now() - t0;
  console.log('mode:', underspecified.mode);
  console.log('querySpecificity:', JSON.stringify(underspecified.querySpecificity));
  console.log('retrieval:', underspecified.retrieval);
  console.log('claims:', underspecified.claims.length);
  console.log('answerTrace.query_run_identity:', underspecified.answerTrace.query_run_identity.slice(0, 16) + '...');
  console.log('elapsed:', elapsedMs, 'ms (no embedding/DB call expected -- should be near-instant)');
  const proof1 =
    underspecified.mode === 'QUERY_UNDERSPECIFIED' &&
    underspecified.retrieval === null &&
    underspecified.claims.length === 0 &&
    elapsedMs < 200;
  console.log('PROOF 1 (gated before retrieval, no fabricated claims, fast):', proof1);

  console.log('\n--- PROOF 2: previously-answered real queries are completely unaffected ---');
  const realQueries = [
    { label: 'L1 (single-source law)', query: 'Vad är miljöbalkens mål och tillämpningsområde?', family: 'law' as const },
    { label: 'S3 (standard)', query: 'Hur borrar man en brunn på rätt sätt?', family: 'standard' as const },
    { label: 'C6 (court citation)', query: 'Mark- och miljööverdomstolens dom i mål M 307-24', family: 'court' as const },
  ];
  let allRealQueriesUnaffected = true;
  for (const { label, query, family } of realQueries) {
    const outcome = await composeLegalAnswer({ query, family, topK: 6 }, deps);
    console.log(`  [${label}] querySpecificity=${outcome.querySpecificity.verdict} mode=${outcome.mode} retrieval_results=${outcome.retrieval?.results.length ?? 'null'} claims=${outcome.claims.length}`);
    if (outcome.querySpecificity.verdict !== 'SPECIFIED' || outcome.retrieval === null) {
      allRealQueriesUnaffected = false;
    }
  }
  console.log('PROOF 2 (real content-bearing queries all pass the gate and proceed to retrieval as before):', allRealQueriesUnaffected);

  console.log('\n\n========== SUMMARY ==========');
  console.log(JSON.stringify({ proof1, proof2: allRealQueriesUnaffected }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
