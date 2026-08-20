# LEGAL-RETRIEVAL-ARCH-RECON-01

**Status:** `CLOSED / ESTABLISHED / READ-ONLY`. Pure inventory of what already exists in the repo
touching embeddings/vector storage/retrieval, done before any new governed embeddings/retrieval
contract is designed on top of the frozen `LEGAL-CORPUS-V1-TEXT-STRUCTURE-BASELINE-V2` corpus. No
code was written or changed to produce this document.

## 1. Embeddings provider/model/versioning

- **`server/services/vertexEmbeddingService.ts`** — ACTIVE. Calls Vertex AI `:predict`. Model
  from `VERTEX_EMBEDDING_MODEL` env (default `text-multilingual-embedding-002`), fallback list
  via `VERTEX_EMBEDDING_FALLBACK_MODELS`. Dimension capped at 3072.
- **`server/services/searchService.ts:28-71`** — ACTIVE. `embedText()` wraps the above;
  `EMBEDDING_MODEL`/`EMBEDDING_DIM` env constants; `USE_MOCK_AI=true` mock mode (random vectors,
  `model: 'mock-embedding-v1'`).
- **`scripts/import/generate-embeddings.ts`** — LEGACY (flagged in
  `docs/architecture/LEGACY-CLASSIFICATION-2026-08-11.md:84,90`, "AUDIT-BRÄNNPUNKT"). Calls
  `@google/genai` `gemini-embedding-2` directly, writes via `prisma.$executeRawUnsafe` straight to
  `DocumentChunk.embedding`, bypassing every governance gate. Baked-in deterministic mock-embedding
  fallback with inconsistent dim (768/3072). No version/provenance column beyond a free-text
  `embeddingJson.model` string.
- No embedding-model version constant exists anywhere for the new governed corpus.

## 2. Vector storage / pgvector

Three separate, non-unified vector columns in `prisma/schema.prisma`:

| Table | Column | Type | Line | Status |
|---|---|---|---|---|
| `DocumentChunk` | `embedding` (+ `embeddingJson Json?`) | `Unsupported("vector(768)")` | 397-398 | ACTIVE |
| `LegalCorpusChunk` | `embeddingVector` | `Unsupported("vector")` | 1118 | ACTIVE (old `legal_corpus_chunks` table, `chunkVersion` default `"v2.2"`) |
| `EvidenceChunk` | `contentVector` | `Unsupported("vector(768)")` | 1374 | case_evidence/LU tier-3 |

Migrations: `prisma/migrations/20260627_hnsw_legal_chunks.sql` (HNSW on
`legal_corpus_chunks.embedding_vector`), `20260627_gin_legal_fts.sql` (GIN FTS companion),
`20260721180000_legal_corpus_chunks/migration.sql`.

**`LegalCorpusMaterializedChunk`** (schema.prisma:1069-1105, the governed table this baseline
covers) has **no vector column at all** and no linkage table to one — confirmed by direct read.
Pure text/structure identity (`fragmentId`, `chunkPolicyVersion`, `contentHash`,
`sourceProjectionRef`). This is the real gap a new contract fills — every existing example embeds
the vector inline on the chunk row, which conflicts with the append-only, replay-safe
materialization model already established for `LegalCorpusMaterializedChunk`.

## 3. Retrieval API

Two structurally distinct hybrid-retrieval stacks exist today, neither targeting the governed
`LegalCorpusMaterializedChunk`:

- **`server/modules/ai/orchestrator/tools/searchLegalCorpusTool.ts`** — ACTIVE, most complete.
  Hybrid RRF over 3 arms (exact chapter/paragraph SQL, GIN full-text, HNSW vector) against
  `public.legal_corpus_chunks` (the **old** table). Feature-flagged cross-encoder rerank
  (`LEGAL_RERANKER` env) via `legalRerankService.ts`.
- **`server/routes/search.routes.ts:38-62`** — `POST /api/search/rag` -> `runRagSearch()`
  (`server/modules/search/public.ts`), backed by `AlphaevolveSearchService`
  (`server/services/searchService.ts`), queries `DocumentChunk` via
  `searchRepository.ts:queryTopSemanticChunks` (line 435).
- `server/routes/searchRoutes.ts` and `server/routes/ai.routes.ts` — additional/older route
  surfaces referencing search; not yet diffed against `search.routes.ts` for overlap.

## 4. Chunk -> embedding identity

`DocumentChunk`, `LegalCorpusChunk`, and `EvidenceChunk` all co-locate the embedding directly on
the chunk row. **No precedent exists** for how a governed `fragment_id` should relate to an
embedding record as a separate, versioned artifact — the append-only materialization model this
whole corpus was built on has no analog yet on the embeddings side.

## 5. Query logging/provenance

- `SearchQueryLog` Prisma model (schema.prisma:500-515) + `logSearchQuery()`
  (`searchRepository.ts:581`) — ACTIVE for `/api/search/rag` (userId, projectId, query, mode,
  topK, resultCount, elapsedMs).
- `searchLegalCorpusTool.ts:342-735` — structured JSON log lines (`queryHash` via
  `lib/queryHash.ts`, retrieval/rerank timing, shadow-validation metrics: Kendall tau, NDCG@5,
  MRR, Recall@10). Log-line telemetry only, not a persisted/queryable table.
- **`packages/mps-retrieval-trace/`** — a full typed provenance artifact model
  (`RetrievalExecutionTraceArtifact`: trace_hash, query_hash, policy_version,
  artifact_snapshot_ref, selected_artifact_refs, cost/duration), `RetrievalTraceBuilder`,
  `canonicalTraceHash.ts`, `RetrievalTraceDeterminism.test.ts`. Per
  `LEGACY-CLASSIFICATION-2026-08-11.md:37`: **QUARANTINED — zero production consumers**, still
  exercised by the `compliance` vitest project.

## 6. Reranking

- `server/services/legalRerankService.ts` — ACTIVE. `rerankWithGeminiOrLexical()`: Vertex Gemini
  rerank with deterministic Jaccard-ish `localLexicalRerank` fallback, gated by `LEGAL_RERANKER`
  env, versioned prompt via `RerankPromptService`.
- `packages/mps-lu/src/services/EvidenceRAGService.ts` — separate, independent heuristic reranker
  (token-overlap + n-gram + authority-type weighting + temporal decay) inside LU's evidence
  pipeline, not the same code path.
- `prompt_optimizer/rerank_client.py`, `async_rerank_client.py` — Python, tied to
  `scripts/alphaevolve` experiment tooling, not the runtime server.

## 7. Citation/source-ref propagation

`searchLegalCorpusTool.ts` (lines 480-545) propagates `sourceUrl`, `sourcePath`, `caseNumber`,
`chapter/paragraph/section` through to the tool response — the closest existing thing to citation
propagation, but pointed at `legal_corpus_records`/`legal_corpus_chunks` (old tables), not the
governed materialized corpus. **No dedicated citation artifact or answer-to-source-ref binding
contract exists.**

## 8. Replay/determinism expectations

**Not present** in the active retrieval stack — no determinism test or replay-hash concept in
`searchLegalCorpusTool.ts`/`searchService.ts`; HNSW `ef_search` tuning exists but no seed/replay
contract; vector ANN search is inherently non-deterministic as currently wired.

**Does exist, unused:** `mps-retrieval-governance/tests/PolicyDeterminism.test.ts`,
`mps-retrieval-trace/tests/RetrievalTraceDeterminism.test.ts` — both QUARANTINED.
`mps-retrieval-governance/src/RetrievalPolicy.ts` encodes a frozen policy model
(`RETRIEVAL_POLICY_VERSION = "ret-policy-1"`, invariants `MIMER-RET-I01..I06`, artifact-class
allow/forbid lists, `read_only: true`) built in the same replay-proof style as materialization —
**a real prior design attempt at almost exactly what this recon is scoping**, never wired to any
live retrieval code.

## 9. Legacy/superseded map

`docs/architecture/LEGACY-CLASSIFICATION-2026-08-11.md` already ran a first-pass
ACTIVE/LEGACY/QUARANTINED/RETIRED audit (dated, DRAFT, unfrozen), directly relevant:

- **LEGACY:** `scripts/import/generate-embeddings.ts` (governance-bypass write directly into
  `DocumentChunk.embedding`).
- **QUARANTINED** (real code, real determinism tests, zero prod consumers): `mps-retrieval-
  governance`, `mps-retrieval-trace`, `mps-decision-governance`, `mps-cas-boundary`.
- **Not yet classified by that doc, touching this domain:** `mps-diagnostics`,
  `mps-query-budget`.
- `docs/architecture/rag-hybrid-retrieval.md` ("RAG V2.2") — describes the current
  `legal_corpus_chunks` hybrid pipeline (exact/FTS/vector arms, RRF, HNSW params) in detail,
  written before the governed materialization baseline existed.
- `docs/architecture/rag-flow.md`, `docs/architecture/ai-model-selection.md`,
  `docs/architecture/ADR-005-vertex-ai-data-minimization.md` — additional RAG/embeddings-adjacent
  architecture docs, not read in depth by this recon.
- The user-recalled `importLibrarianQa.ts` was not found under that exact name; the actual
  surface is `scripts/import/import-librarian-manifest.ts`,
  `tests/unit/import/importLibrarianQa.test.ts`,
  `docs/architecture/import-librarian-only-policy.md` — worth a follow-up look only if the
  librarian/QA ingestion path turns out to matter to the new contract.

## What this recon does not decide

This document is inventory only. It does not choose between reviving `mps-retrieval-governance`/
`mps-retrieval-trace` versus designing a fresh governed embeddings/retrieval contract from
scratch, does not touch any legacy table or route, and does not propose the identity/retrieval
contract itself. That is the next, separate decision.
