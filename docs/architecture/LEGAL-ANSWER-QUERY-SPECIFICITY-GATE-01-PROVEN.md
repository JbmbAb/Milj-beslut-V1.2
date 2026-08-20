# LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01 — PROVEN

**Status:** PROVEN. Closes the contract gap `LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01` surfaced:
the system can have real, on-topic evidence and still be looking at a question too underspecified
to produce a useful answer from. `"Vad gäller?"` was answered in that baseline with two
technically-real but practically non-responsive citations, rather than being recognized as a
question with no content to anchor to.

## What this is, precisely

A new mode, `QUERY_UNDERSPECIFIED`, decided **before retrieval runs at all** — distinct from
`INSUFFICIENT_EVIDENCE`, which is decided *after* real retrieval based on what evidence was
actually found. A well-specified query can still end in `INSUFFICIENT_EVIDENCE` (nothing relevant
exists); `QUERY_UNDERSPECIFIED` means the question itself never carried enough content to search
for in the first place.

The gate is a small, purely lexical, deterministic, versioned check on the query string alone —
`evaluateQuerySpecificity()` in the new `packages/mps-legal-answer-contract/src/QuerySpecificityGate.ts`.
It deliberately does none of:

- infer subject, legal area, or source from the query
- consult retrieval results, context, or any DB state
- use an LLM call of any kind

It tokenizes the query, strips a small closed set of common Swedish function/question words
(`vad`, `är`, `det`, `gäller`, `för`, ...; never extended with domain or legal-source vocabulary —
that would smuggle topic inference back in), and checks whether at least one content-bearing term
(≥3 characters, not a stopword) remains. Zero content words → `UNDERSPECIFIED`. This is the entire
claim the gate makes; it is not a query-quality classifier.

## What was built

- **`packages/mps-legal-answer-contract/src/QuerySpecificityGate.ts`** — `evaluateQuerySpecificity()`,
  `QUERY_SPECIFICITY_GATE_VERSION = "query-specificity-gate-v1"`, `QuerySpecificityResult` (verdict,
  `content_word_count`, `reason`). 10 unit tests, all passing — including the exact demonstrated
  gap (`"Vad gäller?"` → `UNDERSPECIFIED`), single-content-word queries (→ `SPECIFIED`, no minimum
  count beyond one), empty/whitespace input, case/punctuation invariance, and determinism.
- **`AnswerTrace.ts`** — `LegalAnswerMode` extended with `"QUERY_UNDERSPECIFIED"` (additive).
- **`LegalRetrievalComposition.ts`** — `hashQuery()` exported (was private) so the answer layer can
  compute the same `query_run_identity` even when no retrieval run happens.
- **`LegalAnswerComposition.ts`** — `composeLegalAnswer()` now calls the gate FIRST, before
  `performLegalRetrieval()`. On `UNDERSPECIFIED`, returns immediately with `retrieval: null`,
  `context: null`, `claims: []`, and a real `AnswerTraceArtifact` (mode=`QUERY_UNDERSPECIFIED`,
  `query_run_identity` = `hashQuery(request.query)` — still fully auditable even though no
  retrieval happened). `LegalAnswerOutcome.retrieval` is now `LegalRetrievalOutcome | null`
  (null only for this one mode); `querySpecificity: QuerySpecificityResult` was added to the
  outcome so every response, gated or not, carries the gate's own verdict.
- **3 new unit tests** in `tests/unit/server.modules.legal.answer.LegalAnswerComposition.test.ts`:
  an underspecified query never reaches `searchChunks` or the answer model (spied, asserted
  uncalled); a well-specified query proceeds through retrieval unaffected; the answer trace still
  binds a real `query_run_identity` with zero retrieval. The file's existing tests used the
  placeholder query `'q'` (a single character, correctly caught by the new gate) — updated to
  realistic placeholder text (`'legal query text'`), since a single letter was never a meaningful
  fixture for what those tests actually exercise.
- **Two prior battery scripts** (`legal-retrieval-answer-quality-baseline-01.ts`,
  `legal-retrieval-rag-answer-composition-01.ts`) had their `outcome.retrieval.results` accesses
  null-guarded (`outcome.retrieval?.results ?? []`) so a future rerun over a now-gated query
  degrades cleanly instead of throwing — a type-safety fix only, no change to either script's
  already-reported, frozen findings.

## Real end-to-end proof (`scripts/db/legal-answer-query-specificity-gate-01.ts`)

Run live against the real composed chain (real Gemini, real corpus):

| Proof | Result |
|---|---|
| 1. `"Vad gäller?"` (the exact `X5` case from the frozen 40-query baseline) → `QUERY_UNDERSPECIFIED`, `retrieval: null`, zero claims, near-instant (0ms — no embedding/DB call happened) | PROVEN |
| 2. Three previously-`ANSWERED` real queries (L1, S3, C6) are entirely unaffected — `querySpecificity: SPECIFIED`, retrieval and answers unchanged | PROVEN |

## What this does not claim

- This gate does not detect every underspecified or low-quality query — only the specific,
  demonstrated failure mode (zero content-bearing terms). A query with real words that is still
  vague in *meaning* (not addressed here) is out of scope; expanding this heuristic would itself
  need its own proof, not be assumed to follow from this unit.
- No retrieval, context assembly, or citation-contract change — untouched, per instruction.
- The 40-query frozen baseline and the holdout set from `LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01`
  were **not** rerun in this unit — that is explicitly the owner's step 3, after
  `LEGAL-ANSWER-PROMPT-CALIBRATION-01` (step 2), not before.

## Next

Per the owner's explicit ordering:

```
1. LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01        <- this unit, done
2. LEGAL-ANSWER-PROMPT-CALIBRATION-01             <- next
3. frozen 40-query baseline + independent holdout rerun
4. answer-quality baseline V2
5. only then decide on next RAG product layer/UI
```
