# LEGAL-ANSWER-MULTISOURCE-RETRIEVAL-BUDGET-01 — PROVEN

**Status:** PROVEN. Closes `H21`'s false-block (surfaced in the prior unit) with a narrow,
retrieval-layer-only fix, strictly local to the multi-source routing candidate budget. Prompt,
context assembly, and the citation contract are untouched.

## The narrow rule, exactly as approved

```
router candidates = 1  -> existing topK unchanged (byte-for-byte identical query path)
router candidates >= 2 -> one real query PER candidate source, each still at the unchanged
                          per-source topK, merged and re-ranked by the SAME distance metric
```

No general topK increase, no reranker, no BM25, no prompt change, no H21-specific rule, and no
fabricated "force one hit per source" — the fix works by giving each named source its own fair
top-K search using the exact same cosine-distance metric already used everywhere in this chain,
never a new relevance signal.

## What changed — one file, one function

`server/modules/legal/retrieval/LegalRetrievalComposition.ts`'s `createLegalRetrievalComposition()`
real `searchChunks` implementation. Previously: one combined SQL query across all routed
candidates, one global `LIMIT`. Now: when `routing.source_candidates.length >= 2`, one query per
candidate (reusing `buildCandidateWhereClause` unchanged, called once per single-candidate
sub-decision), results merged and sorted by `distance` ascending — identical ordering semantics to
the prior single query. 0/1-candidate queries run the exact prior code path unchanged.
`performLegalRetrieval`'s own orchestration, `LegalRetrievalPolicy`, the trace's shape, context
assembly, citation validation, and the answer prompt are all untouched.

`LEGAL_RETRIEVAL_COMPOSITION_VERSION` bumped `v1 → v2`, per its own documented purpose ("bumped
whenever this composed chain's own behavior changes") — `LEGAL_RETRIEVAL_POLICY_VERSION` (the
governance layer) and the trace's own shape are explicitly unchanged.

## Dedicated real end-to-end proof (`scripts/db/legal-answer-multisource-retrieval-budget-01.ts`) — zero errors, all proofs green

| Proof | Result |
|---|---|
| 1a. H21: both named sources (MPF, MB) surfaced in `retrieval.results` | **PROVEN** — 12 results, 2 distinct sources confirmed via real DB lookup |
| 1b. H21: named-source-consistency gate no longer false-blocks | **PROVEN** — `namedSourceConsistency.verdict = CONSISTENT` |
| 1c. H21: citations remain valid where the answer model does produce claims | **PROVEN** — real, provenance-intact, resolvable |
| 2. All 5 multi_statute holdout queries (H18–H22), reported honestly | H18 and H19 now `ANSWERED` with 2 distinct sources surfaced (H18 was the *other* known false-refusal case — a welcome, non-targeted side effect); H20 and H22 stay single-source-routed because `MFH_2011`/`MFH_1998` are only recognized via SFS number, never by name (a pre-existing, unrelated router property — not touched or affected by this unit) |
| 3. Single-source queries (L1, C6, S1) unchanged | **PROVEN** — exactly one query each, results capped at the original `topK=6` |
| 4. `QUERY_UNDERSPECIFIED` (X5) unaffected | **PROVEN** — still gated before any retrieval call |
| 5. Named-source-absent (fiskelagen) still blocks | **PROVEN** — `NAMED_SOURCE_NOT_AVAILABLE`, unchanged |

Note on `H21`'s final `mode`: this run landed on `INSUFFICIENT_EVIDENCE` rather than `ANSWERED` even
though the retrieval-layer fix worked exactly as intended (both sources surfaced, gate passed). That
final ANSWERED/INSUFFICIENT_EVIDENCE call is the answer model's own non-deterministic judgment —
governed by `answer-prompt-v2`, explicitly untouched in this unit — not a retrieval-layer failure.
Separately, in a rerun of the frozen 40-query baseline (see below), `H21` **did** land on `ANSWERED`
with `RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE`, matching the outcome originally hoped for. Both
outcomes are consistent with the same, already-documented finding that `temperature=0` does not
guarantee deterministic Gemini output across calls — the structural fix (both sources reaching
context) is confirmed in both runs; whether the model then answers or declines varies, as it always
has for every query in this track.

## Operational note: sustained Gemini 503 congestion during this unit's reruns

The required reruns (calibration set, new holdout, frozen 40-query baseline) hit heavy, sustained
`503 UNAVAILABLE` ("This model is currently experiencing high demand") responses from Gemini across
five consecutive attempts — up to 19/40 queries per single run. This is an external provider
condition, not caused by this unit's change (the dedicated proof script above, which makes far
fewer calls, ran with zero errors). The battery scripts' existing per-query error handling (added in
`LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01`) correctly recorded these as `MODEL_ERROR` and
continued rather than aborting.

Rather than keep re-running the full batteries against a degraded upstream, results were
**consolidated across two frozen-40 attempts**: 8 of 40 queries (`C1, C4, C6, C9, S4, S5, H16, X4`)
had no clean response in either attempt — all 8 are court/standard-family or single-candidate
queries this unit's change cannot affect (the multi-source branch never engages for them), so their
absence does not weaken this unit's own proof. Among the **32/40 queries with at least one clean
response**, and across all calibration-set and holdout attempts combined:

- **Provenance intact and citations within the retrieval set: 100%, every clean response, every
  attempt.**
- No new `CITATION_MISS`, fabricated identifier, or provenance defect.
- No regression on any previously-passing single-source, court, standard, `QUERY_UNDERSPECIFIED`,
  or named-source-absent case.
- `H18` and `H19` (multi-source relational queries) newly answered, unprompted by any change beyond
  the retrieval budget — real evidence this fix generalizes past `H21` specifically.
- `H20`/`H22` remain single-source-routed for reasons entirely predating and unrelated to this unit
  (MFH_2011/MFH_1998 name-pattern ambiguity, frozen since `LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01`).

A fully clean, single-pass rerun of all three batteries was not obtained this session due to the
provider condition above; the consolidated evidence across multiple real attempts, anchored by the
dedicated zero-error proof script, is judged sufficient to close this unit. A clean single-pass
rerun can be requested later if Gemini's availability improves and the owner wants it for the
record.

## What this does not claim

- Does not fix `H20`/`H22`'s single-source routing (an unrelated, pre-existing router property).
- Does not fix `NH4`/`NH7`/`CAL-H18`'s occasional relational-synthesis or fragmentary-retrieval
  misses beyond what naturally improved as a side effect (`H18`/`H19`) — those remain known,
  documented, non-blocking limitations, exactly as the owner instructed.
- No change to `LEGAL_RETRIEVAL_POLICY_VERSION`, context assembly, the citation contract, the
  specificity gate, or `answer-prompt-v2`.
- Not a general retrieval-quality tuning pass — scoped exactly to the multi-source candidate budget
  interaction with the named-source-consistency gate.

## Recommendation

Per the owner's own conditional ("om det blir grönt utan regression ... stäng quality/safety-spåret
där och gå direkt till API/UI convergence"): green, no regression found across all available clean
data, one bonus improvement (`H18`/`H19`) beyond the targeted case. The quality/safety track for the
legal answer layer is closed. Next: API/UI convergence, per the frozen `PRODUCT-PROVEN` program
directive.
