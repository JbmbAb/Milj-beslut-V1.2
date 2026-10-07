# W-NO-GOOGLE-02-RUNTIME-CUT-CLOSURE-01

**Status: EXECUTION_VERIFIED / CLOSURE_READY.**

This record closes the combined **runtime cut** only. It does not assign PROVEN, does not claim a green whole-repository suite, and does not claim that every Google-named dependency, historical reference, tool or package has been removed from the repository.

| Field | Value |
| --- | --- |
| Unit | `W-NO-GOOGLE-02-RUNTIME-CUT` |
| 02A source | `ef51fc47cd4cbc9d4e346b5fc73efde92e1dcdb7` |
| 02B source | `f6ef984d79c26ebba81bd1e0055801ddd98f3d56` |
| Combined merge | `4e43c0e00de1340528d26a8020b735d116d11ba6` |
| F1 fix / accepted implementation HEAD | `310d0a81e0c294fcaa66f98dc547d2e9bb3816a6` |
| Accepted implementation tree | `d3984b9c1b9fc577c881a8de2ee638b5dff83085` |
| Independent combined-tree review at merge | `REVIEW_BLOCKED` only by F1 |
| Independent F1 reverify | `ACCEPT` at `310d0a81` |
| Critical reverify | 4 files, 61 / 61 PASS, 0 failed |
| Push | NO |

## 1. Closure boundary

This closure means:

- **W-NO-GOOGLE-02 runtime cut:** `EXECUTION_VERIFIED / CLOSURE_READY`
- **Active Google/Gemini/Vertex runtime path on the combined legal embedding + generation surface:** CLOSED
- **Global dependency cleanup:** OPEN / NON_BLOCKING_FOR_RUNTIME_CUT

The closure is deliberately narrower than a repository-wide claim of “no Google anywhere”.

## 2. Merge integrity

The accepted implementation is based on the two-parent merge `4e43c0e0`.

- `ef51fc47` is an ancestor.
- `f6ef984d` is an ancestor.
- The computed merge tree equals the committed combined merge tree.
- Integration-only delta at the merge was **NONE**.
- The only post-merge implementation-adjacent change is F1 at `310d0a81`, limited to the LU error-code review inventory and its pin.

No embedding, generation, Prisma, migration, source-runtime or guard implementation was changed by F1.

## 3. Embedding side

The accepted combined runtime preserves the 02A production binding:

- model: `BAAI/bge-m3`
- revision: `5617a9f61b028005a4858fdac845db406aefb181`
- pipeline: `local-st-bge-m3-dense-v1`
- dimension: 1024
- dtype: float32
- max sequence length: 8192
- no production model default
- e5, Qwen and Jina are not production-admitted
- no Gemini embedding production path remains

The model-selection decision remains `MULTIPLE_DENSE_MODELS_VIABLE_NO_CLEAR_WINNER`; bge-m3 is the owner-selected production pipeline on operational grounds, not an eval winner.

## 4. Generation side

The accepted combined runtime preserves the 02B generation cut:

- `AnswerModelProvider` routes through `LocalGenerationPort`.
- Gemini and Vertex generation providers are not active production paths.
- There is no Google fallback.
- No production caller registers a local generation runtime.
- Production generation therefore fails closed with `BLOCKED_BY_LOCAL_GENERATION_RUNTIME`.

`registerLocalGenerationRuntime` is called only by tests in this tree. The absence of a production local-generation runtime is intentional for this unit and does not reopen Google.

## 5. Zero-Google runtime guard

`tests/unit/noGoogleRuntimeGuard.test.ts` passes with **0 active runtime hits**.

The guard was not weakened and no allowlist was introduced for this closure.

The combined review also found no active imports of the retired Google embedding/generation SDKs on the governed runtime surface.

## 6. F1 closure

The combined review found one target-relevant blocker:

- `BLOCKED_BY_LOCAL_GENERATION_RUNTIME`
- `LOCAL_GENERATION_UNAVAILABLE`

Both were missing from the permanent LU error-code review inventory.

Commit `310d0a81` adds exactly those two reviewed entries as `OUTSIDE_LU_REACH` and updates the pinned inventory identity from the actual computed digest. No UI text or runtime code was changed.

Independent reverify of `310d0a81`:

- worktree clean
- `git diff --check`: PASS
- only the two LU inventory test files changed
- 4 critical test files: **61 / 61 PASS, 0 failed**
- result: **ACCEPT**

F1 is therefore **CLOSED**.

## 7. Other red tests

The wider focused union is not a green whole-repository suite. The remaining reported reds are classified as follows.

### raceConditions — PRE_EXISTING_RED / NO_TARGET_DELTA

Three failures concern the retired/disabled `embedText` behavior. The same 3 failures were reproduced independently on:

- 02A closure head `ef51fc47`
- 02B head `f6ef984d`
- accepted combined tree

They are not introduced by the combination or F1.

### searchService — PRE_EXISTING_RED / NO_TARGET_DELTA

Five failures still expect retired Google-era embedding/OCR behavior, including expectations for `text-embedding-004`, `gemini-embedding-001`, semantic embedding availability and `runGeminiOcr`.

The same 5 failures were reproduced independently on:

- 02A closure head `ef51fc47`
- 02B head `f6ef984d`
- accepted combined tree

They are not introduced by the combination or F1. Their future disposition is a separate test-retirement/repair unit.

### protectedRelationGateInventory B5 — WORKTREE_ARTIFACT

The B5 failure is exactly:

`.git: file type .git has no decision`

A linked Git worktree uses a root `.git` **file** rather than the normal repository `.git` directory. That filesystem metadata is not a tracked target delta and is unrelated to W-NO-GOOGLE-02 runtime semantics.

These three red families therefore do not block this runtime-cut closure.

## 8. Schema and migration boundary

The 02A migration remains unchanged on the combined tree:

`prisma/migrations/20261007120000_legal_corpus_chunk_embedding_local_v1/`

The combined tree preserves:

- local embedding storage at `vector(1024)`
- the single bge-m3 admitted triple CHECK
- the legacy `vector(3072)` path untouched as legacy state

**Migration governance approval: NOT_PERFORMED.**

No shared/live database migration is authorized or claimed by this record.

## 9. Remaining Google-related dependencies

The root `package.json` still contains Google-related dependencies, including:

- `@google-cloud/vertexai`
- `@google/genai`
- `@google/generative-ai`
- `google-auth-library`

The combined review found no active runtime imports of these on the W-NO-GOOGLE-02 governed runtime surface.

Status:

**DEPENDENCY CLEANUP: OPEN / NON_BLOCKING_FOR_RUNTIME_CUT.**

This record does not claim `GLOBAL_DEPENDENCY_ZERO`.

## 10. Explicit non-claims

This closure does **not** claim:

- PROVEN
- a green whole-repository suite
- all Google-related dependencies removed
- all historical Google names removed
- local generation runtime deployed or registered
- generation model selected or bound
- migration governance approval
- migration applied to any shared/live database
- embedding worker production deployment
- re-embedding completed
- U51 frozen
- U51 execution verified
- autonomous Loke beta
- full Mimer completion

## 11. Final status

```text
W-NO-GOOGLE-02-RUNTIME-CUT
EXECUTION_VERIFIED / CLOSURE_READY

ACTIVE GOOGLE RUNTIME PATH
CLOSED

F1
CLOSED

GLOBAL DEPENDENCY CLEANUP
OPEN / NON_BLOCKING_FOR_RUNTIME_CUT

LOCAL GENERATION RUNTIME
NOT_REGISTERED

PRODUCTION GENERATION
FAIL_CLOSED

BLOCKER
BLOCKED_BY_LOCAL_GENERATION_RUNTIME

MIGRATION GOVERNANCE APPROVAL
NOT_PERFORMED

PROVEN
NO
```

The next unit is not another 02A/02B replacement round. The remaining product decision is the local-generation runtime binding (or an explicit governed absence policy) before U51 can claim an actual local generation path.
