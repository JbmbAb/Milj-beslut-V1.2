# ADR — Text Projection Contract (TEXT-L1 Freeze)

## Status
**FROZEN** — TEXT-L1 gate

## Decision
Freeze **SourceArtifact → TextProjection** as the reproducible text ingestion boundary.
This is **not** a chunking project. `@miljobeslut/mps-chunking` remains finished for its scope (`text/v2.3`, `archive/v1.0`).

```text
SourceArtifact
      │
      ▼
DocumentIngestion
      │
      ▼
Extraction / OCR   (versioned ports; OCR only when extraction insufficient)
      │
      ▼
TextProjection     ← TEXT-L1 frozen contract
      │
      ▼
DocumentClassification   (separate step — not on TextProjection)
      │
      ▼
mps-chunking text/v2.3
      │
      ├── RAG
      └── Evidence
```

## TEXT-L1 must-be-true

1. `SourceArtifact → TextProjection` has an explicit contract (`@miljobeslut/mps-text-projection`)
2. Extraction and OCR have versioned provenance (`extractor.kind` + `version`, `ocr_used`, optional `ocr`)
3. Projection has its own `content_hash` (SHA-256 over UTF-8 text)
4. Original artifact identity is **never** mutated or replaced by the projection
5. `extraction_status` ∈ `{ complete, partial, failed }` is explicit
6. Same input + same extractor/OCR versions → same `TextProjection` → same v2.3 chunks
7. `mps-chunking` takes only text (+ classification handoff) — not extractor/OCR internals
8. Document classification is a **separate** step after projection
9. Full corpus re-chunk waits until TEXT-L1 is frozen (this gate)

## Freeze surface

```ts
interface TextProjection {
  source_artifact_ref: ArtifactRef;
  text: string;
  extractor: { kind: "pdf-parse" | "ocr" | …; version: string };
  extraction_status: "complete" | "partial" | "failed";
  ocr_used: boolean;
  projection_version: string; // v1.0
  content_hash: { algorithm: "sha256"; value: string };
}
```

`document_class` SHALL NOT live on `TextProjection`.

## Invariant — identity

`TextProjection` MUST NEVER mutate `SourceArtifact` and MUST NEVER replace original bytes identity.

Traceability chain:

```text
chunk → TextProjection → SourceArtifact → original bytes
```

## OCR policy

OCR is not always-on. Decision is explicit and reproducible:

```text
PDF
 ├─ extraction succeeds (≥ threshold) → pdf-parse
 └─ extraction insufficient           → OCR
```

Result MUST record which path was used.

## Package ownership

| Layer | Owner |
|---|---|
| Extraction / OCR adapters | Server ports (outside this package) |
| TextProjection | `mps-text-projection` |
| DocumentClassification | `mps-text-projection` (after projection) |
| Chunking | `mps-chunking` (unchanged) |
| Embedding / CAS | Downstream — not TEXT-L1 |

## Non-goals

- No rebuild of `mps-chunking`
- No more genre rules in chunkers
- No full legal corpus re-chunk until TEXT-L1 green
- No embedding / CAS put in this gate

## Evidence

- `packages/mps-text-projection/tests/textL1FreezeAudit.test.ts`
- Server ports: `server/text-projection/` (`PdfParseExtractorAdapter`, `GeminiOcrAdapter`, `createGovernedTextIngestion`)
- Controlled sample (not full rechunk): `packages/mps-text-projection/tests/sampleCorpusControlled.test.ts`

## Gate chain

```text
TEXT-L1 TextProjection contract     FROZEN
       │
       ▼
TEXT-L2 Adapter → Projection       see ADR-TEXT-L2-Adapter-Projection.md
       │
       ▼
L3 Controlled v2.3 corpus test     (not started)
       │
       ▼
GO → full corpus migration
```
