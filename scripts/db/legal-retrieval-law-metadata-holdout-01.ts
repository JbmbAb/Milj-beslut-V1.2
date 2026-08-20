/**
 * LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01.
 *
 * An INDEPENDENT holdout battery for `law` retrieval -- 27 new queries, none derived from or
 * overlapping LEGAL-RETRIEVAL-QUALITY-BASELINE-01's 8 law queries (different chapters, different
 * topics, different phrasing), built specifically to test whether
 * LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01's result generalizes or was an artifact of the 24-query
 * set it was measured against.
 *
 * The expected-answer sets below are FROZEN before this script is ever run against real search
 * results -- no query, expected scope, or classification was adjusted after seeing router output.
 * Every acceptable scope was verified against real chunk content in the corpus during authoring
 * (see the commit message / PROVEN doc for the recon that grounded each one), not guessed.
 *
 * Two modes compared, per query:
 *   A: frozen vector-only search (byte-identical to the baseline's unconstrained path)
 *   B: metadata-routed search (LawSourceRouter, unchanged from LEGAL-RETRIEVAL-LAW-METADATA-
 *      ROUTING-01 -- this holdout run does NOT modify the router)
 *
 * Usage: npx tsx scripts/db/legal-retrieval-law-metadata-holdout-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import { evaluateLegalRetrieval } from '@miljobeslut/mps-retrieval-governance';
import { createGeminiEmbeddingProvider } from '../../server/modules/legal/retrieval/GeminiEmbeddingProvider';
import { describeRoutingDecision, routeLawQuery, type RoutingDecision } from '../../server/modules/legal/retrieval/LawSourceRouter';
import { buildCandidateWhereClause } from '../../server/modules/legal/retrieval/LawSourceRoutingSql';

type Subcategory = 'explicit_source' | 'explicit_source_chapter' | 'implicit_source' | 'multi_statute' | 'ambiguous_by_design';

interface AcceptableScope {
  readonly logicalSourceId: string;
  readonly chapter: string;
}

interface HoldoutQuery {
  readonly query_id: string;
  readonly query: string;
  readonly subcategory: Subcategory;
  readonly unambiguous: boolean;
  /** Union of acceptable (source, chapter) scopes -- more than one entry means the query
   *  legitimately has more than one correct answer (multi-statute / ambiguous queries). */
  readonly acceptable_scopes: readonly AcceptableScope[];
}

const MB = 'regeringskansliet-sfs-1998-808';
const MPF = 'regeringskansliet-sfs-2013-251';
const AVF = 'regeringskansliet-sfs-2020-614';
const PBL = 'regeringskansliet-sfs-2010-900';
const MFH_2011 = 'regeringskansliet-sfs-2011-338';
const MFH_1998 = 'regeringskansliet-sfs-1998-899';

const QUERIES: HoldoutQuery[] = [
  // ---- explicit_source: statute named, no chapter (5) ----
  { query_id: 'H1', query: 'Vad reglerar miljöprövningsförordningen när det gäller jordbruk och djurhållning?', subcategory: 'explicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MPF, chapter: '2' }] },
  { query_id: 'H2', query: 'Hur definieras avfall och när upphör något att vara avfall enligt avfallsförordningen?', subcategory: 'explicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: AVF, chapter: '1' }] },
  { query_id: 'H3', query: 'Vilka bestämmelser om allmän plats finns i plan- och bygglagen?', subcategory: 'explicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: PBL, chapter: '4' }] },
  { query_id: 'H4', query: 'Vad säger förordningen om miljöfarlig verksamhet och hälsoskydd (miljötillsyn) om motordrivna anordningar som hissar?', subcategory: 'explicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MFH_2011, chapter: '2' }] },
  { query_id: 'H5', query: 'Enligt miljöbalken, vilka bestämmelser gäller för naturgasledningar och rörledningar?', subcategory: 'explicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MB, chapter: '2' }] },

  // ---- explicit_source_chapter: statute AND chapter named (6) ----
  { query_id: 'H6', query: 'Vad regleras i 3 kap. plan- och bygglagen om planläggning som också prövas enligt annan lag?', subcategory: 'explicit_source_chapter', unambiguous: true, acceptable_scopes: [{ logicalSourceId: PBL, chapter: '3' }] },
  { query_id: 'H7', query: 'Vad säger 2 kap. miljöprövningsförordningen om jordbruk?', subcategory: 'explicit_source_chapter', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MPF, chapter: '2' }] },
  { query_id: 'H8', query: 'Enligt 4 kap. miljöprövningsförordningen, vad gäller för utvinning och brytning av torv och malm?', subcategory: 'explicit_source_chapter', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MPF, chapter: '4' }] },
  { query_id: 'H9', query: 'Vad föreskrivs i 3 kap. avfallsförordningen?', subcategory: 'explicit_source_chapter', unambiguous: true, acceptable_scopes: [{ logicalSourceId: AVF, chapter: '3' }] },
  { query_id: 'H10', query: 'Vad regleras i 3 kap. förordningen (1998:899) om miljöfarlig verksamhet och hälsoskydd?', subcategory: 'explicit_source_chapter', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MFH_1998, chapter: '3' }] },
  { query_id: 'H11', query: 'Enligt 4 kap. förordningen (2011:338) om miljöfarlig verksamhet och hälsoskydd, vad gäller vid tillämpningen av bestämmelserna?', subcategory: 'explicit_source_chapter', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MFH_2011, chapter: '4' }] },

  // ---- implicit_source: topic only, no statute named (6) ----
  { query_id: 'H12', query: 'Vilka regler gäller för byggande och underhåll av byggnadsverk?', subcategory: 'implicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: PBL, chapter: '1' }] },
  { query_id: 'H13', query: 'Vad krävs för tillståndsplikt vid utvinning av torv, olja och malm?', subcategory: 'implicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MPF, chapter: '4' }] },
  { query_id: 'H14', query: 'Vilka krav ställs på anmälan för uppodling av mark för produktion av foder och livsmedel?', subcategory: 'implicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MPF, chapter: '3' }] },
  { query_id: 'H15', query: 'Hur definieras allmän plats i byggnadslagstiftningen?', subcategory: 'implicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: PBL, chapter: '4' }] },
  { query_id: 'H16', query: 'Vilka bestämmelser gäller för hissar och andra motordrivna anordningar ur hälsoskyddssynpunkt?', subcategory: 'implicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MFH_2011, chapter: '2' }] },
  { query_id: 'H17', query: 'Vilka myndigheter ska en dom eller ett beslut om miljöfarlig verksamhet skickas till?', subcategory: 'implicit_source', unambiguous: true, acceptable_scopes: [{ logicalSourceId: MFH_1998, chapter: '2' }] },

  // ---- multi_statute: two related statutes both explicitly named (5) ----
  { query_id: 'H18', query: 'Hur förhåller sig avfallsförordningens 2 kap. till miljöbalkens bestämmelser i 2 kap.?', subcategory: 'multi_statute', unambiguous: false, acceptable_scopes: [{ logicalSourceId: AVF, chapter: '2' }, { logicalSourceId: MB, chapter: '2' }] },
  { query_id: 'H19', query: 'Vilket samband finns mellan plan- och bygglagens 3 kap. och miljöbalken vid prövning av markanvändning?', subcategory: 'multi_statute', unambiguous: false, acceptable_scopes: [{ logicalSourceId: PBL, chapter: '3' }, { logicalSourceId: MB, chapter: '2' }] },
  { query_id: 'H20', query: 'Hur kompletterar förordningen om miljöfarlig verksamhet och hälsoskydd (miljötillsyn) plan- och bygglagen när det gäller handlingar till länsstyrelsen?', subcategory: 'multi_statute', unambiguous: false, acceptable_scopes: [{ logicalSourceId: MFH_2011, chapter: '3' }, { logicalSourceId: PBL, chapter: '3' }] },
  { query_id: 'H21', query: 'Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av djurhållning?', subcategory: 'multi_statute', unambiguous: false, acceptable_scopes: [{ logicalSourceId: MPF, chapter: '2' }, { logicalSourceId: MB, chapter: '1' }] },
  { query_id: 'H22', query: 'Hur förhåller sig 4 kap. förordningen om miljöfarlig verksamhet och hälsoskydd till bestämmelserna i miljöbalken?', subcategory: 'multi_statute', unambiguous: false, acceptable_scopes: [{ logicalSourceId: MFH_1998, chapter: '4' }, { logicalSourceId: MFH_2011, chapter: '4' }, { logicalSourceId: MB, chapter: '4' }] },

  // ---- ambiguous_by_design: no statute reliably identifiable at all (5) ----
  { query_id: 'H23', query: 'Vad säger förordningen om miljöfarlig verksamhet och hälsoskydd om anmälan?', subcategory: 'ambiguous_by_design', unambiguous: false, acceptable_scopes: [{ logicalSourceId: MFH_1998, chapter: '1' }, { logicalSourceId: MFH_2011, chapter: '1' }] },
  { query_id: 'H24', query: 'Vad krävs för anmälan enligt kapitel 1?', subcategory: 'ambiguous_by_design', unambiguous: false, acceptable_scopes: [{ logicalSourceId: MB, chapter: '1' }, { logicalSourceId: MPF, chapter: '1' }, { logicalSourceId: AVF, chapter: '1' }, { logicalSourceId: PBL, chapter: '1' }, { logicalSourceId: MFH_2011, chapter: '1' }, { logicalSourceId: MFH_1998, chapter: '1' }] },
  { query_id: 'H25', query: 'Vilka bestämmelser gäller enligt kapitel 3?', subcategory: 'ambiguous_by_design', unambiguous: false, acceptable_scopes: [{ logicalSourceId: MB, chapter: '3' }, { logicalSourceId: MPF, chapter: '3' }, { logicalSourceId: AVF, chapter: '3' }, { logicalSourceId: PBL, chapter: '3' }, { logicalSourceId: MFH_2011, chapter: '3' }, { logicalSourceId: MFH_1998, chapter: '3' }] },
  { query_id: 'H26', query: 'Vad regleras i miljölagstiftningen om byggande och miljöfarlig verksamhet?', subcategory: 'ambiguous_by_design', unambiguous: false, acceptable_scopes: [{ logicalSourceId: MB, chapter: '1' }, { logicalSourceId: PBL, chapter: '1' }, { logicalSourceId: MFH_1998, chapter: '1' }, { logicalSourceId: MFH_2011, chapter: '1' }] },
  { query_id: 'H27', query: 'Vad säger bestämmelserna om hälsoskydd?', subcategory: 'ambiguous_by_design', unambiguous: false, acceptable_scopes: [{ logicalSourceId: MFH_1998, chapter: '2' }, { logicalSourceId: MFH_2011, chapter: '2' }, { logicalSourceId: MB, chapter: '9' }] },
];

interface HitRow {
  fragment_id: string;
  materialization_id: string;
  chapter: string | null;
  logical_source_id: string;
  distance: number;
}

async function resolveAcceptableFragmentIds(scopes: readonly AcceptableScope[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const scope of scopes) {
    const mats = await prisma.legalCorpusMaterialization.findMany({ where: { logicalSourceId: scope.logicalSourceId } });
    const chunks = await prisma.legalCorpusMaterializedChunk.findMany({
      where: { materializationId: { in: mats.map((m) => m.id) }, chapter: scope.chapter },
      select: { fragmentId: true },
    });
    for (const c of chunks) ids.add(c.fragmentId);
  }
  return ids;
}

async function search(
  queryVector: readonly number[],
  modelId: string,
  pipelineVersion: string,
  decision: RoutingDecision | null,
  topK = 10,
): Promise<HitRow[]> {
  const vectorLiteral = `[${queryVector.join(',')}]`;
  const baseParams: unknown[] = [vectorLiteral, modelId, pipelineVersion];
  const where = decision ? buildCandidateWhereClause(decision, baseParams.length) : { sql: '', params: [] };
  const params = [...baseParams, ...where.params, topK];
  const topKParam = `$${params.length}`;
  return prisma.$queryRawUnsafe<HitRow[]>(
    `SELECT e.fragment_id, e.materialization_id, c.chapter, m.logical_source_id,
            (e.embedding_vector <=> $1::vector) AS distance
     FROM "legal_corpus_chunk_embeddings" e
     JOIN "legal_corpus_materialized_chunks" c ON c.materialization_id = e.materialization_id AND c.fragment_id = e.fragment_id
     JOIN "legal_corpus_materializations" m ON m.id = c.materialization_id
     WHERE e.embedding_model_id = $2 AND e.embedding_pipeline_version = $3
       ${where.sql}
     ORDER BY e.embedding_vector <=> $1::vector
     LIMIT ${topKParam}`,
    ...params,
  );
}

function firstCorrectRank(hits: HitRow[], acceptable: Set<string>): number | null {
  for (let i = 0; i < hits.length; i++) if (acceptable.has(hits[i]!.fragment_id)) return i + 1;
  return null;
}

async function main() {
  console.log('########## LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01 ##########\n');
  const provider = createGeminiEmbeddingProvider();
  evaluateLegalRetrieval('LEGAL_CORPUS_SEARCH'); // policy check, same as every other unit

  const rows: Record<string, unknown>[] = [];

  for (const q of QUERIES) {
    const acceptable = await resolveAcceptableFragmentIds(q.acceptable_scopes);
    const routing = routeLawQuery(q.query);
    const routingLabel = describeRoutingDecision(routing);

    const [queryVector] = await provider.embedBatch([q.query]);

    const hitsA = await search(queryVector!, provider.model_id, provider.pipeline_version, null, 10);
    const rankA = firstCorrectRank(hitsA, acceptable);

    const hitsB = await search(queryVector!, provider.model_id, provider.pipeline_version, routing, 10);
    const rankB = firstCorrectRank(hitsB, acceptable);

    const metrics = (rank: number | null) => ({
      top1: rank === 1, top3: rank !== null && rank <= 3, top5: rank !== null && rank <= 5,
      rr: rank ? 1 / rank : 0,
    });
    const mA = metrics(rankA);
    const mB = metrics(rankB);

    console.log(`\n[${q.query_id}/${q.subcategory}] "${q.query}"`);
    console.log(`  routing: ${routingLabel} | acceptable fragments: ${acceptable.size} across ${q.acceptable_scopes.length} scope(s)`);
    console.log(`  A (vector-only): rank=${rankA ?? 'n/a'} RR=${mA.rr.toFixed(3)} | B (routed): rank=${rankB ?? 'n/a'} RR=${mB.rr.toFixed(3)}`);

    rows.push({
      query_id: q.query_id, query: q.query, subcategory: q.subcategory, unambiguous: q.unambiguous,
      routing_decision: routingLabel,
      A: { rank: rankA, ...mA }, B: { rank: rankB, ...mB },
    });
  }

  console.log('\n\n========== HOLDOUT RAW RESULTS ==========');
  console.log(JSON.stringify(rows, null, 2));

  function agg(label: string, subset: typeof rows) {
    const n = subset.length;
    const a = { top1: subset.filter((r: any) => r.A.top1).length, top3: subset.filter((r: any) => r.A.top3).length, top5: subset.filter((r: any) => r.A.top5).length, mrr: Number((subset.reduce((s: number, r: any) => s + r.A.rr, 0) / n).toFixed(3)) };
    const b = { top1: subset.filter((r: any) => r.B.top1).length, top3: subset.filter((r: any) => r.B.top3).length, top5: subset.filter((r: any) => r.B.top5).length, mrr: Number((subset.reduce((s: number, r: any) => s + r.B.rr, 0) / n).toFixed(3)) };
    console.log(`${label} (n=${n}): A top1=${a.top1}/${n} top3=${a.top3}/${n} top5=${a.top5}/${n} MRR=${a.mrr}  |  B top1=${b.top1}/${n} top3=${b.top3}/${n} top5=${b.top5}/${n} MRR=${b.mrr}`);
  }

  console.log('\n--- Aggregate: A (vector-only) vs B (routed) ---');
  agg('overall', rows);
  agg('unambiguous', rows.filter((r) => r.unambiguous));
  agg('ambiguous_by_design/multi_statute', rows.filter((r) => !r.unambiguous));
  for (const sub of ['explicit_source', 'explicit_source_chapter', 'implicit_source', 'multi_statute', 'ambiguous_by_design']) {
    agg(sub, rows.filter((r) => r.subcategory === sub));
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
