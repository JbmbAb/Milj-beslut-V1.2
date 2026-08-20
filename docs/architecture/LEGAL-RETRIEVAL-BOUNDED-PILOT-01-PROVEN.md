# LEGAL-RETRIEVAL-BOUNDED-PILOT-01 — PROVEN

**Status:** PROVEN (identity/provenance/replay/fail-closed proofs) + real, honestly-reported
retrieval-quality results (mixed, kept separate per instruction — quality is not part of the
PROVEN verdict). Real embeddings, real persistence, real retrieval, over a deliberately bounded,
source-level slice of the frozen `LEGAL-CORPUS-V1-TEXT-STRUCTURE-BASELINE-V2` corpus.

## Provider gap found and classified, not silently worked around

**Vertex AI's ADC path is genuinely broken in this environment**, verified independently of any
app code: `gcloud auth application-default print-access-token` itself fails with
`"Reauthentication failed. cannot prompt during non-interactive execution. Please run: gcloud
auth application-default login"`. This is a cached, session-bound credential requiring
interactive human browser reauth — not reproducible, not governable, and not something to route
around silently. `server/services/vertexEmbeddingService.ts` (`VERTEX_PROJECT_ID`,
`VERTEX_LOCATION` both configured) confirmed the same failure end-to-end
(`invalid_grant: reauth related error (invalid_rapt)`).

**A different real, working, reproducible provider was found and used instead**, not a test
fake: the Gemini API-key path (`GEMINI_API_KEY`, already present and non-interactive), via
`@google/genai`'s `embedContent`. Verified live before committing to it: both `gemini-embedding-
001` and `gemini-embedding-2` return real 3072-dim vectors; batch embedding (multiple texts per
call) confirmed working for `gemini-embedding-001` but NOT reliably for `gemini-embedding-2`
(a 5-item batch request returned only 1 embedding) — the pilot's own `embedBatch` size-mismatch
check caught this live and failed closed rather than silently padding with mock values; the
model-change proof step was adjusted to call `gemini-embedding-2` at batch size 1 instead of
loosening that check.

`scripts/import/generate-embeddings.ts` (LEGACY, governance-bypass) uses the same underlying
`@google/genai` call mechanism — this unit reuses only the verified call itself
(`GeminiEmbeddingProvider.ts`), never that script's persistence or its silent-mock-on-failure
fallback.

## What was built

- **`prisma/migrations/20260820160000_legal_corpus_chunk_embedding_v1`** — new
  `legal_corpus_chunk_embeddings` table. Deliberately a separate table, not a column on
  `LegalCorpusMaterializedChunk`: an embedding is a versioned derivative under a specific
  model/pipeline, and the same chunk legitimately gets multiple embedding rows over time.
  `embedding_identity_hash` (from `mps-embedding-identity`) is `UNIQUE` — the actual identity,
  not an incidental column. FK to `legal_corpus_materialized_chunks(materialization_id,
  fragment_id)`, `ON DELETE CASCADE`. `vector(3072)` (Gemini's real dimension, not the legacy
  tables' 768).
- **`server/modules/legal/retrieval/GeminiEmbeddingProvider.ts`** — the real provider, pinned
  model/version/pipeline constants, fails closed on any batch-size or missing-values mismatch.
- **`server/modules/legal/retrieval/LegalCorpusChunkEmbeddingPersistence.ts`** — idempotent
  write (`INSERT ... ON CONFLICT (embedding_identity_hash) DO NOTHING ... RETURNING`, so
  "inserted" vs "already existed" is read directly from the returned row count, not inferred),
  and a real DB-backed chunk-ref fetcher for `mps-legal-retrieval-contract`'s
  `GovernedChunkLookupPort`.
- **`scripts/db/legal-retrieval-bounded-pilot-01.ts`** — the identity/provenance/replay/
  fail-closed proof run.
- **`scripts/db/legal-retrieval-bounded-pilot-01-query-battery.ts`** — the separate
  retrieval-quality run.

## Scope (source-level bounded, not full-corpus)

| Source | Scope | Chunks |
|---|---|---|
| Miljöbalk (1998:808) v2.4.1 | chapters "1" and "18" (diverse: general aims/definitions vs. government review) | 30 |
| 15 real MMÖD decisions | full chunk set each, chosen to exclude the known Part G duplicate identity and the two largest decisions in the sample window (208 and 387 chunks) to keep total volume bounded | 397 |
| SGU "Vägledning för att borra brunn" (standard) | full | 7 |
| **Total** | | **434** |

Not the full 31,706-chunk corpus baseline — that is explicitly the next, separate bulk phase per
instruction, gated on this pilot being green.

## Identity/provenance/replay/fail-closed proof — all PROVEN, all against real data

| Proof | Result |
|---|---|
| Same fragment + same model + same pipeline -> same embedding identity | PROVEN — run 1 persisted 434/434 new rows |
| Same inputs replayed -> no duplicate embedding rows | PROVEN — replay run: 0 inserted, 434 already-existed, DB row count unchanged (434 -> 434), independently re-verified: distinct `embedding_identity_hash` count = total row count (440, including the two later proof steps) |
| Same fragment + changed model -> new embedding identity | PROVEN — 5 real chunks embedded under both `gemini-embedding-001` and `gemini-embedding-2`: zero identity collision, all 5 alt-model embeddings landed as new rows |
| v2.3 and v2.4.1 of the same/similar text -> distinct embedding identities | PROVEN, on a REAL located pair (not synthetic): Miljöbalken chapter 1 § 1 exists in both materializations with byte-identical `content_hash`; distinct `fragment_id`s (`frag:70bf00...` vs `frag:b43de5...`), distinct `embedding_identity_hash`es (`cb0c7034...` vs `daaa689f...`) |
| Retrieval result resolves to exact fragment_id / materialization_id / provenance | PROVEN for all 434 real embedded chunks — `buildRetrievalResult` against a REAL DB-backed `GovernedChunkLookupPort` (not the unit-level in-memory fixture), 434/434 resolved |
| Missing governed chunk -> fail closed | PROVEN — a fabricated `fragment_id` correctly rejected with `UNRESOLVED_FRAGMENT` |
| Tampered embedding/chunk binding -> fail closed | PROVEN, on the REAL v2.3/v2.4.1 pair — the v2.3 embedding claimed against the v2.4.1 chunk correctly rejected with `EMBEDDING_IDENTITY_MISMATCH` |

Independently re-verified directly against the database (not the script's own printed summary):
440 total rows (434 main run + 5 alt-model + 1 v2.3 counterpart), 440 distinct
`embedding_identity_hash` values, zero rows with a NULL vector.

## Retrieval-quality battery — kept separate, reported honestly (not part of the PROVEN verdict)

Real queries against real persisted embeddings, pgvector cosine search
(`embedding_vector <=> query_vector`), top-5 returned per query, "correct" defined per query
against a known expected answer.

| Query | Expected | Top-1 | Correct@1 | Correct@3 | Correct@5 |
|---|---|---|---|---|---|
| "Vad är miljöbalkens mål och tillämpningsområde?" | MB ch.1 | MB ch.1 | yes | yes | yes |
| "Regeringens prövning av överklagade avgöranden enligt miljöbalken" | MB ch.18 | MMÖD (wrong) | **no** | **no** | **no** |
| "...dom i mål P 13258-25" (self-retrieval) | that decision | P 13393-25 (wrong) | no | yes | yes |
| "...dom i mål M 6089-24" (self-retrieval) | that decision | P 13258-25 (wrong) | **no** | **no** | **no** |
| "...dom i mål P 1329-26" (self-retrieval) | that decision | P 1329-26 | yes | yes | yes |
| "Hur borrar man en brunn..." | SGU | SGU | yes | yes | yes |

**correct@1: 3/6, correct@3: 4/6, correct@5: 4/6.** Reported as-is, not tuned or cherry-picked to
look better — this is real semantic search behavior on a small, real corpus, not a synthetic
demo. Two genuine, worth-noting findings, neither an identity/provenance defect:

- Chapter 18 (11 chunks, government-review procedural text) never surfaced for a query about its
  own topic — plausibly a real embedding-model/query-phrasing weakness on a small, dense
  chapter, not something this pilot's scope lets us diagnose further.
- Case-number self-retrieval succeeded for 2 of 3 decisions. Bare citation numbers ("M 6089-24")
  are a weak signal for a *semantic* embedding model — this is an expected, known limitation of
  semantic search for exact-citation lookup, not a defect in this pilot's identity/provenance
  layer (provenance was intact on every single hit, correct or not — the retrieved chunk always
  resolved back to its real governed source, it just wasn't always the *right* chunk).

Every single hit across all 6 queries, correct or not, passed the provenance-intact check
(resolved back through `buildRetrievalResult` against the real DB) — the retrieval mechanism
never returned an untraceable or fabricated result, it just sometimes ranked the wrong real
chunk first.

## What this does not claim

- Not full-corpus scale — 434 of 31,706 governed chunks (~1.4%). Bulk embedding over the whole
  frozen baseline is the explicitly separate next phase.
- Retrieval quality is mixed and reported as such — this pilot does not claim production-ready
  ranking quality, only that the identity/provenance/replay/fail-closed contract holds under
  real conditions.
- Vertex AI remains unusable in this environment pending a real (human) `gcloud auth
  application-default login` or an equivalent service-account credential being provisioned —
  not attempted or worked around here.
- No HTTP/API surface, no UI, no integration with `search.routes.ts` or
  `searchLegalCorpusTool.ts`.

## Next

If this pilot's identity/provenance result is accepted, the next phase is bulk embedding over
the full frozen corpus baseline — a separate, explicitly gated decision, not started here.
