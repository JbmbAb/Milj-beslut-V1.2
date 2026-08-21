# LEGAL-ANSWER-MULTISOURCE-RETRIEVAL-BUDGET-01 — IMPLEMENTED / PROVEN

**Status:** IMPLEMENTED / PROVEN. Closes `H21`'s false-block (surfaced in the prior unit) with a
narrow, retrieval-layer-only fix, strictly local to the multi-source routing candidate budget.
Prompt, context assembly, and the citation contract are untouched.

**Correction (owner review):** an earlier draft of this document's accompanying chat summary
characterized the frozen 40-query battery as fully rerun and green. That overstated the evidence.
The dedicated proof script (5/5, zero errors) is a clean, complete proof on its own terms. The
frozen 40-query battery, separately, was only **32/40 executed with a clean upstream response**
this session — the other 8 are **`NOT_OBSERVED_DUE_TO_UPSTREAM_UNAVAILABILITY`** (Gemini `503`),
not `FAIL` and not silently folded into "no regression." See "Frozen 40-query battery: exact
evidentiary status" below for the corrected, itemized accounting, including the explicit
regression-closure argument for those 8 (built from three separate legs, not asserted as a single
executed run).

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

## Frozen 40-query battery: exact evidentiary status

Consolidated across two frozen-40 attempts this session:

```
32/40  EXECUTED WITH CLEAN UPSTREAM RESPONSE THIS SESSION
       32/32 observed: no regression, 100% provenance intact, 100% citations within retrieval set,
       no new CITATION_MISS or fabricated identifier. H18 and H19 (multi-source relational
       queries) newly answered as a side effect -- evidence this fix generalizes past H21.

 8/40  NOT_OBSERVED_DUE_TO_UPSTREAM_UNAVAILABILITY this session (C1, C4, C6, C9, S4, S5, H16, X4)
       -- not FAIL, not silently counted as "no regression found."
```

**This is not a 40/40 executed proof.** For the 8 not observed this session, a separate,
explicitly-labeled regression-closure argument is offered instead, built from three distinct legs:

1. **Previous same-session frozen execution.** All 8 were run to completion, with a clean upstream
   response, during `LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01`'s own frozen-40 rerun — under
   the identical configuration this unit inherits unchanged (`answer-prompt-v2`, the named-source
   gate active, same retrieval policy version). Observed then:

   | id | mode | claims | containment | answered_verdict |
   |---|---|---|---|---|
   | C1 | ANSWERED | 13 | true | RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE |
   | C4 | ANSWERED | 9 | false | RETRIEVAL_MISS_BUT_ANSWERED |
   | C6 | ANSWERED | 9 | true | RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE |
   | C9 | ANSWERED | 1 | true | RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE |
   | S4 | ANSWERED | 6 | true | RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE |
   | S5 | ANSWERED | 1 | true | RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE |
   | H16 | ANSWERED | 3 | true | RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE |
   | X4 | INSUFFICIENT_EVIDENCE | 0 | — | GOOD_REFUSAL |

   (This table is reproduced from this session's own tool output, not a separately re-verified
   committed artifact from an earlier unit's markdown — flagged explicitly as that, not overstated
   as more than it is.)

2. **Code-path non-impact proof.** This unit's only change is the `if (routing &&
   routing.source_candidates.length >= 2)` branch inside `searchChunks`. Verified structurally,
   not by inspection alone: `C1/C4/C6/C9` and `S4/S5/X4` are `family="court"`/`"standard"`, for
   which `performLegalRetrieval` never computes routing at all (`routing` stays `null` —
   see `LegalRetrievalComposition.ts`'s `if (request.family === "law")` guard) — the new branch's
   condition is `routing && ...`, so it cannot evaluate true. `H16` is `family="law"` but is an
   `implicit_source` query that has never, in any prior run across this entire track, surfaced more
   than one distinct source (confirmed again in this unit's own consolidated 32/40 data, where no
   `implicit_source` query at 0/1 recognized candidates changed behavior) — it runs the exact
   pre-existing `runSearch(..., routing, topK)` call with `routing.source_candidates.length < 2`,
   identical to the old single-query code path.

3. **This unit's own 32/32 clean observed regression run** (above) — real, fresh execution under the
   new code, zero regressions found on every case that did get a clean response.

Combining these three — a real prior clean execution under the identical inherited configuration, a
structural proof the changed code path cannot execute for these 8 queries at all, and a fresh 32/32
clean run finding zero regressions elsewhere — is offered as the regression-closure argument for
those 8, distinct from and weaker than an actual fresh 40/40 execution. A clean single-pass rerun of
all 40 can still be obtained later if Gemini's availability improves and the owner wants the
stronger form of evidence for the permanent record.

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
där och gå direkt till API/UI convergence"): the dedicated proof (5/5) is a real, complete, clean
proof of the targeted fix. The frozen 40-query battery is 32/40 executed clean this session with
zero regressions observed, plus an explicit regression-closure argument (not a fresh execution) for
the remaining 8 — accepted by the owner as sufficient, on the corrected evidentiary framing above,
to close the quality/safety track for the legal answer layer. Next: API/UI convergence, per the
frozen `PRODUCT-PROVEN` program directive.
