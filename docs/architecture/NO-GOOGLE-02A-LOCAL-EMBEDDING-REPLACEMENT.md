# NO-GOOGLE-02A -- local embedding replacement (writer report)

Status: **WORKING / BLOCKED_BY_MODEL_SELECTION_AND_MIGRATION_APPROVAL** (owner ruling 2026-10-06; this supersedes the earlier
READY_FOR_INDEPENDENT_REVIEW label). Not verified, not proven. Written by the writer; no status above WORKING is claimed.
The writer's own read-only review (a three-lens defect hunt) is a SELF-review and is not independent verification.
See `NO-GOOGLE-02A-OWNER-DECISION-NOTE.md` for the two blockers. Base `621a28680c277e1e4f8a24483acf33be566e99e9`, branch
`rt/no-google-02a-local-embedding`. No push, no squash, no migration applied.

Scope: replace the active Google embedding surface `server/modules/legal/retrieval/GeminiEmbeddingProvider.ts`
with a fully local provider. Out of scope and untouched: 02B generation (`GeminiAnswerModelProvider.ts`,
`vertexAiService.ts`), Loke, the historical 3072 data, any model-selection decision.

## 1. Census (read-only, at the base)

**Callers of `GeminiEmbeddingProvider`** (all removed or rewired):
`server/modules/legal/retrieval/LegalRetrievalComposition.ts` (the production composition, used by
`server/routes/legalRetrieval.routes.ts` and `legalAnswer.routes.ts`), six scripts under `scripts/db/`
(bounded-pilot-01, its query-battery, bulk-embedding-01, law-metadata-holdout-01, law-metadata-routing-01,
quality-baseline-01), two unit tests (type import and fake provider), and a comment in `GeminiAnswerModelProvider.ts`
(02B file, left as is).

**Persistence and dimension.** Table `legal_corpus_chunk_embeddings` (`embedding_vector vector(3072)`, Prisma model
`LegalCorpusChunkEmbedding`). Its only writer was `LegalCorpusChunkEmbeddingPersistence.persistChunkEmbedding`, called only by
the pilot and bulk scripts. The search filtered by `embedding_model_id` + `embedding_pipeline_version`, but nothing in code
stopped a vector of another dimension from reaching the database (it would be rejected there, loudly, at the last step).
`3072` appears in code only in the retired provider (`EMBEDDING_DIMENSIONS`); no other consumer assumes it. Other embedding
code (`searchService.embedText`, used by RAG/evidence/orchestrator tools) returns `null` (random vectors only under
`USE_MOCK_AI`) and uses 768-dimensional columns: a different dimension space, not touched here.

**Identity.** `packages/mps-embedding-identity`, contract `embed-identity-1`: six fields, SHA-256 over them. It does **not**
bind the vector dimension. It is unchanged here.

**Historical Google values.** DB baseline per the design document: 31,706 rows `gemini-embedding-001`, 5 rows
`gemini-embedding-2`, all 3072-dimensional. They are historical input only.

**Runtime.** In the repository: no local model loader existed. Outside it (not part of this change): venv
`D:\mimer-eval\venv-embedding-2026-10-02` (Python 3.13.14, torch 2.6.0+cu124, transformers 5.17.0, sentence-transformers 6.1.0,
numpy 2.5.3) and HF cache `D:\mimer-eval\hf-cache` with both frozen candidates at pinned revisions (hashes verified by the
earlier eval tooling), RTX 4050 Laptop 6 GB. The production Docker image contains no Python and no torch.

**Guard (`tests/unit/noGoogleRuntimeGuard.test.ts`).** Hits at the base: 4. At this branch: 3.
Removed by 02A: `google-sdk-import server/modules/legal/retrieval/GeminiEmbeddingProvider.ts`.
Remaining (all 02B generation): `google-sdk-import server/modules/legal/answer/GeminiAnswerModelProvider.ts`,
`google-sdk-import server/services/vertexAiService.ts`, `googleapis-host server/services/vertexAiService.ts`.

## 2. What changed

| Part | File | Role |
|---|---|---|
| identity registry | `packages/mps-embedding-identity/src/LocalEmbeddingPipelines.ts` | closed frozen registry of the two admitted pipelines; `assertLocalEmbeddingIdentity` |
| provider contract | `server/modules/legal/retrieval/EmbeddingProvider.ts` | vendor-neutral, `embedQueries` / `embedPassages`, explicit `dimension` |
| provider | `.../LocalEmbeddingProvider.ts` | the only producer; verifies the runtime on every call |
| transport | `.../LocalEmbeddingWorkerTransport.ts` | stdio JSON lines, one child, allowlisted environment |
| worker | `.../localEmbeddingWorker.py` | offline, pinned snapshot, same load/encode path as the frozen A7 harness |
| persistence boundary | `.../LocalEmbeddingPersistence.ts` | refuses non-local identity / non-1024 vector before any SQL |
| migration PROPOSAL | `prisma/migrations/20261006220000_legal_corpus_chunk_embedding_local_v1/` + `schema.prisma` | new versioned 1024 table. **Not applied.** |
| composition | `LegalRetrievalComposition.ts` | local provider or throw; local table only; dimension guard before SQL |

Retired: `GeminiEmbeddingProvider.ts`; `LegalCorpusChunkEmbeddingPersistence.ts` (the only writer into the 3072 table, no caller left);
five scripts that existed only to run, write or measure the Google 3072 embeddings. `legal-retrieval-quality-baseline-01.ts` keeps only the
frozen assets other scripts import (`QUERIES`, `resolveAcceptableFragmentIds`, `classifyFailure`, `provenanceIntact`). The PROVEN
evidence documents of the retired scripts are unchanged.

## 3. The 3072 -> 1024 boundary

**Identity.** embed-identity-1 is unchanged (changing it would invalidate every existing identity). The boundary is a registry:
an identity is *local* iff its `(model_id, exact 40-hex HF revision, pipeline_version)` triple equals one registered pipeline and its
hash still matches the fields. Pipelines: `local-st-bge-m3-dense-v1` (BAAI/bge-m3 @ 5617a9f6...) and
`local-st-multilingual-e5-large-v1` (intfloat/multilingual-e5-large @ 3d7cfbda...). Every historical Google identity fails
`assertLocalEmbeddingIdentity` (`EMBEDDING_IDENTITY_NOT_LOCAL`). A revision bump is a new registered pipeline, never an edit.

**Persistence.** A separate table `legal_corpus_chunk_embeddings_local_v1`: `vector(1024) NOT NULL`, explicit `embedding_dimension`
with `CHECK = 1024`, a `CHECK` pinning the two admitted triples (same values as the TypeScript registry; a test compares them),
unique identity hash, the same composite FK to the governed chunks. Schema only: no data copied, the 3072 table is neither altered
nor read as local. The boundary is enforced in three layers: code (before SQL), statement (`::vector(1024)`, dimension written),
database (type + CHECKs). The read side asserts the query vector (`assertLocalQueryVector`) before any SQL.

**What this means in practice.** There are no 1024-dimensional rows yet, so the production composition returns no hits until a
re-embedding unit has run, which needs the migration approved first.

## 4. Fail-closed behaviour

No default model (`MIMER_LOCAL_EMBEDDING_MODEL` must name one of the two); no third candidate; no Google key is read or forwarded;
the runtime must prove repo, revision, pipeline, dimension, normalisation (and e5's fixed `max_seq_length` 512) on every call; vectors
must be exactly 1024 finite L2-normalised numbers (tolerance 1e-3; observed max deviation 4.9e-4 in fp16); a required device that did
not run is an error (no hidden CPU fallback); a runtime failure throws (no mock, no second provider); the configured runtime can
only be a Python interpreter (psql, cmd, bash, node refused), and the worker child gets an allowlisted environment, offline flags,
and no inherited credentials.

## 5. Evidence (writer-run; not verification)

- Test files added: identity registry (16), provider (39), transport (13), persistence + migration contract (21), composition (6), embedding-path guard (14).
  Two existing composition tests moved to the new provider contract.
- RED committed first (`2cc1a4fd`): five files failed to load (modules absent), the path guard was red on 9 of 14.
- Protected-write inventory (U30, default deny): green on a clean export of HEAD (1161/1161) with **no new reviewed entry**; the three channels it
  first flagged were removed by changing the code (plain-literal SQL, `spawn("python", [literal script])`), not by review entries.
  In a git worktree the `.git`-file B5 case is red at the base too (known harness gap; a clean export is the normative surface).
- Real runtime, end to end through provider + transport + worker: both candidates loaded from the pinned snapshots on `cuda:0` in float16
  (1024 dims, norms 1.0 +/- 5e-4, relevant passage ranked above an irrelevant one for both queries).
- Negative controls against the real worker: absent snapshot, other revision present but pinned absent, interpreter without the runtime,
  non-python program: all rejected with `EMBEDDING_LOCAL_RUNTIME_FAILED` / `EMBEDDING_PROVIDER_NOT_CONFIGURED`, no vector.
- Failures that exist at the base independently of this change: `noGoogleRuntimeGuard` (02B hits), `luBootstrapProofScriptsIsolation`
  (`prove-lu-deterministic-reexecution-01.ts`; identical failure on a clean export of the base).

## 6. Open items and honest limits

1. **Model selection is not made here and is a BLOCKER.** The corrected round 1 of the frozen A7 evaluation (2026-10-02) was NO-GO: neither candidate met the
   predeclared bars (MRR 0.22 / 0.32 against 0.885) on the demo-01 chunk-retrieval set. 02A only provides the mechanism for either frozen
   candidate; it does not activate retrieval quality claims.
2. **The migration is a proposal and a BLOCKER until approved.** It needs the Prisma-migration Dev-Gov unit and explicit owner approval before any apply.
3. **No local embeddings exist yet**; a re-embedding unit (separate, needs the migration) must populate the table.
4. **The runtime lives outside the repository and the production image** (no Python/torch there). Deployment of the worker runtime is open.
5. **Model files are pinned by revision directory**, not re-hashed at every start; the hash verification is the earlier eval tooling's.
6. 02B remains: `GeminiAnswerModelProvider.ts` (still has a comment naming the removed provider), `vertexAiService.ts`.
7. The answer route's import closure still contains the Gemini answer provider (02B); only the retrieval composition and route are proven Google-free here.
