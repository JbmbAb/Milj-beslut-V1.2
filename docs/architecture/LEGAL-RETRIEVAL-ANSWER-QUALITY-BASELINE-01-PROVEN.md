# LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01 — PROVEN

**Status:** PROVEN / FROZEN. A larger, frozen answer/citation quality baseline, measuring answer
quality under governed citation constraints — deliberately separate from whether the chain works
technically (already proven across every prior unit in this track). No prompt/model/context tuning
happened before, during, or as a result of this run; this is a measurement grate.

## Frozen answer configuration for this run

```
retrieval_policy_version      : legal-ret-policy-1
retrieval_composition_version : legal-retrieval-composition-v1
context_assembly_version      : legal-answer-context-v1 {"max_results":8,"max_total_chars":24000}
answer_composition_version    : legal-answer-composition-v1
answer_model_id/version       : gemini-2.5-flash / 2.5
answer_pipeline_version       : answer-pipeline-gemini-v1
answer_prompt_version         : answer-prompt-v1   (new: ANSWER_PROMPT_VERSION constant added)
answer_response_schema_version: answer-response-schema-v1  (new: ANSWER_RESPONSE_SCHEMA_VERSION)
citation_contract_version     : legal-answer-citation-v1
answer_trace_contract_version : legal-answer-trace-v1
```

`ANSWER_PROMPT_VERSION` and `ANSWER_RESPONSE_SCHEMA_VERSION` are the only code change in this unit
outside the new script/doc — two additive, exported version constants in
`GeminiAnswerModelProvider.ts` (no behavior change), added so the prompt and schema can be frozen
and cited explicitly, per the owner's requirement, rather than being implicit.

## Query set: 40 queries, three already-verified sources — never hand-picked to look good

- **24 queries verbatim** from `LEGAL-RETRIEVAL-QUALITY-BASELINE-01` (8 law, 10 court, 6 standard)
  — each already has a real, DB-verified acceptable-fragment scope.
- **10 queries selected** from `LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01`'s 27 (H1, H6, H9, H12,
  H16, H18, H21, H23, H24, H26) — covering `explicit_source`, `explicit_source_chapter`,
  `implicit_source`, `multi_statute`, and `ambiguous_by_design`.
- **6 new, deliberately hard/insufficient-evidence queries** (`X1`–`X6`) — no known acceptable
  evidence scope by design: an out-of-corpus everyday question, an uncovered statute
  (inkomstskattelagen), an uncovered EU directive, a fabricated court case number, an extremely
  vague question ("Vad gäller?"), and a leading/false-premise question. `X1`/`X2` reuse the exact
  two zero-evidence cases already run once in `LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01`'s
  10-case battery.

`scripts/db/legal-retrieval-answer-quality-baseline-01.ts` runs the real, frozen-config chain
against the live corpus and Gemini for all 40, and for every query with a known acceptable-fragment
scope, independently re-derives (via direct DB queries, never trusting the composition's own
internal state) whether that scope's evidence actually reached the retrieval set —
`retrieval-set containment`. Every returned citation is independently re-verified for intact
provenance and for being within its own query's retrieval set (same pattern as the prior unit's
live battery). For every admitted claim, the script prints the claim text directly beside the
**real, DB-fetched text of every fragment it cites**, so review does not rely on memory.

## Metric definitions and automated classification

| Term | Meaning |
|---|---|
| `RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE` | mode=ANSWERED, and the known acceptable scope's evidence was present in the retrieval set |
| `RETRIEVAL_MISS_BUT_ANSWERED` | mode=ANSWERED, but the known acceptable scope's evidence was NOT in the retrieval set (model answered from something else) |
| `GOOD_REFUSAL` | mode=INSUFFICIENT_EVIDENCE, and either no acceptable evidence exists (hard/insufficient-by-design queries) or the known acceptable evidence genuinely never reached retrieval |
| `FALSE_REFUSAL` | mode=INSUFFICIENT_EVIDENCE, but the known acceptable evidence WAS present in the retrieval set — the model declined despite having a shot at answering |

## Results

**40/40 queries completed** (one transient `ANSWER_MODEL_INVALID_JSON` on the first run at query
C10 was handled by making the script catch and record `MODEL_ERROR` per-query rather than abort
the whole battery — see "Operational note" below; the retry completed cleanly with zero errors).

| Mode | Count |
|---|---|
| ANSWERED | 31 |
| INSUFFICIENT_EVIDENCE | 9 |

| Automated, ground-truth-backed metric | Count |
|---|---|
| `GOOD_REFUSAL` | 7 (L7, H24, X1, X2, X3, X4, X6) |
| `FALSE_REFUSAL` | 2 (H1, H18) |
| `RETRIEVAL_MISS_BUT_ANSWERED` | 6 (L2, L3, C4, H12, H23, H26) |
| `RETRIEVAL_CONTAINED_ACCEPTABLE_EVIDENCE` | 24 |
| Provenance intact on every admitted citation, all 40 queries | **true** |
| Every admitted citation within its own query's retrieval set, all 40 queries | **true** |

## Hand review: RETRIEVAL_MISS / ANSWER_MODEL_MISS / CITATION_MISS / OVERCLAIM

Every claim across all 31 `ANSWERED` queries was read side-by-side with its cited fragment's real
text (the script prints a 220-char preview per citation; two clusters whose supporting sentence
fell past that preview window — `C6` claims 5–10 and `C8` claims 2–4 — were independently
re-checked against the FULL chunk text directly from the DB to remove any doubt).

- **CITATION_MISS: 0 found.** Every admitted claim's content is directly traceable to its cited
  fragment's actual text, including the two deep-checked clusters above (`C6`'s claims about the
  deposit's grandwater-level ruling and the 30-vs-50-year duration dispute, and `C8`'s claims about
  fridlysning of specific species, both fully supported once the full chunk text — not just the
  220-char preview — was read).
- **ANSWER_MODEL_MISS: 0 found.** No claim was observed to contradict or misstate what its cited
  passage actually says.
- **OVERCLAIM: 0 clear-cut cases**, with one borderline exception flagged below (`X5`).
- **RETRIEVAL_MISS (6 cases: L2, L3, C4, H12, H23, H26):** in every one of these six, hand review
  found the model still cited a REAL, genuinely on-topic, correctly-quoted passage — just one
  outside this baseline's originally-defined acceptable-fragment *scope* (e.g. `L2` expected
  chapter 15 content on CO2 storage but the model correctly found and cited § 2's own CO2-storage
  provision in a different chapter; `L3` and `H23` similarly found the exact right paragraph via a
  different chapter than the hand-authored scope assumed). **This is evidence the ground-truth
  scope definitions inherited from the two prior baselines are sometimes narrower than the corpus's
  actual correct-answer surface, not evidence of a real retrieval or answer defect** — worth noting
  for whoever revisits those scope definitions, but not an answer-quality problem in this unit.
- **FALSE_REFUSAL (2 cases: H1, H18):** the one substantive, actionable finding from this
  baseline. Both are **synthesis/relational-style** law questions rather than direct lookups —
  `H1` asks for a topic summary of MPF chapter 2 ("what does the ordinance regulate about
  agriculture and animal husbandry"), `H18` asks how two different statutes' chapter-2 provisions
  *relate* to each other. In both cases the acceptable evidence was present in the retrieval set,
  yet the model declined rather than produce a hedged, partial answer. This pattern — refusing
  broad-topic-summary or cross-statute-relationship questions even with relevant evidence present —
  is the clearest, most specific signal this baseline produced for where the next tuning pass
  should look: **the answer prompt**, not retrieval or citation selection.
- **`X5` ("Vad gäller?" — deliberately near-meaningless):** the one case worth flagging even though
  it fits no cell in the requested taxonomy cleanly. The model did NOT refuse; it answered with two
  claims that are technically citation-correct (near-verbatim fragments) but practically
  non-responsive to a question with no real content to anchor to. This is not `OVERCLAIM` (the
  claims don't say more than their fragments) and not `CITATION_MISS` (the citations are real) —
  it is a **missing "is this query specific enough to answer at all" check**, distinct from
  "is there enough evidence." Worth carrying into the next prompt iteration as a named gap.

## `answer confidence != evidence authority` — explicitly checked

No case in this battery showed the model presenting a weak or single-fragment hit with unwarranted
confidence beyond what the fragment states. The two `FALSE_REFUSAL` cases show the opposite
failure mode — the model erring toward caution rather than overclaiming — which is the safer
direction for a legal-domain tool to fail in, but is still a real usability cost worth measuring
and now measured.

## Operational note

The first run of the 40-query battery aborted mid-way (at query `C10`) when Gemini returned
non-JSON output once despite the structured `responseSchema` — `GeminiAnswerModelProvider`
correctly failed closed (`ANSWER_MODEL_INVALID_JSON`), but the battery script itself had no
per-query error boundary and let that exception kill the whole run. Fixed by wrapping the
`composeLegalAnswer` call per query in a try/catch that records a `MODEL_ERROR` row and continues
— a fail-closed model error is itself a valid, real observation for a battery script, not a reason
to abort measuring the other 39 queries. The retry completed with zero `MODEL_ERROR` rows; this
transient failure mode is now visible in the script's own structure for any future run.

Also observed, not investigated further here: `H21`'s multi-source query ("Vad gäller enligt både
miljöprövningsförordningen och miljöbalken...") returned `ANSWERED` in this run, whereas the exact
same query text returned `INSUFFICIENT_EVIDENCE` in `LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01`'s
battery run days earlier. `temperature: 0` reduces but does not guarantee full determinism from
Gemini across separate calls/sessions — worth keeping in mind for proof 10 (replay determinism),
which remains proven at the unit level with fake, genuinely deterministic model stubs; the live
model itself is not claimed to be bit-for-bit deterministic across arbitrary time gaps.

## What this does not claim

- No tuning happened as a result of this baseline — it is now frozen, exactly as instructed.
- No larger battery, no second independent holdout for the ANSWER layer specifically — 40 is well
  above the requested 30 minimum but this remains one bounded run, not a statistically powered
  evaluation.
- The `RETRIEVAL_MISS` cases identified here reflect this baseline's inherited ground-truth scope
  definitions, not a re-litigation of the frozen `LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01`
  retrieval strategy — no change to retrieval was made or is being proposed here.

## Data-driven recommendation for the next unit

Per the owner's own framing — retrieval, context assembly, answer prompt/model, citation
selection, or source/family routing — this baseline's evidence points specifically at **the answer
prompt**: citation selection, context assembly, and provenance integrity all measured at 0 defects
across 40 real queries, while the two real quality problems found (`FALSE_REFUSAL` on
synthesis-style questions; `X5`'s non-responsive answer to an underspecified query) are both
prompt-level calibration issues, not retrieval or citation-contract issues. Not started here —
awaiting explicit authorization, per this track's established pattern.
