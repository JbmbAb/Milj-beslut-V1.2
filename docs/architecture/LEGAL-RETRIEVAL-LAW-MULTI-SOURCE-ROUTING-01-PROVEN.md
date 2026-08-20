# LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01 — PROVEN

**Status:** PROVEN, all 8 required proofs met with real data, and the owner's pre-committed
freeze criterion is met: **H21 is repaired, and the unambiguous-case gains persist exactly**. This
document proposes freezing metadata-routing as the first production retrieval strategy for
`law` -- see "Recommendation" for the specific ask.

## The fix

v1 (`LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01`) picked the first-matched statute and discarded any
others -- `LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01`'s H21 showed this could exclude the source
that actually held the correct answer. v2's canonical rule:

```
0 recognized statutes  -> no source constraint
1 recognized statute   -> source constraint = {that statute}
2+ recognized statutes -> source constraint = {all recognized statutes}, never first-match-wins
```

Chapter binding is now **source-aware**: a chapter mention binds to a specific candidate only
when textually adjacent to it (within a small window, with no *other* recognized source's
mention sitting between them) -- `"9 kap. miljöbalken och miljöprövningsförordningen"` binds
chapter 9 to Miljöbalken only, leaving Miljöprövningsförordningen as an unrestricted (any
chapter) candidate, rather than either applying chapter 9 to both or dropping
Miljöprövningsförordningen entirely (v1's actual bug).

## The 8 required proofs — all green

| # | Proof | Result |
|---|---|---|
| 1 | Single statute -> existing behavior unchanged | PROVEN — one candidate, no chapter, identical to v1 |
| 2 | Single statute + chapter -> existing perfect holdout behavior preserved | PROVEN — one candidate with chapter bound |
| 3 | Two statutes -> both admitted | PROVEN |
| 4 | H21 -> correct source no longer excluded | PROVEN — real run: `sources=regeringskansliet-sfs-2013-251[any]+regeringskansliet-sfs-1998-808[any]`, rank 1 (was: excluded entirely, rank null under v1) |
| 5 | Three statutes -> all recognized sources admitted deterministically | PROVEN — query order preserved |
| 6 | Unknown statute wording -> no fabricated source | PROVEN, including with a bare chapter present |
| 7 | `ambiguous_by_design` -> `no_constraint` unchanged | PROVEN |
| 8 | Trace records exact source candidate set + per-source chapter constraint | PROVEN, verified against the real `mps-retrieval-trace` package: `law-source-routing-v2:sources=regeringskansliet-sfs-1998-808[ch.9]+regeringskansliet-sfs-2013-251[any]` |

## Real comparison runs — both the frozen baseline and the frozen holdout, expected answers untouched

### Original 24-query set: unchanged (as it should be)

`law` MRR: 0.587 (frozen baseline) -> 0.556 (v1) -> **0.576 (v2)**. L3 and L7 (the two queries
that regressed under v1) are **unaffected by the multi-source fix** because neither query ever
named a second statute in the first place -- L3/L7 each name exactly one statute (Miljöbalken)
while the baseline's chosen "correct" answer is a *different*, unnamed statute. Multi-source
routing cannot recover a source the query never mentions; this was never the failure mode v2
targets, and the near-identical result versus v1 confirms that honestly rather than papering over
it with a coincidental change.

### Holdout set (27 queries): the real target improves further, everything else holds exactly

| | A (vector-only) | v1 (single-source) | **v2 (multi-source)** |
|---|---|---|---|
| Overall MRR | 0.382 | 0.650 | **0.687** |
| Unambiguous MRR | 0.484 | 0.843 | **0.843 (exactly unchanged)** |
| `multi_statute` MRR | 0.200 | 0.425 | **0.625** |
| `multi_statute` top-1 | 1/5 | 2/5 | **3/5** |
| `ambiguous_by_design` MRR | 0.220 | 0.220 | **0.220 (exactly unchanged)** |

**H21 fixed exactly as targeted**: `A` rank 1, v1 rank null (excluded), **v2 rank 1** — the
routed search now matches the unconstrained search's correct answer.

**H18 also improved**: now correctly admits both `avfallsförordningen[ch.2]` and
`miljöbalken[ch.2]` as parallel per-source chapter-bound candidates (v1 could only bind one
chapter to one source at a time).

**One honest trade-off found, not hidden: H22 flips from a lucky v1 guess to a principled v2
non-answer.** v1's chapter logic naively grabbed the *first* chapter mention anywhere in the
query and applied it to whichever single source it had matched, regardless of adjacency — for
H22 (`"4 kap. förordningen om miljöfarlig verksamhet och hälsoskydd till bestämmelserna i
miljöbalken"`), that happened to produce the right answer (chapter 4 got glued to Miljöbalken,
which was coincidentally correct) even though "4 kap." is not actually adjacent to "miljöbalken"
in the sentence — it is adjacent to the unrecognized "förordningen..." phrase. v2's stricter
adjacency check correctly declines to bind chapter 4 to Miljöbalken (since they are not actually
associated), leaving Miljöbalken unrestricted — and the correct chunk does not rank in the top 10
without that chapter narrowing. This is a real regression on one query, and it is the direct,
expected cost of replacing an unprincipled heuristic (grab any nearby-ish chapter number) with a
correct one (bind only when actually adjacent) — not a new bug.

## Recommendation

Per the owner's stated criterion ("Om H21 repareras och de unambiguous-vinsterna består skulle
jag då frysa metadata-routing som den första riktiga production retrieval-strategin för law"):
**both conditions are met** — H21 is repaired and the unambiguous gains persist exactly
unchanged. This document is submitted as evidence for that freeze decision, not a unilateral
declaration of production status — confirming the freeze itself is the owner's call.

## What this does not claim

- Does not resolve `multi_statute`/`ambiguous_by_design` fully — both remain well below the
  unambiguous categories on every metric.
- `court`/`court_citation`/`standard` are unaffected by construction (the routing code path is
  unreachable outside `law`) — not re-verified numerically in this unit, since nothing in the
  code path they use changed.
- No BM25, hybrid search, or reranker — still explicitly out of scope. The holdout evidence
  continues to support the owner's read: the remaining problem is candidate constraint precision,
  not embedding weakness in general.
- `regeringskansliet-sfs-2011-338`'s `"(miljötillsyn)"` qualifier is still not registered as a
  disambiguating name pattern (only its SFS number is) — H20 stays unresolved for this reason,
  unchanged from v1. Not addressed here; a candidate for a future, separately-scoped refinement,
  not attempted without a similarly concrete piece of evidence motivating it.

## Next

Owner decision on whether to formally freeze law metadata routing as the production retrieval
strategy for `law`, per the criterion above. If frozen, wiring it into an actual retrieval-serving
path (currently everything remains script-only, per every unit in this track so far) would be a
separate, later unit.
