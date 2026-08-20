# LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01 — PROVEN (mixed, honestly reported)

**Status:** PROVEN as a correctly-built, correctly-bounded mechanism. The comparison run against
the frozen `LEGAL-RETRIEVAL-QUALITY-BASELINE-01` shows a **real, mixed result for `law`** — net
top-1 improvement, net MRR decrease, both concentrated on exactly the queries already flagged
`ambiguous_by_design` before this unit started. `court`/`court_citation`/`standard` are proven
**byte-identical** to the frozen baseline, both by construction and by measurement. No hybrid
search, reranker, or query rewriting was added — this is exactly the narrow, metadata-only
routing step the baseline's failure-mode evidence pointed to.

## What was built

- **`server/modules/legal/retrieval/LawSourceRouter.ts`** — `routeLawQuery(query)`: pure,
  deterministic, no I/O. Returns a `source_constraint` only when the query names a statute by a
  well-known unambiguous common name (Miljöbalken, Miljöprövningsförordningen,
  Avfallsförordningen, Plan- och bygglagen/PBL) or an explicit SFS number (all six sources,
  including the two — `1998:899` and `2011:338` — whose common names are genuinely ambiguous with
  each other and therefore have NO name pattern registered, only the SFS-number one). A
  `chapter_constraint` is only ever returned alongside a source constraint — a bare chapter number
  is meaningless without knowing which statute it belongs to.
- **`scripts/db/legal-retrieval-law-metadata-routing-01.ts`** — the comparison run. Imports
  `QUERIES` and the exact scoring logic (`resolveAcceptableFragmentIds`, `classifyFailure`,
  `provenanceIntact`) from the frozen baseline script **unchanged** — never a hand-tuned rerun or
  a drifted copy of the 24 queries. Applies the routing constraint only to `law`-category queries;
  `court`/`court_citation`/`standard` queries run through the byte-identical unconstrained search,
  making regression outside `law` structurally impossible, not just observed to be absent.
- **`tests/unit/server.modules.legal.retrieval.LawSourceRouter.test.ts`** — 8 tests covering all
  4 required proofs (see below), plus the Swedish-inflection regex bug found and fixed while
  writing them (see "Bugs found and fixed").

## The 4 required proofs

| # | Proof | Result |
|---|---|---|
| 1 | Named statute -> correct source constraint | PROVEN — "Vad är miljöbalkens mål..." -> `regeringskansliet-sfs-1998-808`; explicit SFS numbers correctly disambiguate `1998:899` vs `2011:338`, which share nearly identical titles and have no name pattern |
| 2 | Named statute + chapter -> correct source AND chapter constraint | PROVEN, including a letter-suffixed chapter ("10 a kap.") preserving the suffix |
| 3 | No source signal -> no fabricated constraint | PROVEN — a generic query, a bare chapter number with no named statute, and an ambiguous shared-name query (no SFS number given) all correctly return `source_constraint: null` |
| 4 | Retrieval trace records exactly which routing/filter decision was applied | PROVEN — `describeRoutingDecision()`'s output is placed directly into the real `RetrievalExecutionTrace`'s `expansion_path` field, verified against the actual `mps-retrieval-trace` package, not a stand-in |

## Bugs found and fixed while building this unit

1. **Swedish inflection regex bug.** `/miljöbalken?\b/i` does not match `"miljöbalkens"` (genitive)
   — the `\b` fails mid-word before the genitive `-s`. Fixed to match the bare stem with only a
   leading boundary (`/\bmiljöbalk/i`), covering every inflected form. Caught immediately by
   proof #1's own test, before this ever reached the comparison run.
2. **`main()` executed as an import side effect.** The baseline script had no entry-point guard,
   so `import { QUERIES } from './legal-retrieval-quality-baseline-01'` also re-ran its entire
   `main()`, producing an interleaved, double-counted first comparison run. Fixed with a proper
   `import.meta.url === pathToFileURL(process.argv[1]).href` guard — a naive string-concat
   comparison (`file://${process.argv[1]}`) does NOT work on Windows, where `import.meta.url`
   percent-encodes non-ASCII path segments (`ö` -> `%C3%B6`) and always uses three slashes after
   `file:`, neither of which a manual concat reproduces.
3. **A real ambiguity in the test-helper's provenance check, not the governed contract.** The
   known Part G duplicate MMÖD materialization (documented in
   `LEGAL-CORPUS-PUH-COURT-SCALE-01-PROVEN.md`) shares a `fragment_id` with its correctly-labeled
   counterpart — `fragment_id` is unique only per `(materializationId, fragmentId)`, never
   globally. `provenanceIntact()`'s original `fetchGovernedChunkRefs([hit.fragment_id])` call
   could return 2 rows for that one fragment_id, and the in-memory lookup (keyed by fragment_id
   alone) silently kept only the last one — causing a spurious `MATERIALIZATION_MISMATCH` when
   the OTHER row was the one actually being checked. **This is not a defect in
   `mps-legal-retrieval-contract`** — `buildRetrievalResult` did exactly its job, correctly
   rejecting an ambiguous pairing rather than silently accepting it. Fixed by building the ref
   directly from the already compound-keyed `chunkRow` lookup instead of the ambiguous
   fragment-id-only fetch.

## Comparison result vs. the frozen baseline

**`court` / `court_citation` / `standard`: byte-identical to the frozen baseline** (MRR 0.667 /
0.833 / 0.861 respectively, matching exactly) — proven both by construction (unconstrained code
path, unreachable by routing) and by this run's measurement.

**`law`: a real, mixed result.**

| | Baseline | Routed | Delta |
|---|---|---|---|
| top-1 | 3/8 (37.5%) | 4/8 (50%) | **+1** |
| top-3 | 6/8 | 5/8 | −1 |
| top-5 | 7/8 | 5/8 | −2 |
| top-10 | 8/8 | 6/8 | **−2** |
| MRR | 0.587 | 0.556 | **−0.031** |

Per-query:

| Query | Routing applied | Baseline rank | Routed rank | Change |
|---|---|---|---|---|
| L1 | source=1998-808 | 4 | **1** | improved |
| L2 | source=1998-808 | 9 | 9 | unchanged |
| L3 | source=1998-808, chapter=9 | 2 | **not in top-10** | **regressed** |
| L4 | no_constraint | 3 | 3 | unchanged |
| L5 | no_constraint | 1 | 1 | unchanged |
| L6 | source=2010-900 | 2 | **1** | improved |
| L7 | source=1998-808, chapter=9 | 1 | **not in top-10** | **regressed** |
| L8 | no_constraint | 1 | 1 | unchanged |

**Both regressions landed exactly on the two law queries already flagged `ambiguous_by_design:
true` before this unit started** (L3, L7) — zero regressions on any unambiguous query. Root cause
for both is the same, and it is not a router defect: each query explicitly names **two different,
related statutes** in the same sentence (L3: "tillstånd enligt 9 kap. miljöbalken" — but the
baseline's chosen answer is Miljöprövningsförordningen, which *implements* Miljöbalken chapter 9,
not Miljöbalken itself; L7: "Förordning om miljöfarlig verksamhet och hälsoskydd enligt 9 kap.
miljöbalken" — names the implementing regulation by description AND cites Miljöbalken by name in
the same query). The router picks up the one name pattern it recognizes (`miljöbalken`) and
correctly constrains to exactly what that name says — which is a *literally correct* reading of
the query, just not the reading the baseline's hand-chosen "acceptable answer" assumed. This is a
genuine scope boundary of single-statute routing on multi-statute-referencing queries, not a bug,
and it is exactly the kind of failure mode a pre-registered `ambiguous_by_design` flag exists to
predict — which it did, on both occurrences.

Both improvements (L1, L6) are queries that name exactly one statute and had no cross-reference
ambiguity — routing worked cleanly.

## What this does not claim

- Not a net win on every metric for `law` — MRR went down even though top-1 went up, and that
  trade-off is reported plainly, not smoothed into a single "improved" headline.
- Does not resolve multi-statute-referencing queries (L3/L7's failure mode) — a candidate for a
  later refinement (e.g. preferring the most specific/implementing regulation when multiple
  statutes are named), not attempted here.
- `court`/`court_citation`/`standard` were never at risk in this design (the constraint code path
  is structurally unreachable for them) — this is a property of the implementation, not something
  that required careful tuning to achieve.
- No hybrid BM25/vector, reranker, or query rewriting — still explicitly out of scope.
- No independent holdout battery yet — this comparison reuses the same 24 queries the baseline
  was built from. A holdout set to check generalization (rather than overfitting to 24 known
  queries) is the next step, not done here.

## Next

Per the recommended order: create an independent holdout battery, evaluate generalization of
both the baseline and this routing step, and only then revisit whether the L3/L7-style
multi-statute ambiguity needs a refinement — not decided here.
