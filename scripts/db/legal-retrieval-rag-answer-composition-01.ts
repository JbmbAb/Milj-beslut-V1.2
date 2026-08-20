/**
 * LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 -- real end-to-end proof + bounded battery.
 *
 * Exercises the real, Gemini-backed composeLegalAnswer() against the live governed corpus:
 *   query -> performLegalRetrieval() -> RetrievalResult[] -> LegalAnswerContextV1
 *     -> Gemini answer model (structured JSON) -> citation validation (buildCitation)
 *     -> AnswerTraceArtifact
 *
 * Two parts:
 *   1. Live re-verification of the governing invariant against the real corpus (mirrors the
 *      independent DB re-check pattern from LEGAL-RETRIEVAL-SERVING-BOUNDARY-01 proof 4): every
 *      citation any real battery query produces is checked to resolve to a real governed chunk
 *      row, INDEPENDENTLY of the composition's own internal enforcement.
 *   2. A bounded battery of 10 real queries across law / court / standard / multi-source law /
 *      ambiguous law / zero-evidence, reusing EXACT queries already verified against real DB
 *      content in LEGAL-RETRIEVAL-QUALITY-BASELINE-01 and LEGAL-RETRIEVAL-PRODUCTION-COMPOSITION-01
 *      -- never a hand-picked new set chosen to look good. Output is reviewed by hand for factual
 *      support, citation correctness, unsupported claims, omission, and trace completeness; that
 *      review is written up in the PROVEN doc, not auto-graded here.
 *
 * No new retrieval strategy, no UI, no free RAG chat -- this proves the answer layer alone.
 *
 * Usage: npx tsx scripts/db/legal-retrieval-rag-answer-composition-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import {
  composeLegalAnswer,
  createLegalAnswerComposition,
} from '../../server/modules/legal/answer/LegalAnswerComposition';
import { createLegalRetrievalComposition } from '../../server/modules/legal/retrieval/LegalRetrievalComposition';
import type { LegalFamily } from '../../server/modules/legal/retrieval/LegalRetrievalComposition';

interface BatteryCase {
  readonly label: string;
  readonly query: string;
  readonly family?: LegalFamily;
}

const BATTERY: BatteryCase[] = [
  { label: 'law: single-source, chapter-scoped (L1)', query: 'Vad är miljöbalkens mål och tillämpningsområde?', family: 'law' },
  { label: 'law: single-source, chapter-scoped (L4)', query: 'Bestämmelser om avfall och avfallshantering', family: 'law' },
  {
    label: 'law: multi-source (two named statutes)',
    query: 'Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av djurhållning?',
    family: 'law',
  },
  { label: 'law: ambiguous_by_design (L3 -- ch.9 named without disambiguating which statute)', query: 'Vilka verksamheter kräver tillstånd enligt 9 kap. miljöbalken?', family: 'law' },
  { label: 'court: topic-based (C1)', query: 'Tillåtlighet för deponi nära Stockholm, prövning av lämplig placering', family: 'court' },
  { label: 'court: case-number lookup (C6)', query: 'Mark- och miljööverdomstolens dom i mål M 307-24', family: 'court' },
  { label: 'standard: topic (S3)', query: 'Hur borrar man en brunn på rätt sätt?', family: 'standard' },
  { label: 'standard: topic (S1)', query: 'Föreskrifter för små avloppsanordningar för hushållsspillvatten', family: 'standard' },
  { label: 'zero/weak evidence: entirely out-of-corpus topic', query: 'Vad är bästa receptet på köttbullar?', family: undefined },
  { label: 'zero/weak evidence: in-domain-sounding but uncovered statute (inkomstskattelagen)', query: 'Vilka skatteregler gäller för aktiebolag enligt inkomstskattelagen?', family: 'law' },
];

async function main() {
  console.log('########## LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 ##########\n');
  const retrievalDeps = createLegalRetrievalComposition();
  const deps = createLegalAnswerComposition(retrievalDeps);

  let allCitationsRealAcrossBattery = true;
  let allCitationsWithinRetrievalSet = true;
  const summary: Record<string, unknown>[] = [];

  for (const { label, query, family } of BATTERY) {
    console.log(`\n=== ${label} ===`);
    console.log('query:', query, '| family:', family ?? '(none)');

    const outcome = await composeLegalAnswer({ query, family, topK: 6 }, deps);

    console.log('mode:', outcome.mode);
    // outcome.retrieval is null only for mode=QUERY_UNDERSPECIFIED (LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01,
    // added after this script was first written and proven) -- guarded here so a future rerun over
    // a query the gate now catches degrades cleanly rather than throwing.
    console.log('retrieval results:', outcome.retrieval?.results.length ?? '(none -- query gated before retrieval)');
    console.log('context selected:', outcome.context?.selection_order ?? '(no context -- insufficient evidence before context assembly)');
    console.log('claims admitted:', outcome.claims.length);

    const retrievedFragmentIds = new Set((outcome.retrieval?.results ?? []).map((r) => r.fragment_id));
    let caseCitationsReal = true;
    let caseCitationsWithinSet = true;

    for (const [i, claim] of outcome.claims.entries()) {
      console.log(`  claim ${i + 1}: "${claim.text}"`);
      for (const citation of claim.citations) {
        console.log(
          `    cites fragment_id=${citation.fragment_id} materialization_id=${citation.materialization_id} citation_id=${citation.citation_id.slice(0, 16)}...`,
        );

        // Independent re-verification against the live DB -- never trust the composition's own
        // internal enforcement alone (mirrors LEGAL-RETRIEVAL-SERVING-BOUNDARY-01 proof 4).
        const row = await prisma.legalCorpusMaterializedChunk.findUnique({
          where: { materializationId_fragmentId: { materializationId: citation.materialization_id, fragmentId: citation.fragment_id } },
        });
        if (!row) {
          caseCitationsReal = false;
          allCitationsRealAcrossBattery = false;
          console.log('    !! DOES NOT RESOLVE TO A REAL GOVERNED CHUNK');
        }
        if (!retrievedFragmentIds.has(citation.fragment_id)) {
          caseCitationsWithinSet = false;
          allCitationsWithinRetrievalSet = false;
          console.log('    !! CITED FRAGMENT WAS NOT PART OF THIS QUERY\'S RETRIEVAL SET');
        }
      }
    }

    console.log('answer_trace.query_run_identity:', outcome.answerTrace.query_run_identity.slice(0, 16) + '...');
    console.log('answer_trace.cited_fragment_ids:', outcome.answerTrace.cited_fragment_ids);
    console.log('answer_trace.answer_model_id/version/pipeline:', outcome.answerTrace.answer_model_id, outcome.answerTrace.answer_model_version, outcome.answerTrace.answer_pipeline_version);
    console.log('answer_trace.answer_trace_hash:', outcome.answerTrace.answer_trace_hash.slice(0, 16) + '...');

    summary.push({
      label,
      mode: outcome.mode,
      retrieval_results: outcome.retrieval?.results.length ?? 0,
      claims: outcome.claims.length,
      cited_fragments: outcome.answerTrace.cited_fragment_ids.length,
      citations_real: caseCitationsReal,
      citations_within_retrieval_set: caseCitationsWithinSet,
    });
  }

  console.log('\n\n========== BATTERY SUMMARY ==========');
  console.table(summary);

  console.log('\n========== STRUCTURAL PROOFS (live, real corpus + real Gemini) ==========');
  console.log('Every citation across the whole battery resolves to a real governed chunk:', allCitationsRealAcrossBattery);
  console.log('Every citation across the whole battery is within its own query\'s retrieval set:', allCitationsWithinRetrievalSet);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
