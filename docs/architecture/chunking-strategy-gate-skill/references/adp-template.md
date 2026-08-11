# Architecture Decision Proposal — New Chunking Strategy

**Status:** Proposed — awaiting human decision. Not approved. Do not implement until a decision is recorded.
**Date:** <YYYY-MM-DD>
**Proposer:** Claude, in a session with <user>
**Scope:** `packages/mps-chunking` — `text` contract (`text/vX.Y`)

This follows the same fail-closed pattern as `docs/architecture/TV-3.3-Document-Chunk-Partition-Decision-Template.md`: a filled decision record is required before any implementation. Until then, the default is to route the document(s) through the closest existing strategy and accept the known structural loss, or leave them unprocessed — never to silently ship a new/blended chunker.

---

## 1. Document sample examined

- Source(s) / example file(s):
- Approximate volume (how many documents of this shape, expected to grow?):
- Representative excerpt or structural outline (headings, numbering scheme, lists, tables — whatever is distinctive):

## 2. Why no existing approved strategy fits

Go through all four — don't skip ones that seem obviously wrong, since "obviously wrong" is exactly what needs to be on record:

| Strategy | Structural signal it assumes | Why it doesn't fit here |
|---|---|---|
| `law` (`chunkSwedishLaw`) | `§`-numbering, `X kap.` chapters | |
| `court` (`chunkCourtDecision`) | `DOMSLUT/DOMSKÄL/YRKANDEN/BAKGRUND/SKÄL` headers | |
| `evidence` (`EvidenceChunker`) | Permit-bundle markers (`VILLKOR`, `BULLERMÄTNING`, ...) | |
| `standard` (`chunkStandard`) | Blank-line paragraphs only | (state precisely what structure this would flatten/lose) |

## 3. Sketch of a possible new strategy

This is a starting point for discussion, not a spec to implement yet.

- Proposed `TextChunkKind` name:
- Structural boundary signals it would split on:
- Proposed length/overlap parameters, and why they'd differ from the shared 1500/225 default:
- Metadata fields it would need to attach per chunk:
- Anything about this document type that makes deterministic, order-stable chunking non-trivial (e.g. inconsistent OCR output, no reliable heading markup):

## 4. Invariants it would need to satisfy

- Contract: `text` (not `archive`) — confirm this is prose/structured-text content, not raw bytes.
- Version: would require bumping `TEXT_CHUNK_VERSION` past the current `text/v2.3`; existing `law`/`court`/`evidence`/`standard` outputs for already-chunked documents must be unaffected.
- Determinism: same input must always produce byte-identical chunks in the same order — flag if anything about the source format makes this hard to guarantee.
- Identity: chunk hash = sha256 of exact chunk text; note if the new strategy needs any chunk-level metadata beyond what `ChunkBase` already carries.

## 5. Non-goals of this proposal

- Does not modify `chunkSwedishLaw`, `chunkCourtDecision`, `chunkStandard`, or `EvidenceChunker`.
- Does not touch the `archive/v1.0` contract.
- No code has been written. This is a decision request only.

## 6. Requested decision

- [ ] **Approve** — add new `TextChunkKind`, bump `TEXT_CHUNK_VERSION`, proceed to implementation in a follow-up.
- [ ] **Reject** — route these documents through `<existing strategy>` instead; structural loss described in §2 is accepted.
- [ ] **Defer** — insufficient evidence; need more document samples before deciding.

**Decision:** _____________  **Decided by:** _____________  **Date:** _____________
