/**
 * LEGAL-RETRIEVAL-QUALITY-BASELINE-01.
 *
 * A larger, hand-curated golden-query baseline measuring RETRIEVAL QUALITY only -- deliberately
 * separate from identity/provenance/coverage, which are already PROVEN
 * (LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01, LEGAL-RETRIEVAL-BOUNDED-PILOT-01,
 * LEGAL-RETRIEVAL-BULK-EMBEDDING-01). No tuning, hybrid search, reranking, or query rewriting
 * happens here -- this freezes what vector-only retrieval actually does today, as evidence for a
 * later, separate, data-driven decision.
 *
 * A wrong top-1 result with intact provenance is a RETRIEVAL QUALITY finding, not a governance
 * finding -- both are measured and reported, never conflated into one verdict.
 *
 * W-NO-GOOGLE-02A: the RUN of this baseline (its vector search against the historical
 * 3072-dimensional embedding rows, embedded by the retired Google provider) is retired together
 * with that provider. What remains is the frozen asset other scripts import: the 24 golden
 * queries (QUERIES), the acceptable-fragment resolution, the failure classification and the
 * provenance check. A new run over local 1024-dimensional embeddings is a separate, later unit.
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import { bindEmbeddingIdentity } from '@miljobeslut/mps-embedding-identity';
import {
  buildRetrievalResult,
  createInMemoryGovernedChunkLookup,
} from '@miljobeslut/mps-legal-retrieval-contract';

export type Category = 'law' | 'court' | 'court_citation' | 'standard';
export type FailureMode =
  | 'SEMANTIC_MISS'
  | 'LEXICAL_IDENTIFIER_MISS'
  | 'SOURCE_FAMILY_MISS'
  | 'CHAPTER_SCOPE_MISS'
  | 'DUPLICATE_NEAR_DUPLICATE_RANKING'
  | 'QUERY_TOO_AMBIGUOUS'
  | 'NONE';

export interface QuerySpec {
  readonly query_id: string;
  readonly query: string;
  readonly category: Category;
  readonly expected_family: 'law' | 'court' | 'standard';
  readonly expected_logical_source_id: string;
  /** Acceptable-fragment scope: 'materialization' = any chunk from that one materialization;
   *  'chapter' = any chunk from that source's given chapter (law only, needs `chapter`). */
  readonly scope: { type: 'materialization'; materializationId: string } | { type: 'chapter'; logicalSourceId: string; chapter: string };
  readonly is_citation_lookup: boolean;
  readonly ambiguous_by_design: boolean;
}

// LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01: exported unchanged so the routing comparison run
// reuses the EXACT same 24 queries and scoring logic below -- never a hand-tuned rerun, and
// never a second, drifted copy of the query set.
export const QUERIES: QuerySpec[] = [
  // ---- LAW (8) ----
  { query_id: 'L1', query: 'Vad är miljöbalkens mål och tillämpningsområde?', category: 'law', expected_family: 'law', expected_logical_source_id: 'regeringskansliet-sfs-1998-808', scope: { type: 'chapter', logicalSourceId: 'regeringskansliet-sfs-1998-808', chapter: '1' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'L2', query: 'Bestämmelser om geologisk lagring av koldioxid enligt miljöbalken', category: 'law', expected_family: 'law', expected_logical_source_id: 'regeringskansliet-sfs-1998-808', scope: { type: 'chapter', logicalSourceId: 'regeringskansliet-sfs-1998-808', chapter: '15' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'L3', query: 'Vilka verksamheter kräver tillstånd enligt 9 kap. miljöbalken?', category: 'law', expected_family: 'law', expected_logical_source_id: 'regeringskansliet-sfs-2013-251', scope: { type: 'chapter', logicalSourceId: 'regeringskansliet-sfs-2013-251', chapter: '9' }, is_citation_lookup: false, ambiguous_by_design: true },
  { query_id: 'L4', query: 'Bestämmelser om avfall och avfallshantering', category: 'law', expected_family: 'law', expected_logical_source_id: 'regeringskansliet-sfs-2020-614', scope: { type: 'chapter', logicalSourceId: 'regeringskansliet-sfs-2020-614', chapter: '15' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'L5', query: 'Kommunens ansvar för planläggning av mark och vatten', category: 'law', expected_family: 'law', expected_logical_source_id: 'regeringskansliet-sfs-2010-900', scope: { type: 'chapter', logicalSourceId: 'regeringskansliet-sfs-2010-900', chapter: '1' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'L6', query: 'Vad innehåller plan- och bygglagen för bestämmelser, kapitel för kapitel?', category: 'law', expected_family: 'law', expected_logical_source_id: 'regeringskansliet-sfs-2010-900', scope: { type: 'chapter', logicalSourceId: 'regeringskansliet-sfs-2010-900', chapter: '16' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'L7', query: 'Förordning om miljöfarlig verksamhet och hälsoskydd enligt 9 kap. miljöbalken', category: 'law', expected_family: 'law', expected_logical_source_id: 'regeringskansliet-sfs-1998-899', scope: { type: 'chapter', logicalSourceId: 'regeringskansliet-sfs-1998-899', chapter: '9' }, is_citation_lookup: false, ambiguous_by_design: true },
  { query_id: 'L8', query: 'Den kommunala nämndens uppgifter inom miljö- och hälsoskyddsområdet', category: 'law', expected_family: 'law', expected_logical_source_id: 'regeringskansliet-sfs-1998-899', scope: { type: 'chapter', logicalSourceId: 'regeringskansliet-sfs-1998-899', chapter: '26' }, is_citation_lookup: false, ambiguous_by_design: false },

  // ---- COURT, topic-based (5) ----
  { query_id: 'C1', query: 'Tillåtlighet för deponi nära Stockholm, prövning av lämplig placering', category: 'court', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14xwth0001cwf7o2ep4qmp' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'C2', query: 'Bygglov beviljat av byggnadsnämnden i Lund, ändring av tidigare beslut', category: 'court', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14xxie00ftcwf79rzvh4hg' }, is_citation_lookup: false, ambiguous_by_design: true },
  { query_id: 'C3', query: 'Ansökan om tillstånd avvisad och återförvisad till miljöprövningsdelegationen i Norrbottens län', category: 'court', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14xy3800mlcwf7egfwql5b' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'C4', query: 'Vite för olovlig åtgärd, förpliktad att betala till staten', category: 'court', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14xyl100pncwf7cx959tom' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'C5', query: 'Strandskyddsdispens för trappsteg ner till strandkanten i Lund', category: 'court', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14y0hb01blcwf7qkxzi8ch' }, is_citation_lookup: false, ambiguous_by_design: false },

  // ---- COURT, case-number/citation lookup (5) ----
  { query_id: 'C6', query: 'Mark- och miljööverdomstolens dom i mål M 307-24', category: 'court_citation', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14xwth0001cwf7o2ep4qmp' }, is_citation_lookup: true, ambiguous_by_design: false },
  { query_id: 'C7', query: 'Mark- och miljööverdomstolens dom i mål P 13258-25', category: 'court_citation', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14xxie00ftcwf79rzvh4hg' }, is_citation_lookup: true, ambiguous_by_design: false },
  { query_id: 'C8', query: 'SVEA HOVRÄTT dom P 9718-25', category: 'court_citation', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14xyuz00rhcwf7p6f47e2j' }, is_citation_lookup: true, ambiguous_by_design: false },
  { query_id: 'C9', query: 'dom i mål M 15632-25', category: 'court_citation', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14xy3800mlcwf7egfwql5b' }, is_citation_lookup: true, ambiguous_by_design: false },
  { query_id: 'C10', query: 'dom i mål M 13737-25 strandskydd', category: 'court_citation', expected_family: 'court', expected_logical_source_id: 'domstolsverket-puh-mmod', scope: { type: 'materialization', materializationId: 'cmt14y0hb01blcwf7qkxzi8ch' }, is_citation_lookup: true, ambiguous_by_design: false },

  // ---- STANDARD (6) ----
  { query_id: 'S1', query: 'Föreskrifter för små avloppsanordningar för hushållsspillvatten', category: 'standard', expected_family: 'standard', expected_logical_source_id: 'hav-hvmfs-2016-17', scope: { type: 'materialization', materializationId: '' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'S2', query: 'Analytiska modeller för att beräkna influensområde för grundvatten', category: 'standard', expected_family: 'standard', expected_logical_source_id: 'sgu-groundwater-influence-analytical-models', scope: { type: 'materialization', materializationId: '' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'S3', query: 'Hur borrar man en brunn på rätt sätt?', category: 'standard', expected_family: 'standard', expected_logical_source_id: 'sgu-well-drilling-guidance', scope: { type: 'materialization', materializationId: '' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'S4', query: 'Vägledning för brunnsborrning och vattenbrunnar i Sverige, Normbrunn -16', category: 'standard', expected_family: 'standard', expected_logical_source_id: 'sgu-well-drilling-guidance', scope: { type: 'materialization', materializationId: '' }, is_citation_lookup: false, ambiguous_by_design: false },
  { query_id: 'S5', query: 'Bemyndigande enligt miljötillsynsförordningen för små avlopp', category: 'standard', expected_family: 'standard', expected_logical_source_id: 'hav-hvmfs-2016-17', scope: { type: 'materialization', materializationId: '' }, is_citation_lookup: false, ambiguous_by_design: true },
  { query_id: 'S6', query: 'Endimensionellt grundvattenflöde till anläggning i magasin med slutna magasinsförhållanden', category: 'standard', expected_family: 'standard', expected_logical_source_id: 'sgu-groundwater-influence-analytical-models', scope: { type: 'materialization', materializationId: '' }, is_citation_lookup: false, ambiguous_by_design: false },
];

export interface HitRow {
  fragment_id: string;
  materialization_id: string;
  chapter: string | null;
  court_section: string | null;
  structure_kind: string;
  logical_source_id: string;
  title: string;
  distance: number;
}

async function resolveScopeMaterializationId(spec: QuerySpec): Promise<string | null> {
  if (spec.scope.type === 'materialization') {
    if (spec.scope.materializationId) return spec.scope.materializationId;
    const mat = await prisma.legalCorpusMaterialization.findFirst({ where: { logicalSourceId: spec.expected_logical_source_id } });
    return mat?.id ?? null;
  }
  return null;
}

export async function resolveAcceptableFragmentIds(spec: QuerySpec): Promise<Set<string>> {
  if (spec.scope.type === 'materialization') {
    const materializationId = await resolveScopeMaterializationId(spec);
    if (!materializationId) return new Set();
    const chunks = await prisma.legalCorpusMaterializedChunk.findMany({ where: { materializationId }, select: { fragmentId: true } });
    return new Set(chunks.map((c) => c.fragmentId));
  }
  const mats = await prisma.legalCorpusMaterialization.findMany({ where: { logicalSourceId: spec.scope.logicalSourceId } });
  const chunks = await prisma.legalCorpusMaterializedChunk.findMany({
    where: { materializationId: { in: mats.map((m) => m.id) }, chapter: spec.scope.chapter },
    select: { fragmentId: true },
  });
  return new Set(chunks.map((c) => c.fragmentId));
}

export function classifyFailure(spec: QuerySpec, hits: HitRow[], acceptable: Set<string>, firstCorrectRank: number | null): FailureMode {
  if (firstCorrectRank === 1) return 'NONE';
  if (hits.length === 0) return 'SEMANTIC_MISS';
  const top1 = hits[0]!;

  if (firstCorrectRank === null) {
    // No correct hit anywhere in top-10.
    if (top1.structure_kind !== spec.expected_family) return 'SOURCE_FAMILY_MISS';
    if (top1.logical_source_id === spec.expected_logical_source_id && spec.scope.type === 'chapter' && top1.chapter !== spec.scope.chapter) {
      return 'CHAPTER_SCOPE_MISS';
    }
    if (spec.is_citation_lookup) return 'LEXICAL_IDENTIFIER_MISS';
    // If the top-3 hits span 3+ distinct materializations from DIFFERENT logical sources, the
    // query plausibly matched too broadly for the embedding model to disambiguate.
    const distinctSources = new Set(hits.slice(0, 3).map((h) => h.logical_source_id));
    if (distinctSources.size >= 3) return 'QUERY_TOO_AMBIGUOUS';
    return 'SEMANTIC_MISS';
  }

  // Correct hit exists, but not at rank 1 -- was the wrong top-1 a near-duplicate from the SAME
  // source (ranking confusion within the right document) or a genuinely different source?
  if (top1.logical_source_id === spec.expected_logical_source_id) return 'DUPLICATE_NEAR_DUPLICATE_RANKING';
  if (spec.is_citation_lookup) return 'LEXICAL_IDENTIFIER_MISS';
  return 'SEMANTIC_MISS';
}

export async function provenanceIntact(hit: HitRow, provider: { model_id: string; model_version: string; pipeline_version: string }, policyVersion: string): Promise<boolean> {
  try {
    const chunkRow = await prisma.legalCorpusMaterializedChunk.findUnique({
      where: { materializationId_fragmentId: { materializationId: hit.materialization_id, fragmentId: hit.fragment_id } },
    });
    if (!chunkRow) return false;
    // NOT `fetchGovernedChunkRefs([hit.fragment_id])`: fragment_id is unique only per
    // (materializationId, fragmentId), not globally -- the known Part G duplicate MMÖD
    // materialization (see LEGAL-CORPUS-PUH-COURT-SCALE-01-PROVEN.md) shares a fragment_id with
    // its correctly-labeled counterpart, so a bare fragment_id lookup can return >1 row and the
    // in-memory Map keyed by fragment_id silently keeps only the last one -- causing a spurious
    // MATERIALIZATION_MISMATCH when the OTHER row is the one actually being checked. Building the
    // ref directly from the already compound-keyed chunkRow avoids the ambiguity entirely.
    const lookup = createInMemoryGovernedChunkLookup([
      { fragment_id: chunkRow.fragmentId, materialization_id: chunkRow.materializationId, content_hash: chunkRow.contentHash, structure_kind: chunkRow.structureKind as 'law' | 'court' | 'standard' },
    ]);
    const identity = bindEmbeddingIdentity({
      fragment_id: hit.fragment_id,
      materialization_id: hit.materialization_id,
      chunk_content_hash: chunkRow.contentHash,
      embedding_model_id: provider.model_id,
      embedding_model_version: provider.model_version,
      embedding_pipeline_version: provider.pipeline_version,
    });
    const result = buildRetrievalResult(
      {
        fragment_id: hit.fragment_id,
        materialization_id: hit.materialization_id,
        source_provenance_refs: [`materialization:${hit.materialization_id}`],
        embedding_identity: identity,
        retrieval_policy_version: policyVersion,
        query_run_identity: 'quality-baseline-01',
        score: 1 - hit.distance,
        rank: 1,
      },
      lookup,
    );
    return result.resolved_against_governed_chunk;
  } catch {
    return false;
  }
}
