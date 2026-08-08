# ADR — TEXT-L2 Adapter → Projection Integration

## Status
**Acceptance gate** — TEXT-L2

## Depends on
TEXT-L1 Text Projection Freeze (**FROZEN**)

## Decision
All real extraction/OCR paths deliver into the frozen TextProjection contract via ports.
`mps-chunking` is not modified. No full corpus rechunk (that is L3).

```text
SourceArtifact
      │
      ▼
ExtractionPort
      ├── PdfParseExtractorAdapter
      └── OcrAdapter (Gemini / external)
      │
      ▼
TextProjectionBuilder   ← sole projection factory
      │
      ▼
TextProjection          ← TEXT-L1 frozen
      │
      ▼
DocumentClassifier
      │
      ▼
ChunkContractResolver
      │
      ▼
mps-chunking text/v2.3
```

## L2 is green only when

1. Existing extraction/OCR paths go through ports (`extractTextViaPorts` / adapters)
2. Only `TextProjectionBuilder` creates `TextProjection`
3. `SourceArtifact` remains unmutated
4. Provenance fields are complete (`extractor`, `extraction_status`, `ocr_used`, versions, `content_hash`, `source_artifact_ref`)
5. `document_class` comes after projection
6. Same path + same version → identical `content_hash`
7. OCR-fallback is explicit and verifiable
8. v2.3 chunking works for the controlled sample corpus
9. `semanticChunker` re-exports still work
10. No embeddings or RAG-ranking changes

## Explicitly out of scope

- L3 controlled / full corpus rechunk
- OCR quality improvements
- New document genres
- Chunk algorithm changes
- Embeddings / RAG ranking

## Evidence

`packages/mps-text-projection/tests/textL2AcceptanceAudit.test.ts`  
Server: `server/text-projection/`
