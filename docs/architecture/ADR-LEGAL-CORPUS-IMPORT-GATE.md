# ADR — Legal Corpus Import Gate (Approval & Provenance)

## Status

**ACCEPTED / FROZEN.** Extracted and formalized 2026-08-30 from
`docs/ops/agent-instructions/TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md`'s
"SCHEMA-CONVERGENCE-SPEC 2026-08-11 — Juridisk ingestion: approval & provenance" section, per
owner-directed authority normalization (D6 anomaly, DOCUMENTATION_FINAL_NORMALIZATION). That
document is a task-scoped agent instruction (persona "TOR"), not architecture authority — five
production files were citing it as `ADR:` in code comments despite its instruction-style framing.
This ADR is the canonical replacement reference; the invariant itself is unchanged, only its
authority location.

## Context

The legal RAG pipeline has two governed boundaries. Raw material acquisition is already governed
via the separate quarantine/harvest track (untouched by this ADR). This ADR governs the second
boundary: between processing (extraction, chunking, embedding — non-authoritative, redoable) and
the canonical corpus (`legal_corpus_chunks`/pgvector — authoritative, searchable, what LU's RAG
actually answers from). **The approval gate sits at that boundary, not earlier.**

Implemented in `packages/mps-legal-corpus/` (`ChunkIdentity.ts`, `CorpusImportAttestation.ts`,
`IngestionManifest.ts`, `CorpusImportGate.ts`, `index.ts`) plus
`server/security/legalCorpusSigningKey.ts` (its own signing key/env block, separate blast radius
from the governance/harvest-plan signing keys). Storage-agnostic by design — `ManifestStore`/
`CorpusWriter` are injected, so the gate is unit-testable without a live database.

Reuses the exact same attestation mechanism already proven for CAS promotion
(`QuarantinePromoter.promote()`, Level 2) and specified for the source registry
(`SourceRegistryArtifactV2`) — no new authority model invented for this domain.

## Decision

### 1. What artifact approves ingestion/chunking

`LegalCorpusImportAttestationPredicate` — a signed predicate inside an `ArtifactAttestation`
(`createArtifactAttestation`/`verifyArtifactAttestation`, the existing mechanism):

```
{
  action: "legal.corpus.import"        // domain-separates from promotion/source-approval attestations
  document_id: string                  // stable id, binds to RawSourceArtifact
  source_content_hash: string          // hash of the raw text the chunking started from
  chunk_set_content_hash: string       // hash of the ENTIRE deterministic, canonicalized chunk
                                        // array (fragment_id + full_text + structural fields —
                                        // NOT embedding_vector; see "Out of scope" below)
  pipeline_version: string             // code/pipeline version (extraction + chunking)
  chunk_policy_version: string         // policy version, independent of pipeline_version
  approver_actor_id: string
  approver_role: "GOVERNANCE_REVIEWER"
  attestation_schema_version: number
  signer_key_id: string
}
```

`subjectDigest = sha256:<chunk_set_content_hash>`. Own `key_id`/signing key, separate blast
radius from the promotion and harvest-plan keys.

**Locked precision: `chunk_set_content_hash` ordering and exactness.** The same chunk set in a
different array order MUST NOT accidentally produce the same identity, but the ordering used must
be deterministic and reproducible — not "whatever order the database happens to return rows in."

1. Chunks are sorted by an explicit, deterministic comparator BEFORE serialization:
   `(chapter, paragraph)` with paragraph compared numeric-aware (not naive string sort — "34:10"
   must not sort before "34:2"), with `fragment_id` as the final, unambiguous tiebreak. This
   sort function is itself part of `pipeline_version`'s contract — changing the sort logic counts
   as a pipeline change.
2. `canonicalizeStrict` (RFC 8785) canonicalizes object-key order within each chunk, but does
   **not** canonicalize array-element order — array order must already be correct before
   `canonicalizeStrict` is called; it is not a safety net for this.
3. Only identity-bearing fields are hashed per chunk: `fragment_id`, `chapter`, `section`,
   `paragraph`, `title`, `full_text`, `references_to`, `case_citations`, `chunk_policy_version`.
   `embedding_status`/`embedding_vector` and all timestamps (e.g. `processed_at`) are explicitly
   excluded — reusing the existing rule in `mps-core/src/types.ts`: *"Timestamps SHALL NOT
   participate in canonical identity, hashing, signing, or replay equality."*
4. `chunk_set_content_hash = sha256(canonicalizeStrict(orderedChunkArray))` — verification must
   reproduce the exact same bytes by running the same sort function + field extraction +
   `canonicalizeStrict` call, not a loose "equivalent" comparison.

### 2. Provenance required even for filtered-out material

`IngestionManifestEntry` — **one entry is required for every raw document the pipeline ever looks
at, regardless of outcome:**

```
{
  document_id: string
  source_manifest_ref: ContentReference          // → RawSourceArtifact (quarantine track)
  status: "PENDING" | "INGESTED" | "FILTERED_OUT" | "FAILED"
  classification: { legal_area?, document_type?, municipality?, date?, authority? }
  content_hash: string                            // hash of extracted raw text — present even at FILTERED_OUT
  pipeline_version: string
  processed_at: string                            // ISO 8601
  filtered_reason?: string                        // REQUIRED if status === FILTERED_OUT, forbidden otherwise
  corpus_import_attestation_ref?: ContentReference // REQUIRED if status === INGESTED, forbidden otherwise
}
```

**Standalone contract violations**, independent of which write path was called: (a) a raw
document with no manifest entry at all, (b) `FILTERED_OUT` without `filtered_reason`, (c)
`INGESTED` without `corpus_import_attestation_ref`. This is a completeness invariant checked by
scanning the manifest, not only by the write path's own logic — a silently dropped source must be
discoverable without trusting that the write code behaved correctly.

**Manifest completeness is a pre-write gate, not a post-hoc audit.** The completeness scan is a
mandatory part of the write sequence for an ingestion run (batch), and must pass in full for the
entire run's manifest before the first row is written to `legal_corpus_chunks` for any document in
that run.

### 3. Required negative tests

1. Direct call to the corpus-import function without/with an invalid attestation → rejected, zero
   rows written to `legal_corpus_chunks`.
2. A validly-signed attestation for document A's chunk set reused to import document B's chunks →
   rejected (`document_id`/`chunk_set_content_hash` binding).
3. An attestation created for a different `action` reused as `legal.corpus.import` → rejected.
4. Chunk set re-run with a DIFFERENT `pipeline_version`/`chunk_policy_version` than the
   attestation was signed against → rejected.
5. `chunk_set_content_hash` in the attestation does not match a fresh hash of what will actually
   be written → rejected before the first DB write.
6. Manifest completeness scan: a raw document in the archive/quarantine with no manifest entry,
   or a `FILTERED_OUT` entry with no `filtered_reason`, or an `INGESTED` entry with no
   `corpus_import_attestation_ref` → flagged as a contract violation. This is a batch-level check,
   run as part of the single gate decision before the run's first corpus write — not a loosely
   coupled, scheduled after-the-fact audit, and not merely a per-document/per-call gate.

### Operative sequence (the explicit invariant)

An ingestion run is treated as a batch with ONE shared gate decision, not as N independent
documents each separately slipping past the gate toward the corpus:

```
raw docs (already governed — quarantine track, untouched here)
        │
        ▼
deterministic processing  (extraction + chunking, pipeline_version + chunk_policy_version bound,
        │                  ordered chunk array per §1 above)
        ▼
complete manifest  (ONE manifest entry per document in the run, regardless of outcome — the
        │           entire batch's manifest finished before the next step)
        ▼
chunk-set canonicalization/hash  (chunk_set_content_hash per document, exactly the bytes later
        │                         reproduced at verification)
        ▼
signed import attestation  (per document going into the corpus; FILTERED_OUT documents get none
        │                    and need none)
        ▼
verify ALL bindings + manifest completeness  — ONE gate, run ONCE for the whole batch:
        │    • each attestation: signature + document_id + chunk_set_content_hash +
        │      pipeline_version + chunk_policy_version + approver fields
        │    • the whole batch's manifest: completeness scan (negative test #6) — run HERE,
        │      before the first write, not as a scheduled after-the-fact audit
        ▼
        [ single gate — everything above must pass in full ]
        ▼
corpus write  (legal_corpus_chunks — only now, for all approved documents in the batch)
```

**Explicitly forbidden:** `process → write some chunks → discover a manifest/attestation
problem`. If verification of document N+1 fails after documents 1–N have already been written to
the corpus, the gate has already been broken, regardless of whether the individual attestations
for 1–N were valid. Writing to `legal_corpus_chunks` for a batch happens either in full after a
passed batch gate, or not at all for that run.

**Formal invariant:** No pipeline output reaches an authoritative/searchable layer (the canonical
corpus) unless its approval and provenance chain verifies completely — valid signature, every
binding field checked, manifest completeness confirmed for the whole batch — and this happens
**before**, not after, the first write. Same principle already proven in
`QuarantinePromoter.promote()` (Level 2, PROVEN) and specified for
`SourceRegistryArtifactV2`/`HarvestPlan` (registry-convergence) — reused here, not reinvented.

## Out of scope for this ADR

`embedding_vector` is not part of chunk identity/the hash — embeddings are a separate,
recomputable projection; a new embedding-model version does not require new approval of the
underlying chunk content (though it should bump its own `embedding_version` field, out of scope
here). Per-reviewer keys, key rotation, UI, chunking-quality optimization, and additional source
adapters are all explicitly deferred until this gate itself is proven, not before.

## Evidence

- `packages/mps-legal-corpus/tests/CorpusImportGate.test.ts` — all 6 required negative cases,
  both locked precisions (order-sensitivity, numeric-aware paragraph sort), the pre-write
  batch gate (two scenarios: manifest-incomplete batch, binding-invalid batch), a signing-key
  mismatch case, and a happy path.
- Wired into `vitest.config.ts` (`packages/mps-legal-corpus/**/*.test.ts` include, line ~327) —
  confirmed present in this pass.
- Exercised in a real, governed pipeline in
  [LEGAL-CORPUS-MATERIALIZATION-V1-PROVEN.md](./LEGAL-CORPUS-MATERIALIZATION-V1-PROVEN.md) and
  [LEGAL-CORPUS-V1-GOVERNED-MATERIALIZATION-BASELINE.md](./LEGAL-CORPUS-V1-GOVERNED-MATERIALIZATION-BASELINE.md)
  ("CorpusImportGate (unchanged, gate-before-write)" in the proven chain, 11/11 documents
  materialized and replayed with stable identity at commit `53f3b51`).
- This ADR does not itself re-run or re-verify those results — it registers where the invariant's
  canonical text now lives. Proof-status bookkeeping remains the authority map's job (see below).

## Relationship to prior authority

- Historically specified in
  `docs/ops/agent-instructions/TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md` (task-scoped agent
  instruction, non-normative going forward). That document is preserved for historical/operational
  reference — it recorded real implementation work and a self-caught/self-corrected spec deviation
  — but no architecture rule should depend on it as authority. This ADR is the independent,
  canonical statement of the invariant.
- Not previously registered in `docs/architecture/architecture-authority-map.jsonc`. Add an entry
  for `@miljobeslut/mps-legal-corpus` referencing this ADR the next time the authority map is
  updated with full proof-execution bookkeeping (out of scope for this narrow normalization pass
  — see that file's own `proven_criteria`, which requires confirming a named lane actually runs
  the test green, not just that the file exists and is wired).
