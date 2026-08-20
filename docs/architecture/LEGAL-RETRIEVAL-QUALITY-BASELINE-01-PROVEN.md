# LEGAL-RETRIEVAL-QUALITY-BASELINE-01 — PROVEN (baseline frozen, not a quality verdict)

**Status:** PROVEN as a *measurement* — this freezes what vector-only retrieval (`gemini-
embedding-001`, no tuning) actually does today over the fully-embedded corpus
(`LEGAL-RETRIEVAL-BULK-EMBEDDING-01`, 31,706/31,706 chunks). No hybrid search, reranking, query
rewriting, or metadata filtering was applied — this is the untouched baseline, on purpose, so any
future improvement has something real to be measured against.

**A wrong top-1 result is a retrieval-quality finding, never a governance finding, and the two
are reported separately below on purpose.**

## Method

24 hand-curated queries across three categories, each with a known, DB-derived acceptable-
fragment set (not guessed): **law** (8, some with a known chapter — acceptable set = every real
chunk in that source+chapter), **court** (10 — 5 topic-based, 5 case-number/citation lookups;
acceptable set = every real chunk in that exact decision's materialization), **standard** (6,
acceptable set = every real chunk in that source). Top-10 pgvector cosine search per query.
Reported per query: rank of first acceptable hit, top-1/3/5/10, reciprocal rank, the actual top-1
hit (fragment/materialization/source/chapter/score), and whether that top-1 hit's provenance
resolves cleanly through `buildRetrievalResult` against the real governed chunk (it does, on
every single hit in this run, correct or not — see Governance vs. Quality below).

## Aggregate results

| Category | n | top-1 | top-3 | top-5 | top-10 | MRR |
|---|---|---|---|---|---|---|
| **Overall** | 24 | 15 (62.5%) | 19 (79.2%) | 20 (83.3%) | 23 (95.8%) | **0.723** |
| law | 8 | 3 (37.5%) | 6 | 7 | 8 | 0.587 |
| court (topic) | 5 | 3 (60%) | 4 | 4 | 4 | 0.667 |
| court_citation (case number) | 5 | 4 (80%) | 4 | 4 | 5 | 0.833 |
| standard | 6 | 5 (83%) | 5 | 5 | 6 | 0.861 |

## Failure mode distribution

| Mode | Count |
|---|---|
| NONE (correct at rank 1) | 15 |
| `SEMANTIC_MISS` | 5 |
| `DUPLICATE_NEAR_DUPLICATE_RANKING` | 4 |
| `LEXICAL_IDENTIFIER_MISS` | 0 |
| `SOURCE_FAMILY_MISS` | 0 |
| `CHAPTER_SCOPE_MISS` | 0 |
| `QUERY_TOO_AMBIGUOUS` | 0 |

Classification is heuristic (encoded in `classifyFailure()`, `scripts/db/legal-retrieval-
quality-baseline-01.ts`) and every classified query's top-3 hits are printed in the raw run log
for spot-checking, not asserted as ground truth beyond that.

## Governance vs. quality — kept strictly separate

**`top1_provenance_intact`: 24/24 (100%).** Every single top-1 hit across all 24 queries,
correct or not, resolved cleanly through `buildRetrievalResult` back to its exact governed
`fragment_id`/`materialization_id`. The identity/provenance chain never produced a fabricated,
untraceable, or mismatched result — it just sometimes retrieved a real chunk that was not the
best answer. This is the same distinction the bounded pilot already established at small scale;
it holds at full scale too.

## Notable real findings (not tuned to look interesting, reported as observed)

- **Case-number citation lookup was the strongest category (MRR 0.833), not the weakest.** This
  is a genuinely different result from the bounded pilot's earlier finding (case numbers were a
  weak signal there). At 31,706-chunk scale, with distinctive case numbers appearing verbatim in
  each decision's own `DOMSLUT` header text ("SVEA HOVRÄTT DOM P 13258-25"), lexical citation
  matching turned out to work well for embedding-based search too — worth keeping in mind before
  assuming a lexical/BM25 layer is strictly necessary for citation lookup; the pilot's contrary
  result may have been a small-sample artifact.
- **Law was the weakest category (MRR 0.587)**, and every one of its failures was either
  `SEMANTIC_MISS` (wrong *source*, e.g. query L1 "Vad är miljöbalkens mål..." top-1 hit came from
  `regeringskansliet-sfs-1998-899` chapter 1, not Miljöbalken itself — generic "purpose/chapter 1"
  boilerplate language is genuinely similar across different Swedish ordinances) or
  `DUPLICATE_NEAR_DUPLICATE_RANKING` (right *source*, wrong chapter ranked first, correct chapter
  present a few ranks down). Zero `CHAPTER_SCOPE_MISS` or `SOURCE_FAMILY_MISS` occurred — the
  model never confused law with court or standard content, only different *law* sources/chapters
  with each other.
- **Standard sources performed best (MRR 0.861)** — small, topically distinct corpora are easy
  for vector search; the one miss (S5, ambiguous by design — "Bemyndigande enligt
  miljötillsynsförordningen" is a citation phrase that also appears inside unrelated MMÖD court
  text) was exactly the kind of cross-family lexical overlap the `ambiguous_by_design` flag was
  meant to predict.

## What this suggests (evidence for a later decision, not a decision)

Per the failure-mode pattern actually observed:
- Correct source found but wrong chapter ranked first (`DUPLICATE_NEAR_DUPLICATE_RANKING` on law
  queries) points toward **chapter/metadata-aware filtering or reranking** being the more
  promising lever for law retrieval specifically — not toward lexical/hybrid search, since these
  are not citation misses.
- Zero `LEXICAL_IDENTIFIER_MISS` occurred this run, so this baseline does **not** show a clear
  case for adding BM25/hybrid search purely for citation lookup — that need was hypothesized, not
  observed, in this measurement. A larger citation-specific battery would be needed before ruling
  it in or out with confidence.
- Cross-source confusion between similarly-worded law sources (L1) suggests **source-aware query
  routing or metadata filtering** (e.g. "search within Miljöbalken only" when the query names it)
  is a concrete, evidence-backed candidate.

None of these are decided or implemented here — they are exactly the kind of comparison the next,
separate unit should weigh with more data.

## What this does not claim

- Not a decision between vector-only / BM25+vector hybrid / metadata-aware retrieval / reranker /
  query routing — that comparison is the explicitly separate next unit.
- 24 queries is a real, hand-verified baseline, not an exhaustive golden set — failure-mode
  percentages should be read as directional evidence, not precise population statistics.
- No retrieval code, ranking, or query logic was changed to produce these numbers.

## Next

A data-driven decision between vector-only / hybrid BM25+vector / metadata-aware retrieval /
reranking / query routing per family, informed by this baseline's actual failure-mode evidence.
Not started here.
