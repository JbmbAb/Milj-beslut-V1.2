/**
 * LEGAL-ANSWER-PROMPT-CALIBRATION-01 -- calibration set + new independent holdout.
 *
 * Scope, exactly as approved:
 *   IN:  prompt/version only (ANSWER_PROMPT_VERSION bumped to answer-prompt-v2 in
 *        GeminiAnswerModelProvider.ts), answer-model decision calibration, bounded synthesis
 *        behavior, a separate calibration set, a new independent holdout.
 *   OUT: retrieval policy, embedding model, context assembly, citation contract, the query
 *        specificity gate, reranker, hybrid/BM25 -- none of these were touched.
 *
 * Calibration target (frozen before this run):
 *   evidence sufficient for bounded synthesis -> ANSWER with explicit scope/caveat + citations
 *   evidence genuinely insufficient            -> INSUFFICIENT_EVIDENCE
 *   query underspecified                       -> QUERY_UNDERSPECIFIED (gate, unaffected by prompt)
 * Explicitly NOT a "always answer if any evidence exists" rule -- that would only trade false
 * refusals for overclaims.
 *
 * Two independent query sets in this one script, kept structurally separate per instruction:
 *   1. CALIBRATION_SET (10 queries) -- used for prompt development. Includes the two known
 *      FALSE_REFUSAL cases (H1, H18) this unit specifically targets, three known GOOD_REFUSAL
 *      cases (must remain refused), three known direct-factual ANSWERED cases (must remain
 *      correct, unaffected), and the known QUERY_UNDERSPECIFIED case (must remain gated).
 *   2. NEW_HOLDOUT_SET (10 queries) -- genuinely new: none of these chapters/combinations appear
 *      in LEGAL-RETRIEVAL-QUALITY-BASELINE-01's 24, LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01's 27,
 *      or this track's 40-query answer baseline. This is the FINAL GENERALIZATION PROOF -- if the
 *      new prompt only helps the two cases it was built against, that will show up here as no
 *      real improvement on this set's own synthesis-style queries.
 *
 * The FROZEN 40-query answer-quality baseline itself is reused UNMODIFIED as the regression
 * comparison (scripts/db/legal-retrieval-answer-quality-baseline-01.ts) -- rerun separately, not
 * duplicated in this file, so there is exactly one source of truth for that battery's logic.
 *
 * Determinism note: temperature=0 reduces but does not guarantee bit-identical Gemini output
 * across separate calls (already observed directly in LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01,
 * where H21 answered differently on a later rerun). This script does not claim or require replay
 * determinism of the raw model text -- only that citations remain exact/retrieval-contained/
 * provenance-intact and unsupported claims are still dropped, which are structurally enforced
 * regardless of what text the model returns.
 *
 * Usage: npx tsx scripts/db/legal-answer-prompt-calibration-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import {
  composeLegalAnswer,
  createLegalAnswerComposition,
} from '../../server/modules/legal/answer/LegalAnswerComposition';
import { createLegalRetrievalComposition, type LegalFamily } from '../../server/modules/legal/retrieval/LegalRetrievalComposition';
import { ANSWER_PROMPT_VERSION } from '../../server/modules/legal/answer/GeminiAnswerModelProvider';

interface Scope {
  readonly logicalSourceId: string;
  readonly chapter?: string;
  readonly materializationId?: string;
}

type TargetMode = 'ANSWERED' | 'INSUFFICIENT_EVIDENCE' | 'QUERY_UNDERSPECIFIED' | 'NAMED_SOURCE_NOT_AVAILABLE';

interface CalQuery {
  readonly id: string;
  readonly query: string;
  readonly family: LegalFamily | undefined;
  readonly target: TargetMode;
  readonly note: string;
  readonly acceptable_scopes?: readonly Scope[];
}

const MB = 'regeringskansliet-sfs-1998-808';
const MPF = 'regeringskansliet-sfs-2013-251';
const AVF = 'regeringskansliet-sfs-2020-614';
const PBL = 'regeringskansliet-sfs-2010-900';
const MFH_2011 = 'regeringskansliet-sfs-2011-338';
const MFH_1998 = 'regeringskansliet-sfs-1998-899';

// ---- 1. CALIBRATION SET (used for prompt development) ----
const CALIBRATION_SET: CalQuery[] = [
  { id: 'CAL-H1', query: 'Vad reglerar miljöprövningsförordningen när det gäller jordbruk och djurhållning?', family: 'law', target: 'ANSWERED', note: 'known FALSE_REFUSAL (topic-summary synthesis) -- target: becomes ANSWERED', acceptable_scopes: [{ logicalSourceId: MPF, chapter: '2' }] },
  { id: 'CAL-H18', query: 'Hur förhåller sig avfallsförordningens 2 kap. till miljöbalkens bestämmelser i 2 kap.?', family: 'law', target: 'ANSWERED', note: 'known FALSE_REFUSAL (cross-statute relational synthesis) -- target: becomes ANSWERED', acceptable_scopes: [{ logicalSourceId: AVF, chapter: '2' }, { logicalSourceId: MB, chapter: '2' }] },
  { id: 'CAL-L7', query: 'Förordning om miljöfarlig verksamhet och hälsoskydd enligt 9 kap. miljöbalken', family: 'law', target: 'INSUFFICIENT_EVIDENCE', note: 'known GOOD_REFUSAL -- must remain refused' },
  { id: 'CAL-X1', query: 'Vad är bästa receptet på köttbullar?', family: undefined, target: 'INSUFFICIENT_EVIDENCE', note: 'known GOOD_REFUSAL (out-of-corpus) -- must remain refused' },
  { id: 'CAL-X2', query: 'Vilka skatteregler gäller för aktiebolag enligt inkomstskattelagen?', family: 'law', target: 'NAMED_SOURCE_NOT_AVAILABLE', note: 'known GOOD_REFUSAL (uncovered statute, "inkomstskattelagen") -- LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01 target: now NAMED_SOURCE_NOT_AVAILABLE specifically, not just generic refusal' },
  { id: 'CAL-X4', query: 'Mark- och miljööverdomstolens dom i mål M 99999-99', family: 'court', target: 'INSUFFICIENT_EVIDENCE', note: 'known GOOD_REFUSAL (fabricated case number) -- must remain refused' },
  { id: 'CAL-L1', query: 'Vad är miljöbalkens mål och tillämpningsområde?', family: 'law', target: 'ANSWERED', note: 'known direct factual answer -- must remain correct/unaffected', acceptable_scopes: [{ logicalSourceId: MB, chapter: '1' }] },
  { id: 'CAL-C6', query: 'Mark- och miljööverdomstolens dom i mål M 307-24', family: 'court', target: 'ANSWERED', note: 'known direct court citation lookup -- must remain correct/unaffected' },
  { id: 'CAL-S1', query: 'Föreskrifter för små avloppsanordningar för hushållsspillvatten', family: 'standard', target: 'ANSWERED', note: 'known direct standard answer -- must remain correct/unaffected' },
  { id: 'CAL-X5', query: 'Vad gäller?', family: undefined, target: 'QUERY_UNDERSPECIFIED', note: 'gate case -- must remain gated before any model call, unaffected by prompt' },
];

// ---- 2. NEW HOLDOUT SET (final generalization proof -- never used in any prior battery) ----
const NEW_HOLDOUT_SET: CalQuery[] = [
  { id: 'NH1', query: 'Vilka bestämmelser gäller för vattenverksamhet enligt 11 kap. miljöbalken?', family: 'law', target: 'ANSWERED', note: 'direct, new chapter (MB ch.11)', acceptable_scopes: [{ logicalSourceId: MB, chapter: '11' }] },
  { id: 'NH2', query: 'Vad gäller för omprövning av tillstånd enligt 24 kap. miljöbalken?', family: 'law', target: 'ANSWERED', note: 'direct, new chapter (MB ch.24)', acceptable_scopes: [{ logicalSourceId: MB, chapter: '24' }] },
  { id: 'NH3', query: 'Vad föreskrivs i 5 kap. avfallsförordningen?', family: 'law', target: 'ANSWERED', note: 'direct, new chapter (AVF ch.5)', acceptable_scopes: [{ logicalSourceId: AVF, chapter: '5' }] },
  { id: 'NH4', query: 'Vilka tekniska egenskapskrav ställs på byggnadsverk enligt 8 kap. plan- och bygglagen?', family: 'law', target: 'ANSWERED', note: 'direct, new chapter (PBL ch.8)', acceptable_scopes: [{ logicalSourceId: PBL, chapter: '8' }] },
  { id: 'NH5', query: 'Vad regleras i 10 kap. förordningen (2011:338) om miljöfarlig verksamhet och hälsoskydd?', family: 'law', target: 'ANSWERED', note: 'direct, new chapter (MFH_2011 ch.10)', acceptable_scopes: [{ logicalSourceId: MFH_2011, chapter: '10' }] },
  { id: 'NH6', query: 'Hur förhåller sig tillsynsbestämmelserna i 26 kap. miljöbalken till tillsynen av miljöfarlig verksamhet enligt förordningen om miljöfarlig verksamhet och hälsoskydd?', family: 'law', target: 'ANSWERED', note: 'NEW cross-statute relational synthesis case -- generalization test beyond CAL-H1/CAL-H18', acceptable_scopes: [{ logicalSourceId: MB, chapter: '26' }, { logicalSourceId: MFH_1998, chapter: '9' }] },
  { id: 'NH7', query: 'Hur samspelar bygglovsprövning enligt 9 kap. plan- och bygglagen med de allmänna hänsynsreglerna i 2 kap. miljöbalken?', family: 'law', target: 'ANSWERED', note: 'NEW cross-statute relational synthesis case -- generalization test beyond CAL-H1/CAL-H18', acceptable_scopes: [{ logicalSourceId: PBL, chapter: '9' }, { logicalSourceId: MB, chapter: '2' }] },
  { id: 'NH8', query: 'Vad krävs för anmälan enligt kapitel 2?', family: 'law', target: 'INSUFFICIENT_EVIDENCE', note: 'ambiguous_by_design (5 sources share ch.2) -- informational, not a hard pass/fail', acceptable_scopes: [{ logicalSourceId: MB, chapter: '2' }, { logicalSourceId: MPF, chapter: '2' }, { logicalSourceId: AVF, chapter: '2' }, { logicalSourceId: MFH_2011, chapter: '2' }, { logicalSourceId: MFH_1998, chapter: '2' }] },
  { id: 'NH9', query: 'Vilka regler gäller för avloppsanordningars anmälningsplikt?', family: 'law', target: 'ANSWERED', note: 'implicit_source, new chapter (MFH_1998 ch.13)', acceptable_scopes: [{ logicalSourceId: MFH_1998, chapter: '13' }] },
  { id: 'NH10', query: 'Vilka regler gäller för fiske och fiskevård enligt fiskelagen?', family: 'law', target: 'NAMED_SOURCE_NOT_AVAILABLE', note: 'THE key finding this unit exists to fix: genuinely uncovered statute (fiskelagen) -- target: NAMED_SOURCE_NOT_AVAILABLE, not a silent answer from an adjacent real statute' },
];

async function resolveScopeFragmentIds(scopes: readonly Scope[]): Promise<Set<string>> {
  const all = new Set<string>();
  for (const scope of scopes) {
    if (scope.materializationId) {
      const chunks = await prisma.legalCorpusMaterializedChunk.findMany({ where: { materializationId: scope.materializationId }, select: { fragmentId: true } });
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

async function runSet(label: string, queries: readonly CalQuery[], deps: ReturnType<typeof createLegalAnswerComposition>) {
  console.log(`\n\n########## ${label} (${queries.length} queries) ##########`);
  const rows: Record<string, unknown>[] = [];

  for (const cq of queries) {
    console.log(`\n=== [${cq.id}] ${cq.note} ===`);
    console.log('query:', cq.query, '| family:', cq.family ?? '(none)', '| target:', cq.target);

    const outcome = await composeLegalAnswer({ query: cq.query, family: cq.family, topK: 6 }, deps);
    const acceptableIds = cq.acceptable_scopes ? await resolveScopeFragmentIds(cq.acceptable_scopes) : null;
    const retrievedIds = new Set((outcome.retrieval?.results ?? []).map((r) => r.fragment_id));
    const containment = acceptableIds === null ? null : [...acceptableIds].some((id) => retrievedIds.has(id));

    let provenanceIntact = true;
    let citationsWithinRetrievalSet = true;
    for (const claim of outcome.claims) {
      for (const citation of claim.citations) {
        if (citation.source_provenance_refs.length === 0) provenanceIntact = false;
        if (!retrievedIds.has(citation.fragment_id)) citationsWithinRetrievalSet = false;
      }
    }

    const hardPassFail = cq.id === 'NH8' ? 'informational' : outcome.mode === cq.target ? 'PASS' : 'MISS';

    console.log('mode:', outcome.mode, '| matches target:', hardPassFail);
    console.log('containment:', containment, '| claims:', outcome.claims.length, '| provenance intact:', provenanceIntact, '| citations within set:', citationsWithinRetrievalSet);

    for (const [i, claim] of outcome.claims.entries()) {
      console.log(`  claim ${i + 1}: "${claim.text}"`);
      for (const citation of claim.citations) {
        const row = await prisma.legalCorpusMaterializedChunk.findUnique({
          where: { materializationId_fragmentId: { materializationId: citation.materialization_id, fragmentId: citation.fragment_id } },
        });
        const preview = (row?.chunkText ?? '(UNRESOLVED)').replace(/\s+/g, ' ').slice(0, 220);
        console.log(`    <- fragment_id=${citation.fragment_id.slice(0, 20)}... | passage: "${preview}"`);
      }
    }

    rows.push({
      id: cq.id,
      target: cq.target,
      mode: outcome.mode,
      result: hardPassFail,
      claims: outcome.claims.length,
      containment,
      provenance_intact: provenanceIntact,
      citations_within_set: citationsWithinRetrievalSet,
    });
  }

  console.log(`\n========== ${label} SUMMARY ==========`);
  console.table(rows);
  const hardCases = rows.filter((r) => r.result !== 'informational');
  const passCount = hardCases.filter((r) => r.result === 'PASS').length;
  console.log(`${passCount}/${hardCases.length} hard-target cases matched (informational cases excluded)`);
  const allProvenanceIntact = rows.every((r) => r.provenance_intact === true);
  const allCitationsWithinSet = rows.every((r) => r.citations_within_set === true);
  console.log('All provenance intact:', allProvenanceIntact, '| all citations within retrieval set:', allCitationsWithinSet);

  return { rows, passCount, hardCount: hardCases.length, allProvenanceIntact, allCitationsWithinSet };
}

async function main() {
  console.log('########## LEGAL-ANSWER-PROMPT-CALIBRATION-01 ##########');
  console.log('answer_prompt_version:', ANSWER_PROMPT_VERSION);

  const retrievalDeps = createLegalRetrievalComposition();
  const deps = createLegalAnswerComposition(retrievalDeps);

  const calibration = await runSet('CALIBRATION SET', CALIBRATION_SET, deps);
  const holdout = await runSet('NEW HOLDOUT SET', NEW_HOLDOUT_SET, deps);

  console.log('\n\n========== OVERALL ==========');
  console.log('Calibration set:', `${calibration.passCount}/${calibration.hardCount}`, '| provenance/citation integrity:', calibration.allProvenanceIntact, calibration.allCitationsWithinSet);
  console.log('New holdout set:', `${holdout.passCount}/${holdout.hardCount}`, '| provenance/citation integrity:', holdout.allProvenanceIntact, holdout.allCitationsWithinSet);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
