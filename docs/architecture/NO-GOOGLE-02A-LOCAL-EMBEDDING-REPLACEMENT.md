# NO-GOOGLE-02A -- local embedding replacement (writer report)

Status: **WORKING / READY_FOR_INDEPENDENT_REVIEW** (updated 2026-10-07 after the owner selected BAAI/bge-m3; section 7 below). The
model-selection blocker of the 2026-10-06 ruling is resolved by that owner decision. Not verified, not proven; no status above WORKING is
claimed and the writer's own checks are not independent verification. The migration is committed in the real migration history but is **not
applied to any live or shared database** (only to a disposable container); promotion needs the Prisma-migration Dev-Gov unit and the owner.
History: `NO-GOOGLE-02A-OWNER-DECISION-NOTE.md`. Base `621a28680c277e1e4f8a24483acf33be566e99e9`, branch
`rt/no-google-02a-local-embedding`. No push, no squash.

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
| migration | `prisma/migrations/20261007120000_legal_corpus_chunk_embedding_local_v1/` + `schema.prisma` | new versioned 1024 table pinned to the ONE admitted pipeline. **Not applied to any live/shared database.** (Earlier two-triple proposal files removed.) |
| production admission | `.../LocalEmbeddingAdmission.ts` | exactly one admitted pipeline: bge-m3 (see section 7) |
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
with `CHECK = 1024`, a `CHECK` pinning the ONE admitted triple (bge-m3; updated 2026-10-07, earlier two triples; a test compares it with the admission module),
unique identity hash, the same composite FK to the governed chunks. Schema only: no data copied, the 3072 table is neither altered
nor read as local. The boundary is enforced in three layers: code (before SQL), statement (`::vector(1024)`, dimension written),
database (type + CHECKs). The read side asserts the query vector (`assertLocalQueryVector`) before any SQL.

**What this means in practice.** There are no 1024-dimensional rows yet, so the production composition returns no hits until a
re-embedding unit has run, which needs the migration approved first.

## 4. Fail-closed behaviour

No default model (`MIMER_LOCAL_EMBEDDING_MODEL` must name the one production-admitted model, bge-m3; the evaluation seam may name a frozen candidate); no third candidate; no Google key is read or forwarded;
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
- (Historical, 2026-10-06, superseded by section 6: the worker then ran float16; it now runs the evaluated float32.) Real runtime, end to end
  through provider + transport + worker: both candidates loaded from the pinned snapshots on `cuda:0` in float16
  (1024 dims, norms 1.0 +/- 5e-4, relevant passage ranked above an irrelevant one for both queries).
- Negative controls against the real worker: absent snapshot, other revision present but pinned absent, interpreter without the runtime,
  non-python program: all rejected with `EMBEDDING_LOCAL_RUNTIME_FAILED` / `EMBEDDING_PROVIDER_NOT_CONFIGURED`, no vector.
- Failures that exist at the base independently of this change: `noGoogleRuntimeGuard` (02B hits), `luBootstrapProofScriptsIsolation`
  (`prove-lu-deterministic-reexecution-01.ts`; identical failure on a clean export of the base).

## 6. Production binding for bge-m3 (owner decision 2026-10-07)

**Decision.** The frozen W-EMBED-MODEL-SELECTION-04 evaluation (87 product-representative questions, four candidates, all four met the frozen
viability floor, decision `MULTIPLE_DENSE_MODELS_VIABLE_NO_CLEAR_WINNER`) named no quality winner. The owner selected **BAAI/bge-m3 @
5617a9f61b028005a4858fdac845db406aefb181, 1024 dimensions** on operational grounds (no `trust_remote_code`, no truncation of the evaluated
corpus, ~52 ms query p50, ~2.3 GB VRAM, deterministic replay). multilingual-e5-large (and the two other evaluation candidates, Qwen3 and
Jina v3) remain evaluation candidates: not rejected, not production-admitted. Evaluation artefacts and hashes (outside the repo):
`D:\w-embed-eval-02\sel04\` (eval spec `6312c562...`, queries `1d38490d...`, gold `8fe00e1d...`, harness `66ed2807...`).

**What the code now guarantees.**
- *Admission:* `LocalEmbeddingAdmission.ts` admits exactly `bge-m3` (frozen list, module-load invariant: one key, registered). It is enforced on
  the production provider seam (`createLocalEmbeddingProviderFromEnv`: a non-admitted key fails with `EMBEDDING_MODEL_NOT_ALLOWED` before any
  transport exists), on the write side (`buildPersistLocalEmbeddingStatement` refuses a provider-issued e5 embedding) and on the read side
  (`assertLocalQueryVector`). The registry still lists e5 so the evaluation seam keeps working; that is not a production option.
- *Pipeline identity includes the evaluated numerics:* `dtype` `float32` and an explicit `max_seq_length` (bge-m3 8192, e5 512) are registry fields,
  mirrored in the worker's frozen registry (a test compares them). The worker no longer hard-codes float16 (the earlier fp16/fp32 difference to the
  evaluated pipeline is closed); the provider rejects a runtime that reports another dtype or maximum length.
- *Persistence:* the migration pins exactly one `(model, revision, pipeline)` triple in `lcel_v1_pipeline_binding_chk`; a test compares it with the
  admission module. The e5 triple, another revision, a Google identity, a mixed triple, a 3072/768-dimensional vector, a wrong dimension column, a
  NULL vector and a missing governed chunk are all rejected by the database.
- *No default and no fallback:* `MIMER_LOCAL_EMBEDDING_MODEL` is still required (no silent activation); the persisted vectors are fp32-derived.

**Schema defect repaired.** `prisma/schema.prisma` at the previous HEAD was invalid: a truncated comment had replaced the header lines of
`model LegalCorpusChunk {` (`prisma validate`: 20 errors, so `prisma generate` would fail). The header is restored and the new model
`LegalCorpusChunkEmbeddingLocalV1` (+ relation) is added; `prisma validate` is green.

**Evidence (writer-run; NOT verification).**
- RED first (`84bd3945`, 18 failing tests), GREEN (`fe157dad`).
- Disposable Postgres 16 + pgvector + PostGIS container (loopback-only port, tmpfs, removed afterwards): `prisma migrate deploy` applied the whole
  history including the new migration; `prisma migrate diff` shows **no drift** for the new table (the diff has pre-existing unrelated drift);
  the real insert text inserted a bge-m3 row, an identical replay returned 0 rows, the search shape (model+pipeline filter, `<=>`) returned the
  row at distance 0, a 3072-dimensional query errored in the database, cascade delete removed the row, the legacy `vector(3072)` table stayed
  untouched (script and output: `D:\w-embed-eval-02\sel04\02a-db-proof.sql` / `.out`).
- Real runtime through the production seam (provider + transport + worker, `cuda:0`): bge-m3 loaded from the pinned snapshot with the manifest
  digest verified, dtype `float32`, `max_seq_length` 8192, 1024 dimensions, norms 1.0, relevant passage 0.7105 vs irrelevant 0.3077; e5 and an
  unknown model are refused by the same seam with `EMBEDDING_MODEL_NOT_ALLOWED`, no worker started. Runtime: torch 2.6.0+cu124, sentence-transformers
  6.1.0, transformers 5.17.0 (the evaluation used 2.11.0+cu128 / 6.1.0 / 5.19.0; the tokenisation of both XLM-R models was shown identical across
  transformers versions, and fp16/fp32 and batch-size cells gave identical rankings in W-EMBED-A7-REPRO-03).
- Failures independent of this change: `noGoogleRuntimeGuard` (02B hits only), the B5 `.git`-file case of the protected-relation inventory in a git
  worktree (same as before, a clean export is the normative surface).

**Still open / not done here.** The migration is not applied to any shared database and has not been through the Prisma-migration Dev-Gov unit;
no 1024-dimensional rows exist (a re-embedding unit must populate the table); the runtime lives outside the repo and the production image;
the worker's default batch size is 4 (the evaluated run used batch size 1; the evaluation showed no difference in ranking, but vectors can
differ in the last bits); nothing is pushed or merged; independent verification has not happened.

## 7. Open items and honest limits

1. **Model selection: resolved by the owner decision of 2026-10-07 (section 6).** History: the corrected round 1 of the frozen A7 evaluation
   (2026-10-02) was NO-GO on the demo-01 keyword-style query set, but W-EMBED-A7-REPRO-03 showed that result was an evaluation-harness defect (the
   same models reach Recall@10 ~0.8 in a correct harness) and W-EMBED-MODEL-SELECTION-04 re-ran the selection on a product-representative set.
   The evaluation set is small (87 questions, 58 only self-reviewed); it supports a viable choice, not a claim of retrieval quality on the
   31,718-chunk legal corpus.
2. **The migration is committed but not applied to any shared database.** It needs the Prisma-migration Dev-Gov unit and explicit owner approval
   before any apply; because it sits in `prisma/migrations/`, `prisma migrate deploy` (staging deploy, fly release command, test databases) would
   apply it if this branch were merged -- non-application is by process (unpushed, unmerged), not structural.
3. **No local embeddings exist yet**; a re-embedding unit (separate, needs the migration) must populate the table.
4. **The runtime lives outside the repository and the production image** (no Python/torch there). Deployment of the worker runtime is open.
5. **Model files are pinned by revision directory**, not re-hashed at every start; the hash verification is the earlier eval tooling's.
6. 02B remains: `GeminiAnswerModelProvider.ts` (still has a comment naming the removed provider), `vertexAiService.ts`.
7. The answer route's import closure still contains the Gemini answer provider (02B); only the retrieval composition and route are proven Google-free here.
