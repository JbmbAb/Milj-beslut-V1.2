# LEGAL-RETRIEVAL-QUARANTINE-RECON-01

**Status:** `CLOSED / ESTABLISHED / READ-ONLY`. Investigates why `packages/mps-retrieval-governance`
and `packages/mps-retrieval-trace` were quarantined, whether they are safe to build the new
governed retrieval contract on top of, and classifies each component. No revival decision is made
here — this is evidence for that decision, not the decision itself.

## Why they were quarantined

`docs/architecture/LEGACY-CLASSIFICATION-2026-08-11.md:37,91`: *"Samma mönster: noll konsumenter,
men täckt av `compliance`-projektets `test.include` — belastar proof-baseline utan
produktionsberoende."* Confirmed independently: the only importer of either package anywhere in
the repo is `packages/mps-query-budget`, itself also unwired to any production path. No
`server/`, `scripts/`, or app code imports either package.

**Root cause: missing consumer only** — the documented reason is purely "zero consumers, costs
proof-budget in the compliance suite," not an architectural defect, stale identity model, or
replay defect. Both packages were introduced together (commits `6272220`, `f6b40f8`, `8e16d4f`,
Aug 7–8 2026) and never touched since.

**One undocumented defect found that the classification doc missed:** `mps-retrieval-trace`
ships a KNOWN_BROKEN dead code path — see below.

## Test status

`npx vitest run packages/mps-retrieval-governance/ packages/mps-retrieval-trace/`: **6 files, 15
tests, all pass.** But this is misleading — see below.

## `RetrievalPolicy.ts` (mps-retrieval-governance)

`RETRIEVAL_POLICY_VERSION = "ret-policy-1"`. Invariants:

- **I01**: initial artifact resolved must be `DecisionImpactArtifact` — enforced, tested.
- **I02**: artifact-class isolation via allow/optional/forbidden lists across 4 query types
  (`GENERAL`, `DECISION_SUMMARY`, `EVIDENCE_EXPANSION`, `PROVENANCE_AUDIT`) × 5 artifact classes
  — enforced, tested.
- **I03**: retrieval is read-only, cannot create authority — enforced (`assertRetrievalReadOnly`),
  tested.
- **I04** "Retrieval Projection Boundary", **I06** "Policy Identity" — declared as constants only,
  **no assertion function, no test, unenforced.**
- **I05** "Raw Chunk Non-Authority" — same, unenforced stub.

`read_only: true` is a pure gate/decision function — `buildRetrievalPolicy`/`evaluateRetrieval`
return frozen plain objects, no persistence, no CAS write, no side effects.

## `mps-retrieval-trace` — two conflicting artifact definitions

- `RetrievalExecutionTrace.ts` — the version actually exported via `index.ts`:
  `{trace_hash, contract_version, identity: {query_hash, policy_version, artifact_snapshot,
  selected_artifact_refs: readonly string[], budget_profile, expansion_path}, metadata}`. Tested,
  passes, including a determinism test proving `trace_hash` is stable under `selected_artifact_refs`
  reordering.
- `RetrievalExecutionTraceArtifact.ts` — **NOT exported by `index.ts`, dead.** Imports
  `ArtifactReference` from `../../mps-retrieval-governance/src/ArtifactReader`, **a file that does
  not exist anywhere in the repo.** `RetrievalTraceBuilder.ts` has the same broken import and is
  also unexported/unused. Both only "pass" tests because esbuild elides unused type-only imports
  at transform time — a real `tsc --noEmit` would fail on this package today. Vitest green here is
  not proof of compile-health.

**Identity-fit**: `selected_artifact_refs`/`artifact_snapshot_ref` are opaque strings (or a
nonexistent type in the dead branch) with zero schema binding to any specific identity shape. They
do not reference `fragmentId`/`materializationId` (new governed corpus) or `legal_corpus_chunks`
(old table) — generic enough to hold either, but all binding/validation logic would need to be
written from scratch regardless of reuse.

## Embedding-model-identity coverage

**None in either package.** Zero references to embedding model id, embedding pipeline version, or
vector index identity anywhere. An embedding-identity contract must be designed from scratch
regardless of the reuse decision — this was never in scope for either package.

## Dependencies / coupling

`mps-retrieval-governance` depends only on `mps-materialization` (for the authority-boundary
check) — zero references to `LegalCorpusChunk`/`legal_corpus_chunks` (old or new). `mps-retrieval-
trace` depends on `mps-retrieval-governance` + `mps-query-budget`, plus the broken import above.
Neither package is coupled to any chunk table, old or new — safe to bind to a new identity shape
without touching the live-tested code paths, but the two dead files need deletion or repair first.

## Replay/idempotency and citation propagation

- **Replay/idempotency**: partial. Only hash-determinism is proven (`trace_hash` stable under
  reordering) — there is no replay/re-execution engine, no idempotency key, no run-and-compare
  logic in either package.
- **Citation/source-ref propagation to an answer**: **none.** Zero functional references to
  citation, source_ref, or answer generation in either package.

## Classification

| Component | Classification | Why |
|---|---|---|
| `RetrievalPolicy.ts` | `REUSABLE_WITH_MIGRATION` | Sound, tested, generic (string-typed); I04/I06 are unenforced stubs and it has zero chunk/embedding-identity binding to add. |
| `mps-retrieval-governance` (package) | `REUSABLE_WITH_MIGRATION` | Zero consumers today but internally consistent and free of stale-identity coupling — safe to wire in after adding real chunk/embedding binding. |
| `RetrievalExecutionTraceArtifact.ts` | `KNOWN_BROKEN` | Imports a nonexistent module; not exported; dead, uncompilable code. |
| `RetrievalTraceBuilder.ts` | `KNOWN_BROKEN` | Same broken import; unexported, unused by any test. |
| `mps-retrieval-trace` (package) | `NOT_PROVEN` | The exported surface (`RetrievalExecutionTrace.ts`) is tested and passes, but the package ships broken dead files vitest's transform silently hides — true compile-health unverified until `tsc --noEmit` runs clean and dead code is removed. |

## Conflict check against LEGAL-CORPUS-V1-TEXT-STRUCTURE-BASELINE-V2

**No direct conflict.** Neither package references `fragmentId`, `materializationId`,
`contentHash`, `chunkPolicyVersion`, or either chunk table (old or new) at all — confirmed by
grep, zero hits. They are identity-agnostic, not contradictory: none of the frozen baseline's
rules (content-derived `fragment_id`, immutable/append-only materializations, identity-bearing
`chunk_policy_version`) are honored, checked, or referenced by these packages today. Reuse must
add that binding as new code — it is not already respected and must not be assumed to be.

## What this recon does not decide

Whether to actually revive `mps-retrieval-governance` as the policy foundation, whether to repair
or delete the two `KNOWN_BROKEN` trace files, and the shape of the new embedding-identity contract
(which has no precedent in either package) are all separate decisions, not made here.
