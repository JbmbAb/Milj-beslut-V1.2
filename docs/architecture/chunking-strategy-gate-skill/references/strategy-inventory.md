# Strategy inventory — packages/mps-chunking (as of 2026-08-10)

This is a snapshot to orient you quickly. The code is the source of truth — re-check the referenced files before making any claim about current behavior, since this document will drift.

## The four approved `TextChunkKind`s

All four are pure, deterministic functions over `sanitizeForChunking(text)` output, and all lean on the shared boundary-splitter for any piece that runs long.

### `law` — `chunkSwedishLaw()` in `src/text/LegalChunker.ts`
- Assumes SFS-style statute structure.
- Splits on lookahead `/(?=\b\d+\s*[a-z]?\s*§)/i` — a `§`-boundary like `6 §` or `6 a §`.
- Tracks chapter separately via `/(\d+)\s+kap\./i`; chunks are tagged with `chapter` + `paragraph` metadata.
- A whole `§`-block is one chunk unless it exceeds `MAX_CHUNK_CHARS` (1500), in which case `splitWithBoundary` subdivides it.
- Routed to (via `routeToCorrectChunker`) when `sourceSystem` contains `sfs|riksdagen|lagrummet`, or `docName` contains `miljöbalken|plan- och bygglagen|pbl ` (note the trailing space).

### `court` — `chunkCourtDecision()` in `src/text/LegalChunker.ts`
- Assumes Swedish court-decision structure.
- Splits on section headers matching `DOMSLUT|DOMSKÄL|YRKANDEN|BAKGRUND|SKÄL`.
- Sub-splits each section on blank-line paragraphs; drops fragments under `MIN_CHUNK_CHARS` (20 chars).
- Routed to when `sourceSystem` contains `domstol|möd|mmd|mark- och miljö`, or `docName` contains ` dom ` / `mö` / starts with `m `.

### `evidence` — `EvidenceChunker.ts` (`detectSections` + `generateEvidenceChunks`)
- Built for environmental-permit evidence bundles, not law/court text.
- `detectSections(text, docType)` — `docType` is one of `decision | mkb | technical_description | control_program`, each with its own hard-coded Swedish marker regex list (e.g. `VILLKOR`, `BULLERMÄTNING`, `VATTENKONTROLL`). Unknown `docType` → single `GENERAL` section.
- Also extracts cross-document `relations` (e.g. `controlled_by → control_program`) via keyword sniffing (`buller`, `vatten`, `kontrollprogram`) — the only strategy that does this.
- Uses its own length constants: `EVIDENCE_MAX = 1000` / `EVIDENCE_OVERLAP = 150` (not the shared 1500/225).
- **Not** filename/source auto-routed — only reachable via an explicit `kind`/`evidenceDocType` passed into `chunkTextStructure`.

### `standard` — `chunkStandard()` in `src/text/LegalChunker.ts`
- Fallback. Naive blank-line paragraph split, no structural assumptions.
- Still filters sub-`MIN_CHUNK_CHARS` paragraphs and boundary-splits long ones with the default 1500/225.
- This is what `routeToCorrectChunker` falls through to for anything not matching the law/court patterns above.

## Shared plumbing

- **`splitWithBoundary.ts`**: `MAX_CHUNK_CHARS = 1500` (~300 words), `OVERLAP_CHARS = 225` (~15%), `MIN_CHUNK_CHARS = 20`. Cut-point priority: paragraph break (`\n\n`) → sentence break (`. `/`! `/`? `/`.\n`) → whitespace — only honored if the break is at or past 60% of the limit, otherwise hard-cut. Overlap start snaps forward to a word/line boundary. Callers may override `limit`/`overlap` (as `EvidenceChunker` does).
- **`sanitize.ts`**: `sanitizeForChunking()` repairs mojibake (scored heuristic re-decode) then normalizes whitespace/newlines, deliberately preserving `\n\n` paragraph boundaries since every downstream strategy depends on them.

## Routing vs. classification — two different, only-one-live seams

- **`routeToCorrectChunker(rawText, docName, sourceSystem)`** in `TextStructureChunker.ts` — filename/source-string substring matching only, no content inspection. This is what `scripts/db/rechunk-legal-corpus.ts` (the live production backfill) actually calls.
- **`DocumentClassifier.classifyDocument()`** in `packages/mps-text-projection/src/classification/` — a more content-aware classifier (checks `domskäl`/`domslut` in the first 2000 chars, `villkor och försiktighetsmått` / `beslutets innebörd` markers, etc.), paired with `ChunkContractResolver` to pick a contract, wired together in `TextIngestionPipeline`. This pipeline is built and tested but **not called from any production route, script, or job** as of this writing — verify this hasn't changed before assuming it's still dormant.

If you're proposing a routing fix, say explicitly which of these two you're changing, and whether that's the one that's actually live.

## Invariants (from `src/core/`, backed by `ADR-CHUNKING-Subsystem.md`)

- **Two contracts only**: `"text" | "archive"`. `ChunkTypes.ts` has an explicit doc comment: this is deliberately not a `UniversalChunker`.
- **Separate version namespace per contract** (`ChunkVersion.ts`): currently `TEXT_CHUNK_VERSION = "v2.3"`, `ARCHIVE_CHUNK_VERSION = "v1.0"`. Any output-changing logic requires a version bump — old and new outputs are compared and rejected on mismatch.
- **Determinism**: identical input → byte-identical chunks, same order, same count. Verified by `ChunkVerifier.verifyManifestsEqual()` (fail-closed, explicit `REJECT_CHUNK_*` reason codes) and covered by `textDeterminism.test.ts` / `archiveDeterminism.test.ts`.
- **Chunk identity** (`ChunkHasher.ts`): sha256 of the exact UTF-8 chunk text. A single trimmed whitespace character changes identity.
- **Text contract accepts strings only**, never bytes/Buffer (`REJECT_TEXT_CONTRACT`); archive contract is the reverse.

## Production consumers (who actually depends on this)

- `scripts/db/rechunk-legal-corpus.ts` — DB backfill, calls `routeToCorrectChunker` directly, version-gated on `text/v2.3`.
- `server/modules/legal/services/semanticChunker.ts` — thin re-export shim of `LegalChunker` functions.
- `server/modules/legal/services/evidenceExtractionService.ts` — calls `detectSections`/`generateEvidenceChunks` directly for the permit-evidence import path.
- `packages/mps-text-projection` — depends on `mps-chunking` for its (currently unwired) classification pipeline.
