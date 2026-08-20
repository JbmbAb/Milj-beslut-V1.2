# LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01 — PROVEN

**Status:** PROVEN (contract-level; no real embeddings generated, no vector storage wired --
that is the bounded pilot's job, not this unit's). Freezes the chain:

```
LegalCorpusMaterializedChunk -> EmbeddingRecord -> LegalRetrievalPolicy
  -> RetrievalExecutionTrace -> RetrievalResult
```

on top of `LEGAL-CORPUS-V1-TEXT-STRUCTURE-BASELINE-V2` and `LEGAL-RETRIEVAL-TRACE-REPAIR-01`.

## A real architecture fork, resolved before implementation

Reading `RetrievalPolicy.ts`/`ArtifactAccessRules.ts` in full (not just the quarantine recon's
compile/test check) surfaced that `mps-retrieval-governance`'s existing policy is hardcoded to the
**LU decision-evidence domain**: `MIMER-RET-I01` requires every query, for all four existing query
types, to resolve through `DecisionImpactArtifact` first. `LegalCorpusMaterializedChunk` has no
`DecisionImpactArtifact` concept at all -- reusing the policy as-is would mean either violating
I01 for every legal-corpus query or fabricating a fake `DecisionImpactArtifact` just to pass the
gate, a semantic lie, not a real satisfaction of the invariant.

**Decision (owner-confirmed): parallel policy, same discipline, no shared types.** A new
`LegalRetrievalPolicy` module was added to `mps-retrieval-governance` alongside the existing LU
`RetrievalPolicy` -- same versioned/read-only/artifact-class-isolation pattern, its own
`LegalArtifactClass` union, its own invariants, zero changes to the LU policy's files or
semantics. `assertRetrievalReadOnly` (genuinely domain-agnostic -- it only asserts the caller
lacks materialization authority) is reused directly, not duplicated. If real shared mechanics
prove out once both policies see real use, extracting a common kernel is a later, separate
decision -- not attempted here.

## What was built

### `packages/mps-retrieval-governance/src/LegalArtifactAccessRules.ts` + `LegalRetrievalPolicy.ts`

`LegalArtifactClass = "LegalCorpusMaterializedChunk" | "LegacyLegalCorpusChunk" |
"UnsignedDraftChunk"` -- the second and third exist to make the isolation rule (`LEGAL-RET-I02`)
non-trivial and grounded in real facts already established this session, not speculative
future-proofing: `LegacyLegalCorpusChunk` is the OLD `legal_corpus_chunks` table
`searchLegalCorpusTool.ts` still actively queries (`LEGAL-RETRIEVAL-ARCH-RECON-01`);
`UnsignedDraftChunk` is unsigned Phase B source-registry drafts, already proven-never-promotable
elsewhere in this repo (`P2SRLegacyIsNotAuthority.test.ts`). `LEGAL_RETRIEVAL_POLICY_VERSION =
"legal-ret-policy-1"`. Invariants `LEGAL-RET-I01` (initial class must be
`LegalCorpusMaterializedChunk`), `LEGAL-RET-I02` (legacy/unsigned forbidden), `LEGAL-RET-I03`
(read-only). 7 new tests, including one proving the LU policy is untouched and both coexist
without collision.

### `packages/mps-embedding-identity/` (new package)

The embedding-identity contract, deliberately standalone -- no dependency on governance, trace,
or mps-legal-corpus (per explicit instruction: the governance package must consume this, not
invent it). Binds exactly the six required fields:

```
fragment_id, materialization_id, chunk_content_hash,
embedding_model_id, embedding_model_version, embedding_pipeline_version
-> embedding_identity_hash
```

`computeEmbeddingIdentityHash()` / `bindEmbeddingIdentity()`. 10 tests proving, against
realistic field shapes (sha256-hex fragment/content hashes, cuid materialization ids): identical
input -> identical hash regardless of object key order; changing ANY of the six fields
(individually) -> a different hash; an incomplete input is rejected outright rather than hashed
partially.

### `packages/mps-legal-retrieval-contract/` (new package)

The actual chain-freeze. `GovernedChunkLookupPort` -- a minimal, storage-agnostic port over the
real `LegalCorpusMaterializedChunk` table (a real DB-backed adapter is the bounded pilot's job;
here, an in-memory implementation for tests). `buildRetrievalResult()` is the only way to
construct a `RetrievalResultFields`, and it enforces **"a retrieval result must always resolve
back to the exact governed chunk" as an executable check**, not a naming convention:

- `fragment_id` must resolve via the lookup port, or `UNRESOLVED_FRAGMENT`.
- The resolved chunk's `materialization_id` must match the claimed one, or
  `MATERIALIZATION_MISMATCH`.
- The `embedding_identity`'s own `fragment_id`/`materialization_id`/`chunk_content_hash` must
  match the resolved chunk exactly, or `EMBEDDING_IDENTITY_MISMATCH` -- an embedding computed for
  a *different* chunk (or against a stale content hash) can never satisfy a result claiming
  another chunk.
- At least one `source_provenance_refs` entry is required, or `MISSING_PROVENANCE`.

7 tests, including the specific proof this whole track exists to guarantee: **v2.3 and v2.4.1
fragments of the exact same underlying text (same `content_hash` by construction) never collide
into one embedding identity** -- `chunk_policy_version` being identity-bearing at the
materialization layer (`LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2`) is carried all the way through
to embedding identity, and a v2.3 embedding is proven to be rejected against a v2.4.1 retrieval
result even though the text is identical. Also proves the full chain composes end to end:
`evaluateLegalRetrieval` -> `bindEmbeddingIdentity` -> `createRetrievalExecutionTrace` ->
`buildRetrievalResult`, using the real, already-proven `mps-retrieval-trace` artifact (not a
stand-in).

## Proof

```
npx vitest run packages/mps-embedding-identity/ packages/mps-legal-retrieval-contract/ \
  packages/mps-retrieval-governance/ packages/mps-retrieval-trace/ packages/mps-query-budget/
  -> 13 test files, 44 tests, all pass

npx tsc --noEmit -p packages/mps-embedding-identity/tsconfig.json        -> clean
npx tsc --noEmit -p packages/mps-legal-retrieval-contract/tsconfig.json  -> clean
npx tsc --noEmit -p packages/mps-retrieval-governance/tsconfig.json      -> clean
```

Also added: `packages/mps-embedding-identity/**/*.test.ts` and
`packages/mps-legal-retrieval-contract/**/*.test.ts` to `vitest.config.ts`'s `compliance` project
`include` list (same discovery gap as `LEGAL-MATERIALIZATION-PROOF-DISCOVERY-01` -- a new package
is silently invisible to `vitest run` until explicitly globbed in), plus the four
`@miljobeslut/mps-*` aliases the new cross-package imports needed (governance and trace never
needed this alias before because their own tests only ever used relative imports).

## What this does not claim

- **No real embeddings exist.** No Vertex/OpenAI call, no persisted `EmbeddingRecord` row, no
  vector column, no pgvector index. `GovernedChunkLookupPort`'s only implementation is
  in-memory/test-only.
- **No real retrieval happens.** Nothing here is wired into `search.routes.ts`,
  `searchLegalCorpusTool.ts`, or any HTTP surface.
- **The LU `RetrievalPolicy`/`ArtifactAccessRules.ts` are completely unmodified** -- verified by a
  dedicated test, not just by omission.
- This is the type-level/invariant-level contract only. The next unit (a bounded pilot over
  Miljöbalken v2.4.1, ~10-20 MMÖD decisions, and one standard/HVMFS/SGU source) is where real
  embedding persistence, idempotency under replay, a real model-change producing a new identity,
  and real retrieval-to-governed-chunk resolution get proven against actual data -- not here.
