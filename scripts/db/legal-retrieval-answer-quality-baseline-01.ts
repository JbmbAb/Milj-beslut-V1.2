/**
 * LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01.
 *
 * A larger, frozen answer/citation quality baseline -- deliberately separate from whether the
 * chain works TECHNICALLY (already proven: LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01,
 * -BULK-EMBEDDING-01, -RAG-ANSWER-COMPOSITION-01's 10 required proofs + live structural checks).
 * This measures answer QUALITY under governed citation constraints: does the model say the right
 * thing, cite the right thing, and refuse only when it should.
 *
 * 40 queries (well above the owner's 30 minimum), built from THREE already-verified sources, never
 * hand-picked new "easy" cases:
 *   - 24 queries verbatim from LEGAL-RETRIEVAL-QUALITY-BASELINE-01 (8 law, 10 court, 6 standard) --
 *     each already has a real, DB-verified acceptable-fragment scope.
 *   - 10 queries selected from LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01's 27 (never seen by any
 *     prior retrieval-tuning decision in this track) -- covering explicit_source,
 *     explicit_source_chapter, implicit_source, multi_statute, and ambiguous_by_design.
 *   - 6 NEW, deliberately hard/insufficient-evidence queries this unit adds: two are the exact
 *     zero-evidence cases already run once in LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01's
 *     10-case battery (kept for continuity), four are new (EU directive not materialized in this
 *     corpus, a fabricated court case number, an extremely vague question, and a leading/
 *     false-premise question) -- none has a known acceptable evidence scope BY DESIGN; the correct
 *     outcome is INSUFFICIENT_EVIDENCE (a GOOD_REFUSAL), and this run measures whether that is
 *     what actually happens, not whether it can be forced to look good.
 *
 * FROZEN answer configuration for this entire run (see printed banner below) -- NO tuning of
 * retrieval, context assembly, prompt, model, schema, or citation contract happens during or
 * because of this run. This is a measurement grate, not an optimization pass.
 *
 * Every query is auto-classified where a ground-truth acceptable-fragment scope exists
 * (RETRIEVAL_MISS / FALSE_REFUSAL / GOOD_REFUSAL candidates, via independent DB containment
 * checks -- never trusting the composition's own internal state). For ANSWERED cases, every
 * admitted claim is printed side-by-side with the REAL text of every fragment it cites, so a human
 * reviewer can judge answer correctness / citation correctness / unsupported claims / overclaim
 * without re-deriving anything from memory. That review is written up by hand in the PROVEN doc,
 * not auto-graded here.
 *
 * Usage: npx tsx scripts/db/legal-retrieval-answer-quality-baseline-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import { LEGAL_RETRIEVAL_POLICY_VERSION } from '@miljobeslut/mps-retrieval-governance';
import {
  DEFAULT_ANSWER_CONTEXT_POLICY,
  LEGAL_ANSWER_CITATION_CONTRACT_VERSION,
  LEGAL_ANSWER_CONTEXT_CONTRACT_VERSION,
  LEGAL_ANSWER_TRACE_CONTRACT_VERSION,
} from '@miljobeslut/mps-legal-answer-contract';
import {
  composeLegalAnswer,
  createLegalAnswerComposition,
  LEGAL_ANSWER_COMPOSITION_VERSION,
} from '../../server/modules/legal/answer/LegalAnswerComposition';
import {
  createLegalRetrievalComposition,
  LEGAL_RETRIEVAL_COMPOSITION_VERSION,
  type LegalFamily,
} from '../../server/modules/legal/retrieval/LegalRetrievalComposition';
import {
  ANSWER_MODEL_ID,
  ANSWER_MODEL_VERSION,
  ANSWER_PIPELINE_VERSION,
  ANSWER_PROMPT_VERSION,
  ANSWER_RESPONSE_SCHEMA_VERSION,
} from '../../server/modules/legal/answer/GeminiAnswerModelProvider';
import { QUERIES as BASELINE_QUERIES, resolveAcceptableFragmentIds as resolveBaselineFragmentIds } from './legal-retrieval-quality-baseline-01';

interface AcceptableScope {
  readonly logicalSourceId: string;
  readonly chapter?: string;
  readonly materializationId?: string;
}

interface BQuery {
  readonly id: string;
  readonly query: string;
  readonly family: LegalFamily | undefined;
  readonly source_group: 'baseline_law' | 'baseline_court' | 'baseline_standard' | 'holdout_law' | 'hard_insufficient';
  /** undefined = deliberately no known acceptable evidence (expect INSUFFICIENT_EVIDENCE). */
  readonly acceptable_scopes?: readonly AcceptableScope[];
}

// ---- 24 baseline queries, unchanged, wrapped with their family + a resolver closure ----
const BASELINE: BQuery[] = BASELINE_QUERIES.map((q) => ({
  id: q.query_id,
  query: q.query,
  family: q.expected_family,
  source_group: q.category === 'law' ? 'baseline_law' : q.category === 'standard' ? 'baseline_standard' : 'baseline_court',
}));

// ---- 10 queries selected from the 27-query LAW-METADATA-HOLDOUT-01 set (verbatim text/scopes) ----
const MB = 'regeringskansliet-sfs-1998-808';
const MPF = 'regeringskansliet-sfs-2013-251';
const AVF = 'regeringskansliet-sfs-2020-614';
const PBL = 'regeringskansliet-sfs-2010-900';
const MFH_2011 = 'regeringskansliet-sfs-2011-338';
const MFH_1998 = 'regeringskansliet-sfs-1998-899';

const HOLDOUT_SELECTION: BQuery[] = [
  { id: 'H1', query: 'Vad reglerar miljöprövningsförordningen när det gäller jordbruk och djurhållning?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: MPF, chapter: '2' }] },
  { id: 'H6', query: 'Vad regleras i 3 kap. plan- och bygglagen om planläggning som också prövas enligt annan lag?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: PBL, chapter: '3' }] },
  { id: 'H9', query: 'Vad föreskrivs i 3 kap. avfallsförordningen?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: AVF, chapter: '3' }] },
  { id: 'H12', query: 'Vilka regler gäller för byggande och underhåll av byggnadsverk?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: PBL, chapter: '1' }] },
  { id: 'H16', query: 'Vilka bestämmelser gäller för hissar och andra motordrivna anordningar ur hälsoskyddssynpunkt?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: MFH_2011, chapter: '2' }] },
  { id: 'H18', query: 'Hur förhåller sig avfallsförordningens 2 kap. till miljöbalkens bestämmelser i 2 kap.?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: AVF, chapter: '2' }, { logicalSourceId: MB, chapter: '2' }] },
  { id: 'H21', query: 'Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av djurhållning?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: MPF, chapter: '2' }, { logicalSourceId: MB, chapter: '1' }] },
  { id: 'H23', query: 'Vad säger förordningen om miljöfarlig verksamhet och hälsoskydd om anmälan?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: MFH_1998, chapter: '1' }, { logicalSourceId: MFH_2011, chapter: '1' }] },
  { id: 'H24', query: 'Vad krävs för anmälan enligt kapitel 1?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: MB, chapter: '1' }, { logicalSourceId: MPF, chapter: '1' }, { logicalSourceId: AVF, chapter: '1' }, { logicalSourceId: PBL, chapter: '1' }, { logicalSourceId: MFH_2011, chapter: '1' }, { logicalSourceId: MFH_1998, chapter: '1' }] },
  { id: 'H26', query: 'Vad regleras i miljölagstiftningen om byggande och miljöfarlig verksamhet?', family: 'law', source_group: 'holdout_law', acceptable_scopes: [{ logicalSourceId: MB, chapter: '1' }, { logicalSourceId: PBL, chapter: '1' }, { logicalSourceId: MFH_1998, chapter: '1' }, { logicalSourceId: MFH_2011, chapter: '1' }] },
];

// ---- 6 deliberately hard / insufficient-evidence queries -- no acceptable scope BY DESIGN ----
const HARD_INSUFFICIENT: BQuery[] = [
  { id: 'X1', query: 'Vad är bästa receptet på köttbullar?', family: undefined, source_group: 'hard_insufficient' },
  { id: 'X2', query: 'Vilka skatteregler gäller för aktiebolag enligt inkomstskattelagen?', family: 'law', source_group: 'hard_insufficient' },
  { id: 'X3', query: 'Vad säger EU:s art- och habitatdirektiv om skyddade arter?', family: 'law', source_group: 'hard_insufficient' },
  { id: 'X4', query: 'Mark- och miljööverdomstolens dom i mål M 99999-99', family: 'court', source_group: 'hard_insufficient' },
  { id: 'X5', query: 'Vad gäller?', family: undefined, source_group: 'hard_insufficient' },
  { id: 'X6', query: 'Varför är det enligt miljöbalken förbjudet att borra brunnar utan tillstånd från Naturvårdsverket?', family: 'law', source_group: 'hard_insufficient' },
];

const ALL_QUERIES: BQuery[] = [...BASELINE, ...HOLDOUT_SELECTION, ...HARD_INSUFFICIENT];

async function resolveScopeFragmentIds(scopes: readonly AcceptableScope[]): Promise<Set<string>> {
  const all = new Set<string>();
  for (const scope of scopes) {
    if (scope.materializationId !== undefined) {
      const materializationId = scope.materializationId || (await prisma.legalCorpusMaterialization.findFirst({ where: { logicalSourceId: scope.logicalSourceId } }))?.id;
      if (!materializationId) continue;
      const chunks = await prisma.legalCorpusMaterializedChunk.findMany({ where: { materializationId }, select: { fragmentId: true } });
      chunks.forEach((c) => all.add(c.fragmentId));
    } else if (scope.chapter) {
      const mats = await prisma.legalCorpusMaterialization.findMany({ where: { logicalSourceId: scope.logicalSourceId } });
      const chunks = await prisma.legalCorpusMaterializedChunk.findMany({
        where: { materializationId: { in: mats.map((m) => m.id) }, chapter: scope.chapter },
        select: { fragmentId: true },
      });
      chunks.forEach((c) => all.add(c.fragmentId));
    }
  }
  return all;
}

async function resolveAcceptableFragmentIds(bq: BQuery): Promise<Set<string> | null> {
  if (!bq.acceptable_scopes) {
    // Baseline queries carry their own scope shape -- reuse the exact, already-verified resolver.
    const baselineSpec = BASELINE_QUERIES.find((q) => q.query_id === bq.id);
    if (baselineSpec) return resolveBaselineFragmentIds(baselineSpec);
    return null; // hard_insufficient -- no known acceptable evidence, by design
  }
  return resolveScopeFragmentIds(bq.acceptable_scopes);
}

type RefusalVerdict = 'GOOD_REFUSAL' | 'FALSE_REFUSAL' | 'N/A';
type AnsweredEvidenceVerdict = 'RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE' | 'RETRIEVAL_MISS_BUT_ANSWERED' | 'NO_GROUND_TRUTH';

async function main() {
  console.log('########## LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01 ##########\n');
  console.log('FROZEN answer configuration for this entire run:');
  console.log('  retrieval_policy_version      :', LEGAL_RETRIEVAL_POLICY_VERSION);
  console.log('  retrieval_composition_version :', LEGAL_RETRIEVAL_COMPOSITION_VERSION);
  console.log('  context_assembly_version      :', LEGAL_ANSWER_CONTEXT_CONTRACT_VERSION, JSON.stringify(DEFAULT_ANSWER_CONTEXT_POLICY));
  console.log('  answer_composition_version    :', LEGAL_ANSWER_COMPOSITION_VERSION);
  console.log('  answer_model_id/version       :', ANSWER_MODEL_ID, '/', ANSWER_MODEL_VERSION);
  console.log('  answer_pipeline_version       :', ANSWER_PIPELINE_VERSION);
  console.log('  answer_prompt_version         :', ANSWER_PROMPT_VERSION);
  console.log('  answer_response_schema_version:', ANSWER_RESPONSE_SCHEMA_VERSION);
  console.log('  citation_contract_version     :', LEGAL_ANSWER_CITATION_CONTRACT_VERSION);
  console.log('  answer_trace_contract_version :', LEGAL_ANSWER_TRACE_CONTRACT_VERSION);
  console.log(`\nQuery set: ${ALL_QUERIES.length} total (${BASELINE.length} baseline + ${HOLDOUT_SELECTION.length} holdout + ${HARD_INSUFFICIENT.length} hard/insufficient)\n`);

  const retrievalDeps = createLegalRetrievalComposition();
  const deps = createLegalAnswerComposition(retrievalDeps);

  const rows: Record<string, unknown>[] = [];

  for (const bq of ALL_QUERIES) {
    console.log(`\n=== [${bq.id}] (${bq.source_group}) ===`);
    console.log('query:', bq.query, '| family:', bq.family ?? '(none)');

    let outcome: Awaited<ReturnType<typeof composeLegalAnswer>>;
    try {
      outcome = await composeLegalAnswer({ query: bq.query, family: bq.family, topK: 6 }, deps);
    } catch (error) {
      // A fail-closed AnswerModelError (e.g. the model returned non-JSON despite a structured
      // schema) is itself a real, valid observation for this baseline -- record it and continue,
      // never abort the whole battery over one query's transient model-output failure.
      console.log('!! composeLegalAnswer threw -- recording as MODEL_ERROR and continuing:', error instanceof Error ? error.message : error);
      rows.push({
        id: bq.id,
        group: bq.source_group,
        mode: 'MODEL_ERROR',
        claims: 0,
        containment: null,
        refusal_verdict: 'N/A',
        answered_verdict: 'NO_GROUND_TRUTH',
        provenance_intact: true,
        citations_within_set: true,
      });
      continue;
    }
    const acceptableIds = await resolveAcceptableFragmentIds(bq);
    // outcome.retrieval is null only for mode=QUERY_UNDERSPECIFIED (LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01,
    // added after this script was first written and proven) -- guarded here so a future rerun over
    // a query the gate now catches degrades to an empty retrieved set rather than throwing.
    const retrievedIds = new Set((outcome.retrieval?.results ?? []).map((r) => r.fragment_id));
    const containment = acceptableIds === null ? null : [...acceptableIds].some((id) => retrievedIds.has(id));

    let refusalVerdict: RefusalVerdict = 'N/A';
    let answeredVerdict: AnsweredEvidenceVerdict = 'NO_GROUND_TRUTH';

    if (outcome.mode === 'INSUFFICIENT_EVIDENCE') {
      if (acceptableIds === null) {
        refusalVerdict = 'GOOD_REFUSAL'; // by design -- no acceptable evidence exists
      } else {
        refusalVerdict = containment ? 'FALSE_REFUSAL' : 'GOOD_REFUSAL';
      }
    } else if (outcome.mode === 'ANSWERED' && acceptableIds !== null) {
      answeredVerdict = containment ? 'RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE' : 'RETRIEVAL_MISS_BUT_ANSWERED';
    }

    // Independent re-verification: provenance intact + citations within the retrieval set, exactly
    // as done live in LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01's battery -- never assumed.
    let provenanceIntact = true;
    let citationsWithinRetrievalSet = true;
    for (const claim of outcome.claims) {
      for (const citation of claim.citations) {
        if (citation.source_provenance_refs.length === 0) provenanceIntact = false;
        if (!retrievedIds.has(citation.fragment_id)) citationsWithinRetrievalSet = false;
      }
    }

    console.log('mode:', outcome.mode, '| ground_truth:', acceptableIds === null ? 'none (hard/insufficient by design)' : `${acceptableIds.size} acceptable fragments known`);
    console.log('retrieval-set containment (acceptable evidence reached retrieval):', containment);
    console.log('refusal verdict:', refusalVerdict, '| answered verdict:', answeredVerdict);
    console.log('claims admitted:', outcome.claims.length, '| provenance intact:', provenanceIntact, '| citations within retrieval set:', citationsWithinRetrievalSet);

    for (const [i, claim] of outcome.claims.entries()) {
      console.log(`  claim ${i + 1}: "${claim.text}"`);
      for (const citation of claim.citations) {
        const row = await prisma.legalCorpusMaterializedChunk.findUnique({
          where: { materializationId_fragmentId: { materializationId: citation.materialization_id, fragmentId: citation.fragment_id } },
        });
        const preview = (row?.chunkText ?? '(UNRESOLVED)').replace(/\s+/g, ' ').slice(0, 220);
        console.log(`    <- fragment_id=${citation.fragment_id.slice(0, 20)}... | passage: "${preview}${(row?.chunkText?.length ?? 0) > 220 ? '...' : ''}"`);
      }
    }

    rows.push({
      id: bq.id,
      group: bq.source_group,
      mode: outcome.mode,
      claims: outcome.claims.length,
      containment,
      refusal_verdict: refusalVerdict,
      answered_verdict: answeredVerdict,
      provenance_intact: provenanceIntact,
      citations_within_set: citationsWithinRetrievalSet,
    });
  }

  console.log('\n\n========== BASELINE SUMMARY TABLE ==========');
  console.table(rows);

  const goodRefusals = rows.filter((r) => r.refusal_verdict === 'GOOD_REFUSAL').length;
  const falseRefusals = rows.filter((r) => r.refusal_verdict === 'FALSE_REFUSAL').length;
  const retrievalMissButAnswered = rows.filter((r) => r.answered_verdict === 'RETRIEVAL_MISS_BUT_ANSWERED').length;
  const allProvenanceIntact = rows.every((r) => r.provenance_intact === true);
  const allCitationsWithinSet = rows.every((r) => r.citations_within_set === true);

  console.log('\n========== AUTOMATED (GROUND-TRUTH-BACKED) METRICS ==========');
  console.log('GOOD_REFUSAL count:', goodRefusals);
  console.log('FALSE_REFUSAL count:', falseRefusals, falseRefusals > 0 ? '(evidence was present, model declined anyway -- review these by hand)' : '');
  console.log('RETRIEVAL_MISS_BUT_ANSWERED count:', retrievalMissButAnswered, retrievalMissButAnswered > 0 ? '(answered without the known-acceptable evidence in its retrieval set -- review citation correctness closely)' : '');
  console.log('All admitted citations carry intact provenance:', allProvenanceIntact);
  console.log('All admitted citations are within their own query\'s retrieval set:', allCitationsWithinSet);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
