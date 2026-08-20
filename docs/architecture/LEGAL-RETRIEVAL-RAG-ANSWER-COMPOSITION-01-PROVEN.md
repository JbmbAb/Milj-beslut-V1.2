# LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 — PROVEN

**Status:** PROVEN. The first answer/citation layer over the governed retrieval chain:

```
authenticated request
  -> performLegalRetrieval()          (LEGAL-RETRIEVAL-PRODUCTION-COMPOSITION-01, unchanged)
  -> RetrievalResult[]
  -> bounded context assembly          (LegalAnswerContextV1, mps-legal-answer-contract)
  -> answer model                      (Gemini API-key, structured JSON output)
  -> claims -> citation validation     (buildCitation, mps-legal-answer-contract)
  -> AnswerTraceArtifact
```

The governing invariant, enforced structurally rather than by convention:

```
AN ANSWER MAY CITE ONLY A GOVERNED RetrievalResult RETURNED BY THE CURRENT RETRIEVAL RUN.
```

No HTTP route was added in this unit — this is the composition layer only, per the owner's
explicit roadmap (`NOW -> RAG answer composition`, `THEN -> bounded quality baseline`,
`THEN -> source-constraint permission hardening + production RAG endpoint/UI`). No free RAG chat,
no larger UI.

## What was built

### `packages/mps-legal-answer-contract` (new package)

Mirrors the shape of `mps-legal-retrieval-contract`: a small, focused contract package that turns
one invariant into an executable check, not a naming convention.

- **`LegalAnswerContext.ts`** — `buildLegalAnswerContext()`. Pure and deterministic: takes exactly
  the `RetrievalResultFields[]` one governed retrieval run produced (paired with each chunk's real
  text), and narrows to a bounded subset for the answer model's prompt. It can never expand: there
  is no code path in this function that reaches outside its own `items` parameter.
  - drops any result with zero `source_provenance_refs` (not admissible for citation — a second,
    independent gate on top of `buildRetrievalResult`'s own enforcement)
  - deduplicates near-duplicate text via `embedding_identity.chunk_content_hash`, keeping only the
    first (highest-ranked) occurrence
  - stops admitting once `max_results` or `max_total_chars` (policy, versioned) is reached
  - records `selection_order`, `excluded_as_duplicate`, `excluded_by_budget`,
    `excluded_missing_provenance` — a full, auditable trail of what was left out and why
  - rejects a mixed-query-run input outright (`QUERY_RUN_IDENTITY_MISMATCH`) — one context can
    never blend two retrieval runs
- **`Citation.ts`** — `buildCitation()`. Binds one model-claimed `{fragment_id, materialization_id}`
  to the ONE context entry it must exactly match. `citation_id` is a stable hash of already-verified
  refs (`fragment_id`, `materialization_id`, `source_provenance_refs`, `rank`, `score`,
  `query_run_identity`) — explicitly **not** a new authority identity, only a representation of
  what the context already carries. Fails closed at every step:
  `CITATION_OUTSIDE_RETRIEVAL_SET` (fragment not in context), `CITATION_MATERIALIZATION_MISMATCH`
  (right fragment, wrong materialization claimed), `MISSING_PROVENANCE` (defensive re-check).
- **`AnswerTrace.ts`** — `buildAnswerTrace()`. Binds `query_run_identity` + the fragments that
  actually survived citation validation + `answer_model_id`/`answer_model_version`/
  `answer_pipeline_version` + `context_policy_version` + `mode` (`ANSWERED` |
  `INSUFFICIENT_EVIDENCE`) into one hashed, versioned artifact. Deliberately distinct from
  `RetrievalExecutionTrace` (`mps-retrieval-trace`) — that already binds the retrieval run itself;
  this binds the layer above it.
- 19 unit tests, all passing (`packages/mps-legal-answer-contract/tests/`).

### `server/modules/legal/answer/`

- **`GeminiAnswerModelProvider.ts`** — real, `GEMINI_API_KEY`-backed answer model
  (`gemini-2.5-flash`), same call mechanism as `GeminiEmbeddingProvider.ts` (Vertex ADC stays
  excluded — proven broken in this environment during `LEGAL-RETRIEVAL-BOUNDED-PILOT-01`). Asks for
  **structured JSON** (`responseSchema`, not free text parsed by regex): `{insufficient_evidence,
  claims: [{text, cited_fragments: [{fragment_id, materialization_id}]}]}`. The prompt explicitly
  instructs the model to answer only from the attached passages, never invent identifiers, and set
  `insufficient_evidence=true` rather than force an answer when the passages don't support one.
  This provider does no citation validation itself — that is deliberately not its job; it only
  proposes claims. Fails closed on empty response, invalid JSON, or a schema mismatch.
- **`LegalAnswerComposition.ts`** — `composeLegalAnswer()`, the real composed function. Calls
  `performLegalRetrieval()` unchanged, resolves each result's real chunk text (fails closed:
  unresolvable text is excluded before context assembly, never fabricated), builds the bounded
  context, calls the answer model, and validates every claimed citation via `buildCitation()`. A
  citation that fails validation is dropped, never surfaced; a claim left with zero surviving
  citations is dropped **entirely** — an evidence-bound answer never carries an unsupported claim.
  `createLegalAnswerComposition()` wires the real Prisma-backed chunk-text lookup and the real
  Gemini answer model.

### Tests

- **`tests/unit/server.modules.legal.answer.LegalAnswerComposition.test.ts`** — 10 fake-backed
  unit tests, each mapped directly to one of the 10 required proofs below, plus 2 extra covering
  "model itself reports insufficient evidence" and "mixed valid/invalid citations in one claim
  keep only the valid ones." All 12 passing.

## Required proofs

| # | Proof | Result |
|---|---|---|
| 1 | Valid retrieval results -> answer generated | PROVEN (unit + live battery, 7/10 battery cases `ANSWERED`) |
| 2 | Citation references a returned fragment -> ACCEPT | PROVEN |
| 3 | Model attempts citation outside the retrieval set -> reject/drop | PROVEN — claim dropped entirely once its only citation fails |
| 4 | Nonexistent fragment_id -> fail closed | PROVEN — `CITATION_OUTSIDE_RETRIEVAL_SET`, dropped |
| 5 | Materialization mismatch -> fail closed | PROVEN — right fragment, wrong claimed materialization, rejected |
| 6 | Provenance missing -> not admissible for citation | PROVEN at the contract layer (`buildLegalAnswerContext` excludes zero-provenance results); structurally unreachable at the composition layer since `buildRetrievalResult` already guarantees non-empty provenance upstream — the second gate exists anyway, in depth |
| 7 | Context assembler cannot expand beyond the RetrievalResult set | PROVEN — unit-level (selected ⊆ input) and live (every citation across all 10 real battery queries independently re-verified to be within that query's own retrieval set) |
| 8 | Answer trace binds query_run_identity + selected fragments + model identity | PROVEN |
| 9 | Zero retrieval results -> explicit INSUFFICIENT_EVIDENCE, no fabricated answer, model never called | PROVEN |
| 10 | Identical retrieval state -> same cited evidence set under deterministic context policy | PROVEN (unit-level replay; the live battery is not repeated for cost/determinism-of-LLM-text reasons, but citation *sets* were stable across repeated fake-backed replays) |

**Answer confidence != evidence authority** was checked explicitly too: a claim mixing one valid
and one invalid citation keeps only the valid citation, never the whole set — the model cannot
smuggle a fabricated reference through by attaching it to an otherwise-real claim.

## Real end-to-end proof: bounded battery, 10 queries, real corpus + real Gemini

`scripts/db/legal-retrieval-rag-answer-composition-01.ts` — reuses exact queries already verified
against real DB content in `LEGAL-RETRIEVAL-QUALITY-BASELINE-01` / `-PRODUCTION-COMPOSITION-01`,
never a hand-picked new set. Categories: law (single-source x2), law (multi-source), law
(ambiguous_by_design), court (topic + case-number), standard (x2), zero/weak evidence (x2).

**Live structural proofs, independent of the composition's own internal enforcement** (mirrors the
independent-DB-re-check pattern from `LEGAL-RETRIEVAL-SERVING-BOUNDARY-01` proof 4):

- Every citation across the whole battery resolves to a real governed chunk row: **true**
- Every citation across the whole battery is within its own query's retrieval set: **true**

**Per-case review** (factual support / citation correctness / unsupported claims / omission /
trace completeness — reviewed by hand, not auto-graded):

| Case | Mode | Notes |
|---|---|---|
| L1 (miljöbalkens mål) | ANSWERED | 7 claims, all citing the same single chapter-1 fragment. Faithful paraphrase of the fragment's content; no unsupported claims observed. |
| L4 (avfallshantering) | ANSWERED | 3 claims across 3 distinct fragments. One claim cites "10 § i Lag (2026:507)" — a real statute number in this corpus's dataset, correctly resolved and cited; worth noting only because it reads unusually to a human reviewer expecting "miljöbalken" by name. |
| Multi-source law (djurhållning, both statutes) | **INSUFFICIENT_EVIDENCE** | Retrieval returned 6 results and context admitted 3, but the model judged none of them actually answered the compound "both statutes together" question and correctly declined rather than force an answer from adjacent-but-insufficient passages. This is the `INSUFFICIENT_EVIDENCE` mode working as designed under **nonzero, noisy retrieval** — the more meaningful case than the trivial zero-result path. |
| L3 ambiguous_by_design (9 kap.) | ANSWERED | 1 claim, correctly scoped to what the single cited fragment actually supports; did not overreach into naming which of the two candidate statutes applies (consistent with the frozen router's own `ambiguous_by_design` behavior — no fabricated disambiguation at either layer). |
| C1 (deponi Stockholm, topic) | ANSWERED | 6 claims across 3 distinct materializations, several citing 2 fragments each. Content matches a real court reasoning narrative (siting, groundwater, PFAS, deposit duration) with fragment-level grounding. |
| C6 (mål M 307-24, citation lookup) | ANSWERED | 9 claims, correctly identifies court, date, case parties, and prior instance from the cited fragment — a strong case-number lookup result. |
| S3 (brunnsborrning) | ANSWERED | 4 claims citing Normbrunn-16 guidance fragments; faithful to source content. |
| S1 (små avlopp, HVMFS 2016:17) | ANSWERED | 4 claims, correctly identifies the regulation number, effective date, and enabling provision (3 kap. 5 § miljötillsynsförordningen). |
| Zero-evidence (meatball recipe) | **INSUFFICIENT_EVIDENCE** | Correct — an entirely out-of-corpus query, vector search still returned 6 (semantically distant) hits, model correctly recognized none were relevant and refused rather than fabricate. |
| Zero-evidence (inkomstskattelagen) | **INSUFFICIENT_EVIDENCE** | Correct — a domain-adjacent but genuinely uncovered statute (tax law); model declined despite plausible-looking retrieved passages, rather than overreach. |

No factually unsupported claim, no citation to a fragment the passage didn't actually contain, and
no case where the model was forced into a confident-sounding fabrication under weak evidence was
observed in this battery. This is a 10-query bounded review, not a statistically powered
evaluation — a larger, frozen golden battery (with hand-verified expected claims, analogous to
`LEGAL-RETRIEVAL-QUALITY-BASELINE-01`) is the natural next step if answer-layer quality tuning is
ever prioritized, but was explicitly out of scope for this composition unit.

## What this does not claim

- No HTTP endpoint over this chain — explicitly the next unit, after a bounded answer/citation
  quality baseline per the owner's stated ordering.
- No larger battery, no automated semantic grading of claim correctness — this unit's battery is a
  bounded, hand-reviewed sanity check, not the frozen quality baseline the owner asked for next.
- No hybrid retrieval, reranker, or query rewriting anywhere in this chain — unchanged from every
  prior unit in this track.
- `LEGAL-RETRIEVAL-SOURCE-CONSTRAINT-AUTHORITY-01` (the `ADMIN`-only gate on
  `allowed_source_constraints` becoming a real permission) remains registered as a known,
  non-blocking future hardening item, unchanged from `LEGAL-RETRIEVAL-SERVING-BOUNDARY-01`.

## Pre-existing, unrelated test failures observed during the regression run

Running the full `compliance` project surfaced 4 pre-existing failures in
`packages/mps-data-governance/tests/GovernedWriteCapability.test.ts` (an unauthorised-holder /
audit-drift finding unrelated to legal retrieval) and
`packages/mps-retrieval-trace/tests/PackageTypecheck.test.ts` (a `tsc` invocation exceeding its
5000ms test timeout). Neither file was touched by this unit; both predate it. Left as-is —
out of scope here, flagged for separate attention.

## Next

Per the owner's explicit ordering:

```
THEN -> bounded answer/citation quality baseline (a larger, frozen golden battery for the answer
         layer specifically, analogous to LEGAL-RETRIEVAL-QUALITY-BASELINE-01)
THEN -> LEGAL-RETRIEVAL-SOURCE-CONSTRAINT-AUTHORITY-01 (permission hardening)
THEN -> production RAG endpoint/UI
```

Not started here.
