# NO-GOOGLE-02A -- owner decision note (model selection and the 1024 migration)

Status of the unit: **W-NO-GOOGLE-02A-LOCAL-EMBEDDING-REPLACEMENT: WORKING / BLOCKED_BY_MODEL_SELECTION_AND_MIGRATION_APPROVAL.**
Nothing here is verified. The writer's own read-only review is a SELF-review and is not independent verification.
No model is selected, no default model is wired, the migration is not applied, the eval is not rerun or tuned.

Sources: `EMBEDDING-EVAL-RERUN-REPORT.md` (corrected round 1, 2026-10-02) and its result files in
`C:\Users\jimmy\brunn-capability-map-2026-10-01\demo-runtime\embedding-eval\` (not a git repository):
`rerun-official-model-selection.json` sha256 `ebdc2a42d8bebcd2cc36d3cfd70a3ef87f84a18c3ae048730993ae8ad4c2c0a6`,
`rerun-official-bge-m3-eval.json` sha256 `d6ed546ceb6d6a7439770f51f69ccdba38dd4839faa20ee8d98eeed6357528b6`,
`rerun-official-e5-eval.json` sha256 `346996ee4aef9ecc49596a1aca0b30a7eade798720dc236ac06147962eaab0c2`.
Frozen protocol: `CHUNK-RETRIEVAL-LOCAL-EMBEDDING-DESIGN-01.md` section 9 (one comparison round, bars predeclared, no tuning).

## 1. Model selection blocker

### 1.1 Frozen acceptance bars (design section 9; unchanged in the official run)

A candidate is eligible only if all hold: Recall@3 >= 0.910256, Recall@10 >= 0.910256, MRR >= 0.884615, source-document hit@10 >= 71/78,
0 identity-contract violations, deterministic top-10 on replay, no hidden CPU fallback. Neither candidate meeting every bar = NO-GO
(A, the lexical BM25 retrieval, stays active, no re-embedding).

### 1.2 Frozen metrics (primary corpus: 101 chunks, 21 documents, 78 queries; observed 2026-10-02)

| Metric | Bar | BM25 (same harness) | BAAI/bge-m3 @ 5617a9f6 | intfloat/multilingual-e5-large @ 3d7cfbda |
|---|---|---|---|---|
| Recall@1 | - | 0.858974 (67) | 0.115385 (9) | 0.243590 (19) |
| Recall@3 | >= 0.910256 | 0.910256 (71) | **0.256410** (20) FAIL | **0.371795** (29) FAIL |
| Recall@5 | - | 0.910256 (71) | 0.346154 (27) | 0.423077 (33) |
| Recall@10 | >= 0.910256 | 0.910256 (71) | **0.551282** (43) FAIL | **0.487179** (38) FAIL |
| MRR | >= 0.884615 | 0.884615 | **0.223265** FAIL | **0.319780** FAIL |
| Source-document hit@10 | >= 71 | 78 | **69** FAIL | **59** FAIL |
| Bars failed | | none | all four | all four |
| Hard sanity gates G1-G8 | | | all PASS (status VALID) | **G5 (positive control) FAIL**, others PASS (status INVALID_SANITY) |
| Decision | | | not eligible | never eligible |

Secondary corpus (the 57 chunks of the 12 target documents, BM25's own corpus): bge-m3 R@1/R@3/R@10 0.115/0.321/0.615, MRR 0.262, doc@10 73
(fails R@3, R@10, MRR); e5 0.321/0.397/0.577, MRR 0.378, doc@10 63 (fails all four). The answerable ceiling is 71 of 78 queries.
Official decision file: `decision: NO-GO`, `winner: null`, `bars_unchanged` as in 1.1.

### 1.3 Attribution (evidence level stated; nothing here lowers a bar)

| Factor | Finding | Evidence |
|---|---|---|
| Model quality | **UNKNOWN as a cause.** Both models run correctly (weights equal checkpoint 391/391, documented pipeline, numerics, non-collapse, reference cross-check cos >= 0.9998, bit-identical replay), and both are far below BM25 on THIS benchmark. Quality on natural-language queries or on the legal corpus is untested. | OBSERVED (report 3, 4) |
| Chunk corpus | **Contributes, observed for e5.** 62 of 101 chunks exceed 512 tokens; for 15 of 71 answerable targets the gold span is cut off in e5's view (7 partly, 8 fully). Templated near-duplicate chunks explain part of the misses (e5: 15 of 30 G5 misses have their top-1 in the same document, 7 near-identical text). Windowed MaxP lifts MRR to 0.384 (e5) / 0.343 (bge-m3): still under half of the 0.884615 bar. bge-m3 truncated to 512 is worse (0.234), so long context is not the cure either. | OBSERVED (report 4.3, 3) |
| Evaluation harness / benchmark design | **Major contributor relative to the bars.** Queries are the first 14 informative tokens of the gold citation (a keyword string that leaks lexically; BM25 hits 67 of 71 answerable at rank 1). The R@3 and R@10 bars equal the answerable ceiling (71/78): perfect top-3 on every answerable question, i.e. BM25 parity on BM25-favoured queries. The harness itself is validated (BM25 reproduced exactly 67/71/71/71, MRR 0.884615; gates G1-G9). Round 1 (2026-09-30) is invalid; its collapse cause is not determinable (artifacts deleted), it does not reproduce with verified files. | OBSERVED + READ (report 1, 3, 5) |
| Query/passage convention | **Not a cause.** Gate G2 passed for both: pooling, max length 8192 / 512, dimension 1024, prefixes exactly `query: ` / `passage: ` for e5 and none for bge-m3, no hidden default prompt. | OBSERVED (G2) |
| Open | (a) whether e5's G5 failure is a model property on this corpus or a threshold that is too strict for mean pooling over 512 tokens; (b) the cause of round 1's collapse; (c) behaviour with natural-language queries; (d) behaviour on the 31,718-chunk legal corpus that `LegalRetrievalComposition` serves: the A7 corpus is the 101-chunk demo-01 document set, a different corpus and use case. | UNKNOWN |

The result does NOT say dense retrieval is unsuitable, nothing about hybrid retrieval or reranking, nothing about bge-m3 sparse/ColBERT modes, and it is not
representative of the legal corpus (report section 7).

### 1.4 Already technically proven, independent of model selection (writer-run, not verified)

- Provider contract, closed identity registry (both candidates, exact revisions), explicit 3072 -> 1024 boundary in code, statement and database.
- Fail-closed behaviour: no default model, no third candidate, no Google fallback, no mock, no pad/truncate, runtime proves repo/revision/pipeline/dimension on every call, no hidden CPU fallback.
- Both candidates load and run end to end through provider + transport + worker on the RTX 4050 (`cuda:0`, fp16, 1024 dims). This shows capability only; it is NOT a selection signal.
- Containment of the worker (python-only interpreter, allowlisted environment, offline flags), negative controls against the real worker.
- The proposed table, constraints, the real INSERT and the search statement, in a disposable pgvector container (removed).
- Google removed from the legal retrieval composition; guard hits 4 -> 3.
Not proven: any retrieval quality; any activation; any production wiring.

### 1.5 Minimum safe options

- **A. Keep 02A blocked pending a new governed embedding-eval design.** Branch stays WORKING and unmerged. The composition throws `EMBEDDING_PROVIDER_NOT_CONFIGURED` without an explicit
  `MIMER_LOCAL_EMBEDDING_MODEL` (none is set anywhere); legal vector retrieval is unavailable on this branch because the Google path is removed; lexical retrieval is unaffected. No cost.
- **B. Authorize a new frozen evaluation unit before any production selection.** The owner decides, before anything runs: corpus (legal corpus and/or demo-01), a query set that does not leak from the gold
  citation, bars fixed in advance (and not tied to the answerable ceiling unless intended), the candidate set (still only these two, per the frozen track), who writes and who verifies the harness,
  and that there is exactly one comparison round. The old round is not rerun or tuned.
In both options the migration below stays unapplied until approved. Both candidates are pinned by the table, so choosing either later needs no schema change; a different model or a new revision needs a new registry entry and a new migration.

## 2. Frozen 3072 -> 1024 persistence proposal (NOT applied)

- **Migration:** `prisma/migrations/20261006220000_legal_corpus_chunk_embedding_local_v1/migration.sql`, introduced in commit `660a7d12` (unchanged since),
  sha256 `40bfa1ed78b9197c93b4752d6a11c14c8d18bf4d52b088f5287066e7a9a7585c`, git blob `55abd3a52080c0157345605bef1f127839bbf2bb`. Prisma model `LegalCorpusChunkEmbeddingLocalV1` in `prisma/schema.prisma` (same commit).
- **Legacy stays legacy:** `legal_corpus_chunk_embeddings` (`vector(3072)`, 31,706 `gemini-embedding-001` + 5 `gemini-embedding-2` rows) is not altered, not read as local, not copied, not dropped. The migration contains no INSERT, UPDATE, DELETE, TRUNCATE, DROP or ALTER of it.
  No active code references it any more (its only writer is retired, five scripts that used it are retired, and the sixth, the quality baseline, no longer runs a search).
- **New table `legal_corpus_chunk_embeddings_local_v1`:** `id TEXT PK`; `fragment_id`, `materialization_id`, `chunk_content_hash` TEXT NOT NULL; `embedding_model_id`, `embedding_model_version`, `embedding_pipeline_version` TEXT NOT NULL;
  `embedding_identity_hash` TEXT NOT NULL; `embedding_dimension SMALLINT NOT NULL`; `embedding_vector vector(1024) NOT NULL`; `created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`.
- **Constraints:** `lcel_v1_dimension_chk CHECK (embedding_dimension = 1024)`; `lcel_v1_pipeline_binding_chk` allows exactly two triples
  (`local-st-bge-m3-dense-v1` + `BAAI/bge-m3` + `5617a9f61b028005a4858fdac845db406aefb181`; `local-st-multilingual-e5-large-v1` + `intfloat/multilingual-e5-large` + `3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3`);
  unique index `lcel_v1_identity_hash_key` on `embedding_identity_hash`; indexes on `fragment_id` and `materialization_id`; FK `lcel_v1_chunk_fkey (materialization_id, fragment_id)` to `legal_corpus_materialized_chunks`, ON DELETE/UPDATE CASCADE.
  A 3072- or 768-dimensional vector cannot be stored (type), a Google or mixed or other-revision identity cannot be stored (CHECK), a vector without a governed chunk cannot be stored (FK).
- **Identity fields:** the six `embed-identity-1` fields (`fragment_id`, `materialization_id`, `chunk_content_hash`, `embedding_model_id`, `embedding_model_version` = exact HF revision, `embedding_pipeline_version`) and their hash, plus the explicit dimension column.
  `embed-identity-1` itself is unchanged. `assertLocalEmbeddingIdentity` accepts an identity only if its triple equals a registered pipeline and its hash matches its fields; every historical Google identity is rejected.
- **Read-path selector:** `LegalRetrievalComposition` searches only `"legal_corpus_chunk_embeddings_local_v1"` with `WHERE e.embedding_model_id = $model AND e.embedding_pipeline_version = $pipeline` (values come from the provider, i.e. the registry),
  `ORDER BY e.embedding_vector <=> $1::vector(1024)`; before any SQL `assertLocalQueryVector` requires a registered local pipeline and exactly 1024 finite numbers. No code path reads both tables or compares across dimensions.
- **Evidence (writer-run):** applied only in a disposable container (no port, no volume, removed). The real INSERT text from the TypeScript file: valid bge-m3 row inserted, an identical replay returned 0 rows, valid e5 row inserted; rejected: 3072-dim and 768-dim vectors,
  dimension column 3072, Google triple, mixed triple, other revision, missing governed chunk, NULL vector; the search shape returned only the matching pipeline, a 3072-dim query errored in the database, a Google pipeline returned 0 rows; cascade delete worked.
  Offline `prisma migrate diff` (base schema to HEAD schema) generates the same table, indexes and foreign key as the hand-written SQL (names equal); only the two CHECK constraints are outside what Prisma can express.
- **Rollback / non-application behaviour:**
  - Not applied to any live or shared database; only the disposable container above. The branch is not pushed.
  - **Caution (fact):** the file sits in `prisma/migrations/`, which `prisma migrate deploy` applies in full. That command runs in `.github/workflows/deploy-staging.yml`, `fly.toml` (`release_command`), `scripts/demo/bootstrap-sharp-demo.ps1`, `DOCKER.md`
    and, via `npm run db:test:migrate`, against test databases. If this branch were merged or run against a database, the table would be created. Non-application is therefore by process (unpushed, unmerged), not structural.
    Owner choice: keep it unmerged until approval, or move the SQL out of `prisma/migrations/` until then (not done here, to keep the proposal frozen as committed).
  - If applied and later withdrawn: the migration is additive, creates one table and touches no existing object; the inverse is dropping `legal_corpus_chunk_embeddings_local_v1` and removing its `_prisma_migrations` row. No rollback SQL is shipped as a migration.
  - If never applied: the provider and the code-level boundary still hold; the search or the persist call fails closed with a database error (relation missing); an empty table returns no hits. Nothing falls back to the legacy table.

## 3. What this note asks of the owner

1. Choose A or B for model selection (1.5), or another route; until then no model is selected and nothing is wired as a default.
2. Decide whether the migration proposal in section 2 may be approved for the Prisma-migration Dev-Gov unit, and whether it should be moved out of `prisma/migrations/` in the meantime.
