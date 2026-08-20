# LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01 — PROVEN

**Status:** PROVEN as a measurement. 27 new queries, none derived from or overlapping
`LEGAL-RETRIEVAL-QUALITY-BASELINE-01`'s 8 law queries — different chapters, different topics,
different phrasing, spanning all 6 real law sources. Expected-answer scopes were frozen and
independently verified against real chunk counts in the corpus **before** this script was ever
run, and were not touched afterward. No tuning happened after seeing results — the router
(`LawSourceRouter.ts`) is exactly as committed in `LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01`,
unmodified.

## Method

27 queries across 5 subcategories (5–6 each): `explicit_source`, `explicit_source_chapter`,
`implicit_source` (all three `unambiguous: true`), `multi_statute`, `ambiguous_by_design` (both
`unambiguous: false`). Each query's acceptable answer is a union of one or more `(source,
chapter)` scopes — a single scope for unambiguous queries, 2–6 scopes for multi-statute/ambiguous
queries where more than one answer is legitimately correct. Two modes compared per query: **A**
(frozen vector-only, byte-identical unconstrained search) and **B** (metadata-routed, the
unmodified router from the prior unit).

## Results — a genuinely stronger and cleaner signal than the original 24-query set

| | n | A top-1 | B top-1 | A MRR | B MRR |
|---|---|---|---|---|---|
| **Overall** | 27 | 8 (30%) | **17 (63%)** | 0.382 | **0.650** |
| **Unambiguous** | 17 | 6 (35%) | **14 (82%)** | 0.484 | **0.843** |
| Ambiguous/multi-statute | 10 | 2 (20%) | 3 (30%) | 0.210 | 0.323 |
| `explicit_source` | 5 | 1/5 | **4/5** | 0.383 | **0.800** |
| `explicit_source_chapter` | 6 | 1/6 | **6/6** | 0.329 | **1.000** |
| `implicit_source` | 6 | 4/6 | 4/6 | 0.722 | 0.722 |
| `multi_statute` | 5 | 1/5 | 2/5 | 0.200 | 0.425 |
| `ambiguous_by_design` | 5 | 1/5 | 1/5 | 0.220 | 0.220 |

## Reading this against the owner's decision criteria

**"Unambiguous queries should improve or at minimum not regress materially"** — **strongly met.**
Unambiguous MRR nearly doubled (0.484 -> 0.843), top-1 more than doubled (6/17 -> 14/17).
`explicit_source_chapter` went from the weakest unambiguous subcategory (0.329, worse than random
guessing among 6 sources) to a perfect 1.000 -- exactly the case the routing was built for.
`implicit_source` is **exactly unchanged** (0.722 -> 0.722, not just "close") because none of
those 6 queries name a statute, so the router correctly returns `no_constraint` for all of them
-- proof, at holdout scale, that the "never fabricate a constraint" rule holds and costs nothing
when there is genuinely no signal.

This holdout's unambiguous result is considerably stronger than the original 24-query
comparison's law result (which showed a net MRR *decrease*, 0.587 -> 0.556). That earlier result
was dominated by 2 of 8 law queries that were both pre-flagged `ambiguous_by_design` -- a small
sample where two adversarial cases outweighed clean wins. This larger, independent holdout shows
the routing's true behavior on unambiguous queries generalizes well and was not an artifact of
the smaller set.

**"Ambiguous/multi-statute queries may need a different routing contract rather than forced
single-source routing"** — **partially confirmed, with one clean, illustrative failure.**
`ambiguous_by_design` (5 queries with no reliably identifiable single statute) is **exactly
unchanged** by routing (0.220 -> 0.220, every one of them correctly resolved to `no_constraint`)
-- the current design already handles pure ambiguity safely by doing nothing. `multi_statute` (5
queries naming two related statutes together) is net positive (0.200 -> 0.425) but not uniformly
so: **H21** is the clean counterexample the owner's hypothesis predicted --
*"Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av
djurhållning?"* names BOTH statutes explicitly. Vector-only search correctly found the answer at
rank 1 (from `regeringskansliet-sfs-2013-251`, ch.2). The router matched only `miljöbalken` (the
first pattern in iteration order) and constrained the search to Miljöbalken alone -- which does
not contain the correct chunk, so the routed search found nothing in the top 10. **A working
unconstrained answer was turned into a total miss by forcing a single-source constraint on a
query that legitimately named two sources.** This is exactly the single-source-constraint
limitation the owner's hypothesis anticipated, now demonstrated concretely rather than inferred.

## What this evidence supports for the next decision

Per the four options on the table:

- **(A) Keep current routing as-is** — supported for `explicit_source` /
  `explicit_source_chapter` / `implicit_source` queries specifically, where the evidence is
  strong and clean.
- **(B) Allow multi-source candidate constraints** — directly motivated by H21: if the router
  returned *all* matched sources (both `miljöprövningsförordningen` and `miljöbalken`) as an
  admissible candidate set instead of picking the first match, H21's regression would very likely
  resolve without weakening the unambiguous-case wins.
  - **(C) Route only when exactly one source is unambiguous** — a stricter, narrower variant of
  (B): when a query matches more than one known source pattern, treat it the same as
  `ambiguous_by_design` (no constraint) rather than picking one arbitrarily. Cheaper to implement
  than (B), would fix H21 (falls back to unconstrained, which already found the right answer at
  rank 1) but not H18/H22-style multi-statute queries where routing to one of the two named
  sources happened to help.
- **(D) Abandon routing** — not supported by this evidence; the unambiguous-case improvement is
  too large and too clean to discard.

This is evidence for that decision, not the decision itself -- no routing change is made in this
unit, per instruction.

## What this does not claim

- Not a claim that `multi_statute`/`ambiguous_by_design` performance is acceptable as final —
  both remain well below the unambiguous categories on both A and B.
- Does not implement options B, C, or D — the router (`LawSourceRouter.ts`) is untouched.
- 27 queries is a real, independently-verified holdout, not an exhaustive population sample —
  the qualitative pattern (strong unambiguous win, clean multi-statute counterexample) is the
  main evidence, not the exact percentages.
- `court`/`court_citation`/`standard` were not re-tested here — this holdout is `law`-only, since
  that is the only family the router touches.

## Next

An owner decision among (A)/(B)/(C)/(D) for how routing handles multi-statute queries,
informed by this holdout — not made here.
