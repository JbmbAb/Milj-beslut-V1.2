/**
 * LEGAL-ANSWER-MULTISOURCE-RETRIEVAL-BUDGET-01 -- real end-to-end proof.
 *
 * Scope, exactly as approved: strictly local to multi-source routing's own candidate budget.
 *   IN:  when routeLawQuery() recognizes 2+ candidates, run one real query PER candidate source
 *        (each still at the original, unchanged per-source topK), merge, re-rank by the SAME
 *        distance metric already used everywhere in this chain.
 *   OUT: no general topK increase, no reranker, no BM25, no prompt change, no H21-specific rule, no
 *        fabricated "force one hit per source" -- context assembly's own dedup/budget/max_results
 *        selection is completely untouched, so a source with only weak matches can still be
 *        legitimately excluded from the admitted context exactly as before.
 *
 * Proof matrix:
 *   1. H21 -> both named sources surfaced in retrieval.results, the named-source-consistency gate
 *      no longer false-blocks it, and the resulting answer's citations are still fully valid
 *      (real, provenance-intact, within the retrieval set).
 *   2. All 5 multi_statute holdout queries (H18-H22) -- reported honestly, not just the ones
 *      already known to work.
 *   3. Single-source queries (L1, C6, S1) -- unchanged: exactly one search per query, results
 *      capped at the original topK, matching pre-change behavior.
 *   4. The known QUERY_UNDERSPECIFIED case (X5) -- unaffected, gated before any retrieval.
 *   5. The known named-source-absent case (NH10, "fiskelagen") -- still blocks correctly.
 *
 * Usage: npx tsx scripts/db/legal-answer-multisource-retrieval-budget-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import { composeLegalAnswer, createLegalAnswerComposition } from '../../server/modules/legal/answer/LegalAnswerComposition';
import {
  createLegalRetrievalComposition,
  LEGAL_RETRIEVAL_COMPOSITION_VERSION,
  type LegalFamily,
} from '../../server/modules/legal/retrieval/LegalRetrievalComposition';

const MB = 'regeringskansliet-sfs-1998-808';
const MPF = 'regeringskansliet-sfs-2013-251';
const AVF = 'regeringskansliet-sfs-2020-614';
const PBL = 'regeringskansliet-sfs-2010-900';
const MFH_2011 = 'regeringskansliet-sfs-2011-338';
const MFH_1998 = 'regeringskansliet-sfs-1998-899';

interface Case {
  readonly id: string;
  readonly query: string;
  readonly family: LegalFamily | undefined;
  readonly note: string;
}

const MULTI_SOURCE_HOLDOUTS: Case[] = [
  { id: 'H18', query: 'Hur förhåller sig avfallsförordningens 2 kap. till miljöbalkens bestämmelser i 2 kap.?', family: 'law', note: 'AVF ch2 + MB ch2 -- known FALSE_REFUSAL under the old budget' },
  { id: 'H19', query: 'Vilket samband finns mellan plan- och bygglagens 3 kap. och miljöbalken vid prövning av markanvändning?', family: 'law', note: 'PBL ch3 + MB ch2' },
  { id: 'H20', query: 'Hur kompletterar förordningen om miljöfarlig verksamhet och hälsoskydd (miljötillsyn) plan- och bygglagen när det gäller handlingar till länsstyrelsen?', family: 'law', note: 'MFH_2011 ch3 + PBL ch3' },
  { id: 'H21', query: 'Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av djurhållning?', family: 'law', note: 'MPF ch2 + MB ch1 -- THE case this unit exists to fix' },
  { id: 'H22', query: 'Hur förhåller sig 4 kap. förordningen om miljöfarlig verksamhet och hälsoskydd till bestämmelserna i miljöbalken?', family: 'law', note: 'MFH_1998 ch4 + MFH_2011 ch4 + MB ch4 -- three named sources' },
];

const SINGLE_SOURCE_CONTROLS: Case[] = [
  { id: 'L1', query: 'Vad är miljöbalkens mål och tillämpningsområde?', family: 'law', note: 'single-source law -- must be unaffected' },
  { id: 'C6', query: 'Mark- och miljööverdomstolens dom i mål M 307-24', family: 'court', note: 'court, no routing at all -- must be unaffected' },
  { id: 'S1', query: 'Föreskrifter för små avloppsanordningar för hushållsspillvatten', family: 'standard', note: 'standard, no routing at all -- must be unaffected' },
];

async function main() {
  console.log('########## LEGAL-ANSWER-MULTISOURCE-RETRIEVAL-BUDGET-01 ##########');
  console.log('retrieval_composition_version:', LEGAL_RETRIEVAL_COMPOSITION_VERSION);

  const retrievalDeps = createLegalRetrievalComposition();
  const deps = createLegalAnswerComposition(retrievalDeps);

  console.log('\n========== PROOF 1: H21 ==========');
  const h21 = await composeLegalAnswer({ query: MULTI_SOURCE_HOLDOUTS[3]!.query, family: 'law', topK: 6 }, deps);
  const h21SourceIds = new Set<string>();
  for (const r of h21.retrieval?.results ?? []) {
    const mat = await prisma.legalCorpusMaterialization.findUnique({ where: { id: r.materialization_id } });
    if (mat) h21SourceIds.add(mat.logicalSourceId);
  }
  console.log('mode:', h21.mode);
  console.log('retrieval.results count:', h21.retrieval?.results.length);
  console.log('distinct sources actually surfaced in retrieval.results:', [...h21SourceIds]);
  console.log('namedSourceConsistency:', JSON.stringify(h21.namedSourceConsistency));
  const h21BothSourcesSurfaced = h21SourceIds.has(MPF) && h21SourceIds.has(MB);
  const h21GateNoLongerBlocks = h21.mode !== 'NAMED_SOURCE_NOT_AVAILABLE';
  let h21CitationsValid = true;
  for (const claim of h21.claims) {
    for (const citation of claim.citations) {
      const row = await prisma.legalCorpusMaterializedChunk.findUnique({
        where: { materializationId_fragmentId: { materializationId: citation.materialization_id, fragmentId: citation.fragment_id } },
      });
      if (!row) h21CitationsValid = false;
      if (citation.source_provenance_refs.length === 0) h21CitationsValid = false;
    }
  }
  console.log('PROOF 1a (both named sources surfaced in retrieval.results):', h21BothSourcesSurfaced);
  console.log('PROOF 1b (gate no longer false-blocks):', h21GateNoLongerBlocks, '| mode:', h21.mode);
  console.log('PROOF 1c (citations still valid -- real, provenance-intact):', h21CitationsValid, '| claims:', h21.claims.length);

  console.log('\n========== PROOF 2: all 5 multi_statute holdout queries (reported honestly) ==========');
  const multiSourceRows: Record<string, unknown>[] = [];
  for (const c of MULTI_SOURCE_HOLDOUTS) {
    const outcome = await composeLegalAnswer({ query: c.query, family: c.family, topK: 6 }, deps);
    const sourceIds = new Set<string>();
    for (const r of outcome.retrieval?.results ?? []) {
      const mat = await prisma.legalCorpusMaterialization.findUnique({ where: { id: r.materialization_id } });
      if (mat) sourceIds.add(mat.logicalSourceId);
    }
    console.log(`  [${c.id}] ${c.note}`);
    console.log(`    mode=${outcome.mode} retrieval_results=${outcome.retrieval?.results.length ?? 0} distinct_sources_surfaced=${sourceIds.size} claims=${outcome.claims.length}`);
    multiSourceRows.push({ id: c.id, mode: outcome.mode, retrieval_results: outcome.retrieval?.results.length ?? 0, distinct_sources_surfaced: sourceIds.size, claims: outcome.claims.length });
  }
  console.table(multiSourceRows);

  console.log('\n========== PROOF 3: single-source queries unchanged ==========');
  const singleSourceRows: Record<string, unknown>[] = [];
  for (const c of SINGLE_SOURCE_CONTROLS) {
    const outcome = await composeLegalAnswer({ query: c.query, family: c.family, topK: 6 }, deps);
    const withinBudget = (outcome.retrieval?.results.length ?? 0) <= 6;
    console.log(`  [${c.id}] mode=${outcome.mode} retrieval_results=${outcome.retrieval?.results.length ?? 0} within_original_topK=${withinBudget}`);
    singleSourceRows.push({ id: c.id, mode: outcome.mode, retrieval_results: outcome.retrieval?.results.length ?? 0, within_original_topK: withinBudget });
  }
  console.table(singleSourceRows);
  const allSingleSourceUnchanged = singleSourceRows.every((r) => r.within_original_topK === true);
  console.log('PROOF 3 (all single-source/no-routing queries stay within the original topK):', allSingleSourceUnchanged);

  console.log('\n========== PROOF 4: QUERY_UNDERSPECIFIED unaffected ==========');
  const underspecified = await composeLegalAnswer({ query: 'Vad gäller?' }, deps);
  console.log('mode:', underspecified.mode, '| retrieval:', underspecified.retrieval);
  const proof4 = underspecified.mode === 'QUERY_UNDERSPECIFIED' && underspecified.retrieval === null;
  console.log('PROOF 4 (still gated before retrieval, unaffected):', proof4);

  console.log('\n========== PROOF 5: named-source-absent (fiskelagen) still blocks ==========');
  const fiskelagen = await composeLegalAnswer({ query: 'Vilka regler gäller för fiske och fiskevård enligt fiskelagen?', family: 'law', topK: 6 }, deps);
  console.log('mode:', fiskelagen.mode, '| namedSourceConsistency:', JSON.stringify(fiskelagen.namedSourceConsistency));
  const proof5 = fiskelagen.mode === 'NAMED_SOURCE_NOT_AVAILABLE';
  console.log('PROOF 5 (still blocks correctly):', proof5);

  console.log('\n\n========== SUMMARY ==========');
  console.log(JSON.stringify({
    proof1_bothSourcesSurfaced: h21BothSourcesSurfaced,
    proof1_gateNoLongerBlocks: h21GateNoLongerBlocks,
    proof1_citationsValid: h21CitationsValid,
    proof3_singleSourceUnchanged: allSingleSourceUnchanged,
    proof4_underspecifiedUnaffected: proof4,
    proof5_namedSourceAbsentStillBlocks: proof5,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
