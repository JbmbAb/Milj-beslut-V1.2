# LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01 — PROVEN

**Status:** PROVEN. Closes `NH10` (`LEGAL-ANSWER-PROMPT-CALIBRATION-01`'s unresolved finding) with
a new, dedicated gate — not a prompt change. `answer-prompt-v2` is untouched. One real, honest
trade-off surfaced in the process (`H21`, below) and is reported for an explicit owner decision,
not silently absorbed into "clean."

## The invariant, exactly as specified

```
If the query explicitly names a legal source/statute, the answer layer must verify that the
admitted context actually contains that named source before synthesis.
Named source absent from admitted context -> must not silently answer from another source.
```

A new mode, `NAMED_SOURCE_NOT_AVAILABLE`, decided after context assembly, before the answer model
is called — semantically distinct from `INSUFFICIENT_EVIDENCE` (the context can be non-empty and
topically relevant; the problem is specifically that it lacks the statute the query named) and from
`QUERY_UNDERSPECIFIED` (the query is perfectly specific — it names an exact source).

## What was built — reusing existing frozen mechanisms, never guessing

**Nothing here invents a new "which legal area is this" classifier.** Source recognition reuses
exactly the frozen, already-proven `routeLawQuery()` (`LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01`)
for the six sources this corpus actually materializes — one small, additive export
(`findSourceMentions`) was added to `LawSourceRouter.ts` so a second consumer could reuse its exact
mention spans instead of re-implementing or drifting from that recognition; `routeLawQuery()`'s own
decision logic is byte-for-byte unchanged.

That alone is not enough — `routeLawQuery` only recognizes the six sources this corpus has, so a
genuinely uncovered statute like "fiskelagen" produces zero candidates from it, indistinguishable
from "no statute named." **`server/modules/legal/answer/NamedSourceMentionDetector.ts`** (new)
closes that gap: a narrow, lexical, deterministic scan for Swedish statutory-instrument name
suffixes in definite form (`lagen`/`balken`/`förordningen`/`föreskrifterna` — the form statutes are
actually referred to by, e.g. "miljöbalken", never the bare stem), explicit SFS numbers, with a
short denylist for known false-positive-prone words (`förslaget`, `underlaget`, ...), and precise
character-span overlap against `findSourceMentions`'s own spans so a phrase like "bygglagen" inside
"plan- och bygglagen" is correctly recognized as already covered, not double-flagged. Documented as
not a general Swedish legal-NER — it catches the demonstrated pattern class, nothing more.

**`packages/mps-legal-answer-contract/src/NamedSourceConsistencyGate.ts`** (new) — the pure decision
function, `evaluateNamedSourceConsistency()`. Takes only already-resolved id lists (never raw query
text) and applies four rules in order: nothing named → `NOT_APPLICABLE`; any unrecognized
statute-shaped mention → `NAMED_SOURCE_NOT_AVAILABLE` immediately (a statute the corpus never
materializes can never be satisfied by any context); one or more named known sources all present in
context → `CONSISTENT`; any named known source absent from context → `NAMED_SOURCE_NOT_AVAILABLE`
(**all** named sources must be accounted for — a query naming two statutes where only one was
retrieved is exactly the substitution risk this gate exists to catch).

**`LegalAnswerComposition.ts`** wires it in after `buildLegalAnswerContext()`, before
`deps.answerModel.generateAnswer()`. A new dependency-injected port,
`lookupMaterializationSourceId`, resolves each admitted context entry's real
`LegalCorpusMaterialization.logicalSourceId` (Prisma-backed in the real default). **Scoped to
`family="law"` or an unspecified family** — court/standard retrieval is deliberately scoped away
from law-source materializations by family filtering already, so a law statute mentioned in passing
inside a court/standard query does not imply the admitted context should carry that statute's own
materialized text; extending this gate there is out of scope here, not silently assumed safe.
`LegalAnswerOutcome.namedSourceConsistency: NamedSourceConsistencyResult | null` was added
(`null` when not evaluated for this family) for full auditability of every response, not just
blocked ones.

## Tests — the exact proof matrix, plus determinism/purity checks

- `packages/mps-legal-answer-contract/tests/NamedSourceConsistencyGate.test.ts` — 8 tests: no
  statute named → `NOT_APPLICABLE`; `"fiskelagen"` unrecognized → `NAMED_SOURCE_NOT_AVAILABLE`
  regardless of what else is in context; `"miljöbalken"` named and present → `CONSISTENT`; statute A
  named, only statute B retrieved → `NAMED_SOURCE_NOT_AVAILABLE`; multi-source with one missing →
  `NAMED_SOURCE_NOT_AVAILABLE`; multi-source all present → `CONSISTENT`; purity; versioning.
- `tests/unit/server.modules.legal.answer.NamedSourceMentionDetector.test.ts` — 9 tests: fiskelagen
  and inkomstskattelagen flagged; miljöbalken and the multi-word "plan- och bygglagen" (PBL) correctly
  NOT flagged (phrase-overlap detection, not naive per-word matching); denylist false-positive guard;
  SFS-number detection (both an uncovered and a known number); determinism.
- `tests/unit/server.modules.legal.answer.LegalAnswerComposition.test.ts` — 6 new composition-level
  tests covering the full proof matrix end-to-end with fakes, including the family-scoping boundary
  (a court-family query mentioning miljöbalken in passing is unaffected, `namedSourceConsistency:
  null`) and confirming the answer model is never called (`vi.fn()`, asserted uncalled) once the
  gate blocks.

**36 contract-package tests, 50 unit tests, all passing.**

## Live reruns, exactly as ordered

### NH10 (the case this unit exists to fix)

```
query: "Vilka regler gäller för fiske och fiskevård enligt fiskelagen?"
before: ANSWERED (silently substituted a different real statute's content)
after:  NAMED_SOURCE_NOT_AVAILABLE  <- PASS
```

### Calibration set (10 queries): 8/10 (up from 7/10 pre-gate)

`CAL-X2` (inkomstskattelagen) reclassified from generic `INSUFFICIENT_EVIDENCE` to the more precise
`NAMED_SOURCE_NOT_AVAILABLE` — expected and correct, same pattern as NH10. `CAL-H1` still fixed
(prompt v2's own result, untouched). `CAL-H18` still declines — a known relational-synthesis
limitation, explicitly not this gate's concern per the owner's instruction. `CAL-L7`'s earlier,
already-inspected legitimate flip to `ANSWERED` is unaffected.

### New independent holdout (10 queries): 7/9 hard-target (up from 6/9 pre-gate)

`NH10` now passes. `NH4`/`NH7` remain misses — same as before this unit, unrelated to named-source
consistency (weak/fragmentary retrieval and relational-synthesis limitations respectively).

### Frozen 40-query baseline rerun: provenance and citation integrity still 100/100

`GOOD_REFUSAL` 5→4, `FALSE_REFUSAL` unchanged at 1 (`H18`), `RETRIEVAL_MISS_BUT_ANSWERED` unchanged
at 7. The `GOOD_REFUSAL` count drop is `X2` moving into the new, more precise
`NAMED_SOURCE_NOT_AVAILABLE` bucket — not a loss.

## The one real trade-off this rerun surfaced: `H21`

`H21` — `"Vad gäller enligt både miljöprövningsförordningen och miljöbalken för
tillståndsprövning av djurhållning?"` — explicitly names BOTH statutes. It was previously (both in
the original holdout proof and in every prior rerun this session) a working, well-cited
`ANSWERED` case, the flagship proof query for the frozen multi-source router itself.

**In this rerun, it returned `NAMED_SOURCE_NOT_AVAILABLE`.** The frozen router still correctly
constrains the SEARCH to both statutes as admissible candidates — that part is completely
untouched. But at `topK=6`, the retrieved results happened to be dominated by one of the two
statutes this time, so the admitted context ended up containing only one of the two named sources.
The new gate, applying the "all named sources must be accounted for" rule exactly as specified,
correctly declines rather than answer from only one of the two.

This is the gate doing exactly what it was asked to do — but it is a real, new behavioral cost on a
previously-good case, and it exposes a distinction this unit's scope does not resolve: **"the named
source is absent from the corpus entirely" (NH10, fiskelagen) and "the named source is present in
the corpus but didn't make it into this particular top-K retrieval" (H21) currently produce the
identical verdict.** Whether that is the right call, or whether multi-source-named queries deserve
a wider `topK` or a different missing-source policy, is a retrieval/context-assembly question and is
explicitly out of this unit's scope (`OUT: retrieval policy... context assembly`). Not fixed here —
surfaced for an explicit decision.

## What this does not claim

- `H18`/`NH7` (relational-synthesis) remain open, unrelated limitations, exactly as the owner
  instructed — not blocking, not addressed here.
- `NH4` (PBL ch.8, fragmentary retrieval) remains an open, unrelated finding.
- The mention detector is not a general Swedish legal-NER — documented, narrow scope.
- The gate is not evaluated for `court`/`standard` families — a scoping decision, not a proven
  absence of need there.
- `H21`'s new refusal is not resolved — flagged for the owner, per above.

## Recommendation

Per the ordering `"if clean: freeze ANSWER QUALITY BASELINE V2"` — this run is not unambiguously
clean: `NH10` is fixed exactly as required, with zero regressions to citation/provenance integrity
across all three query sets and the frozen 40, but `H21`'s new refusal is a genuine, newly
introduced trade-off on a previously-good case. Freezing Answer Quality Baseline V2 should wait on
an explicit decision about `H21`: accept the stricter multi-source semantics as-is (documented
trade-off), or open a narrowly-scoped follow-up (e.g. a larger `topK` specifically when
`routeLawQuery` returns 2+ candidates) before freezing. Not decided here.
