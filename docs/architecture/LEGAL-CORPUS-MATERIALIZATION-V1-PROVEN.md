# LEGAL CORPUS MATERIALIZATION V1 — REAL GOVERNED PILOT, PROVEN

**Status:** PROVEN. Governed projection → classification → chunk admission → materialization → replay works end to end against real acquired content, across all three structure families this repo currently supports (`law`, `court`, `standard`).

## Chain proven

```
P2 quarantined raw bytes (proven live in P2-HARVEST-LIVE-01)
  → TEXT-L1 projection (PdfParseExtractorAdapter — real pdf-parse for PDF, real tag-stripping for HTML)
  → classification (document family → chunk strategy)
  → LEGAL-CHUNK-ADMISSION-V1 (family-aware, no fabricated structure)
  → LEGAL-CHUNK-IDENTITY-V2 (canonical, content-addressed fragment_id)
  → CorpusImportGate (unchanged, gate-before-write)
  → GovernedLegalCorpusMaterializer (one transaction: record + provenance + governed chunk rows)
  → replay (second run, same persistent state)
```

## Three-document pilot results

| # | Document | Family | Chunks admitted | Chunks rejected | Chunk rows | Replay: same materialization id | Replay: same chunk count | Duplicates |
|---|---|---|---|---|---|---|---|---|
| 1 | SFS Miljöbalken (1998:808), real HTML | `law` | 1658 | 1 | 1658 | ✓ | ✓ | none |
| 2 | SGU groundwater guidance, real HTML | `standard` | 4 | 0 | 4 | ✓ | ✓ | none |
| 3 | MMÖD court decision M 307-24, real PDF | `court` | 208 | 0 | 208 | ✓ | ✓ | none |

All three used **real raw bytes already quarantined by P2-HARVEST-LIVE-01** — no re-acquisition, since acquisition was proven separately. All three ran twice against the same persistent database state; every replay reproduced the identical `canonical_record_key`, identical chunk row count, and zero duplicate rows.

## The three required proof points

1. **SFS**: real `chapter`/`paragraph` values as strings throughout (e.g. chapter `"7"` paragraph `"2"`, chapter `"10"` paragraph `"32"`) — never `"0"`, never fabricated. One fragment (the pre-first-§ chapter heading prose) correctly rejected, producing `STRUCTURE_PARTIAL` rather than a blanket pass or a false rejection of the whole document.
2. **Regulatory HTML**: proved with a **fresh, independent live fetch** against the real SGU endpoint (not just the stored quarantine object) — raw bytes differ from the original acquisition (confirmed, different SHA-256, the known server-generated per-render navigation id), but the projected text is **byte-identical** (same SHA-256) to the stored fetch's projection. The volatility is fully absorbed at the projection layer; it never reaches corpus text or chunk identity.
3. **PUH court decision**: 208 chunks, all admitted, zero rejected — `court` never gated on law structure. `court_section` values (`DOMSLUT`, `YRKANDEN`, `ÖVRIGT`, ...) are all real marker-derived labels, `ÖVRIGT` used as an honest catch-all where no marker matched. Zero chunks carry any `chapter`/`paragraph` field — confirmed structurally, not just by convention.

## Defect found and fixed during this pilot

Running the **full, real** Miljöbalken (not a short hand-written fixture) through `admitLawChunks` surfaced a real chunk-ordering bug: a cross-reference like *"se 10 kap. 32 §"* inside a chapter 7 paragraph's body confused `chunkSwedishLaw`'s regex-based boundary detection into emitting one fragment out of canonical order. `computeChunkSetContentHash` correctly refused to hash it (`ChunkOrderError`) rather than silently accepting an unordered set. Fixed in `ChunkAdmission.ts`: every admitter now calls `orderChunksDeterministically()` on its output before returning, as `ChunkIdentity.ts` already documents producers must do. This is exactly the kind of defect a short fixture could never have surfaced — worth noting as the reason the pilot used real, full-scale content rather than trimmed test documents.

## Not in scope for this freeze

Bulk materialization of the remaining 7 already-live-proofed sources, embeddings, vector indexing, retrieval/RAG. This document proves the materialization pipeline itself, on three representative documents — a deliberate choice, not a shortcut: enough to reveal whether `law`/`court`/`standard` genuinely hold, without the cost of discovering a model-level defect after populating hundreds of documents.

`LEGAL CORPUS MATERIALIZATION V1` is now **PROVEN** on a real governed pilot, at commit `53f3b51`.
