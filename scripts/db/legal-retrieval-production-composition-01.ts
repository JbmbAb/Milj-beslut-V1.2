/**
 * LEGAL-RETRIEVAL-PRODUCTION-COMPOSITION-01 -- real end-to-end proof.
 *
 * Exercises the real, Prisma/Gemini-backed performLegalRetrieval() against the live governed
 * corpus for one query per family, proving the full composed chain works end to end with real
 * data: query -> family routing -> LegalRetrievalPolicy -> law metadata router (law only) ->
 * governed embedding search -> exact fragment/materialization resolution ->
 * RetrievalExecutionTrace -> RetrievalResult -> provenance.
 *
 * Usage: npx tsx scripts/db/legal-retrieval-production-composition-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import {
  createLegalRetrievalComposition,
  performLegalRetrieval,
} from '../../server/modules/legal/retrieval/LegalRetrievalComposition';

async function main() {
  console.log('########## LEGAL-RETRIEVAL-PRODUCTION-COMPOSITION-01 ##########\n');
  const deps = createLegalRetrievalComposition();

  const cases = [
    { label: 'law (multi-source routing engaged)', request: { query: 'Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av djurhållning?', family: 'law' as const, topK: 5 } },
    { label: 'law (single-source + chapter routing engaged)', request: { query: 'enligt 7 kap. miljöbalken gäller följande hänsynsregler', family: 'law' as const, topK: 5 } },
    { label: 'court (routing bypassed, plain vector path)', request: { query: 'Mark- och miljööverdomstolens dom i mål M 307-24', family: 'court' as const, topK: 5 } },
    { label: 'standard (routing bypassed, plain vector path)', request: { query: 'Hur borrar man en brunn på rätt sätt?', family: 'standard' as const, topK: 5 } },
    { label: 'no family specified (unconstrained across all families)', request: { query: 'miljöfarlig verksamhet', topK: 5 } },
  ];

  for (const { label, request } of cases) {
    console.log(`\n--- ${label} ---`);
    console.log('query:', request.query, '| family:', request.family ?? '(none)');
    const outcome = await performLegalRetrieval(request, deps);
    console.log('routing:', outcome.routing ? JSON.stringify(outcome.routing.source_candidates) : 'null (unconstrained)');
    console.log('trace.expansion_path:', outcome.trace.identity.expansion_path);
    console.log('trace.query_hash:', outcome.trace.identity.query_hash.slice(0, 16) + '...');
    console.log('trace.trace_hash:', outcome.trace.trace_hash.slice(0, 16) + '...');
    console.log('results:', outcome.results.length);
    for (const r of outcome.results.slice(0, 3)) {
      console.log(`  fragment_id=${r.fragment_id.slice(0, 24)}... materialization_id=${r.materialization_id} score=${r.score.toFixed(4)} resolved=${r.resolved_against_governed_chunk}`);
    }
  }

  console.log('\n\n========== SUMMARY ==========');
  console.log('All cases completed without a fatal error. Provenance is enforced INSIDE performLegalRetrieval (a mismatched hit is dropped, never returned) -- every result printed above is, by construction, already provenance-intact.');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
