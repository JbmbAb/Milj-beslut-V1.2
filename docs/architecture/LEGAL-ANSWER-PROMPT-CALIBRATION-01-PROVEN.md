# LEGAL-ANSWER-PROMPT-CALIBRATION-01 — PROVEN

**Status:** PROVEN. A real, honest, mixed result — a genuine, measured improvement on the
demonstrated problem, with zero technical-contract regressions across 60 real queries, and one
new, real finding that is NOT resolved here and should not be presented as such.

## Scope, exactly as approved

```
IN:  prompt/version only, answer-model decision calibration, bounded synthesis behavior,
     a separate calibration set, a rerun of the frozen 40-query baseline, a new independent holdout
OUT: retrieval policy, embedding model, context assembly, citation contract,
     the query specificity gate, reranker, hybrid/BM25
```

Confirmed: the only production code change is `GeminiAnswerModelProvider.ts`'s `buildPrompt()`
wording and `ANSWER_PROMPT_VERSION` (`answer-prompt-v1` → `answer-prompt-v2`). `RESPONSE_SCHEMA`/
`ANSWER_RESPONSE_SCHEMA_VERSION`, retrieval, context assembly, the citation contract, and the
specificity gate are all byte-for-byte unchanged.

## What changed in the prompt

v1 told the model only to answer strictly from the passages or declare
`insufficient_evidence=true`. v2 adds, and only adds:

- explicit permission for **bounded synthesis** across multiple correctly-cited passages, with the
  answer's scope/limitation stated in the text itself, when no single passage alone covers the
  question but several together do
- an explicit **counter-instruction against overclaiming**: `insufficient_evidence=true` only when
  passages genuinely lack content addressing the question's core — but never treat "some relevant
  passage exists" as license to always answer; a synthesis that goes further than the cited
  passages actually say is exactly as wrong as an unwarranted refusal

No rule resembling "always answer if any evidence exists" was added, per the explicit
requirement — the prompt still requires `insufficient_evidence=true` whenever the passages don't
genuinely support an answer.

## Three separate measurements, exactly as required

### 1. Calibration set (10 queries, used for prompt development)

Includes the two known `FALSE_REFUSAL` cases this unit specifically targets, three known
`GOOD_REFUSAL` cases, three known direct-factual `ANSWERED` cases, and the known
`QUERY_UNDERSPECIFIED` gate case.

| id | target | result | note |
|---|---|---|---|
| CAL-H1 | ANSWERED | **PASS** | topic-summary synthesis — the demonstrated false-refusal case now answers, well-grounded (6 claims, all traced to real, on-topic passages) |
| CAL-H18 | ANSWERED | MISS | cross-statute relational synthesis — still declines. The harder sub-case remains unresolved. |
| CAL-L7 | INSUFFICIENT_EVIDENCE | MISS (see below) | ambiguous_by_design case flipped to ANSWERED — hand-inspected, all 3 claims faithfully hedged ("Såvitt framgår av det bifogade materialet...") and grounded in real passages. Not an overclaim; this looks like a genuine improvement, but its original "GOOD_REFUSAL" label was itself an artifact of a narrow ground-truth scope definition, not a considered quality judgment — flagged for the owner rather than silently accepted as a pass. |
| CAL-X1/X2/X4 | INSUFFICIENT_EVIDENCE | PASS (all 3) | genuinely out-of-corpus/fabricated cases still correctly refused |
| CAL-L1/C6/S1 | ANSWERED | PASS (all 3) | direct factual answers unaffected |
| CAL-X5 | QUERY_UNDERSPECIFIED | PASS | gate still intercepts before any model call |

**8/10 hard-target matches.** 100% provenance intact, 100% citations within retrieval set, across
all 10.

### 2. Frozen 40-query answer-quality baseline (regression comparison only, rerun unmodified)

| Metric | v1 (prior unit) | v2 (this unit) | Delta |
|---|---|---|---|
| `FALSE_REFUSAL` | 2 (H1, H18) | 1 (H18 only) | **H1 fixed** |
| `GOOD_REFUSAL` | 7 | 5 | L7 and X3 flipped to `ANSWERED` |
| `RETRIEVAL_MISS_BUT_ANSWERED` | 6 | 7 | +1 (L7) |
| Provenance intact, all queries | true | true | unchanged |
| Citations within retrieval set, all queries | true | true | unchanged |

L7's flip exactly reproduces the calibration set's own L7/CAL-L7 result (same query, same
outcome — a consistent, not fluky, signal). X3 (`"Vad säger EU:s art- och habitatdirektiv om
skyddade arter?"`, originally assumed hard/out-of-corpus) also flipped to `ANSWERED`; hand
inspection found the corpus genuinely contains a Miljöbalken provision (§27) that references the
EU Habitats Directive by name for designating protected areas — the model's two claims are
faithful, hedged paraphrases of that real provision. This was **not** a defect in the baseline's
original `GOOD_REFUSAL` classification going bad; it reveals that classification's own ground-truth
assumption (no EU-directive content exists in this corpus) was simply wrong. Two more claim-count
outliers (`C1`: 16→7, `C3`: 1→8) were spot-checked directly against their cited fragments' real
text — both faithful, `C3`'s expanded answer if anything more complete and accurate than v1's,
not overreaching.

**No new `CITATION_MISS`, fabricated identifier, or provenance defect was found anywhere in this
rerun.**

### 3. New independent holdout (10 queries, final generalization proof — never used in any prior battery)

Five direct-factual queries on previously-unused MB/AVF/PBL/MFH_2011 chapters, two brand-new
cross-statute relational-synthesis queries (not in the calibration set, to test whether the v2
prompt generalizes beyond the two cases it was built against), one new ambiguous_by_design query,
one implicit-source query, and one deliberately uncovered-statute query.

| id | target | result | note |
|---|---|---|---|
| NH1/NH2/NH3/NH5 | ANSWERED | PASS (all 4) | new chapters, direct factual, correct |
| NH4 | ANSWERED | MISS | PBL ch.8 — evidence reached retrieval (containment=true) but the model still declined; the retrieved chunks for this chapter were themselves fragmentary cross-references in this corpus, so this may be an appropriately cautious refusal at the chunk-content level rather than a prompt defect — not resolved here |
| NH6 | ANSWERED | **PASS** | NEW cross-statute synthesis case (MB ch.26 tillsyn vs. MFH_1998 ch.9) — generalizes correctly, well-grounded |
| NH7 | ANSWERED | MISS | NEW cross-statute synthesis case (PBL ch.9 vs. MB ch.2) — still declines |
| NH8 | INSUFFICIENT_EVIDENCE | informational | ambiguous_by_design (5 sources share ch.2) — refused, consistent with the frozen router's own design; not scored |
| NH9 | ANSWERED | PASS | implicit-source query, correct and well-grounded despite a scope-definition miss |
| NH10 | INSUFFICIENT_EVIDENCE | **MISS — the key finding, see below** | |

**6/9 hard-target matches** (NH8 excluded as informational). 100% provenance intact, 100% citations
within retrieval set, across all 10.

## The one real, unresolved finding: NH10 — silent statute substitution

`NH10` asked `"Vilka regler gäller för fiske och fiskevård enligt fiskelagen?"` — naming a statute
(fiskelagen) that genuinely does not exist in this corpus, by design. The model answered anyway,
with one claim citing a REAL passage from a DIFFERENT real statute — `lagen (1998:812) med
särskilda bestämmelser om vattenverksamhet`, § 8, which does discuss fish-protection obligations
for water operations — without noting that this is not actually "fiskelagen" as the user asked
about.

This is **not** a `CITATION_MISS` (the citation is real and matches the claim's content) and **not**
a fabrication (nothing was invented). It is a distinct, narrower risk than classic overclaim: the
model treated a query naming an uncovered statute as answerable using thematically-adjacent content
from a different real statute, silently substituting sources rather than flagging the mismatch or
declining. This is precisely the class of risk flagged in advance — "always answer if evidence
exists" would trade false refusals for overclaims — showing up in a mild, real form despite the
prompt explicitly NOT containing that rule. Left unresolved and unfixed here: no further prompt
iteration was attempted, per the instruction not to keep optimizing against newly-discovered single
cases outside a properly scoped follow-up.

## Determinism note, as instructed

Per the standing finding that `temperature=0` does not guarantee bit-identical Gemini output
across separate calls (H21 answered differently across two earlier runs), this unit does not treat
exact reproducibility of model text as a requirement or a failure mode. The `AnswerTraceArtifact`
binds the actually-observed model response (validated citations, `cited_fragment_ids`,
`answer_trace_hash`) — replay means verifying that captured response, not re-invoking Gemini and
expecting identical text.

## What this does not claim

- Cross-statute relational synthesis is not solved — `CAL-H18` and `NH7` both still decline;
  `NH6` succeeding shows the calibration generalizes sometimes, not reliably.
- `NH10`'s silent-statute-substitution finding is open, not fixed. A follow-up (either a further
  prompt refinement requiring the model to name which statute a passage actually comes from when
  the query names one explicitly, or a structural check comparing the query's named statute against
  the cited materialization's actual source) is a real candidate next step, not decided here.
- No further prompt iteration was attempted against NH10 or NH4/NH7 — this unit stops at
  measurement, per the instruction to avoid narrowly re-optimizing against each newly found case.
- Retrieval, context assembly, citation contract, and the specificity gate are unchanged and
  unaffected — confirmed by zero regressions in provenance/citation integrity across all 60 queries
  run in this unit (10 calibration + 40 baseline + 10 holdout).

## Recommendation

`answer-prompt-v2` is a genuine, net improvement on the specific problem it targeted (false refusal
on synthesis-style questions), measured consistently across three independent runs, with zero
technical-contract regressions. It is reasonable to keep it as the active prompt version. **Answer
Quality Baseline V2 should not be frozen as "done" without addressing NH10** — that is a real,
newly-discovered finding, not resolved by this unit, and belongs in whatever the owner decides is
next: a scoped NH10-specific follow-up, inclusion as a known limitation in Baseline V2's own write-
up, or a decision that this class of risk is acceptable for the current stage. Not decided here.
