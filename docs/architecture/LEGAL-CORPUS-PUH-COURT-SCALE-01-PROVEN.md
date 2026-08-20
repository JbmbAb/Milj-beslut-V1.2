# LEGAL-CORPUS-PUH-COURT-SCALE-01 — FULL PUH COURT CORPUS, PROVEN

**Status:** PROVEN. All 510 unique MMÖD court decisions currently acquired by P2-HARVEST-LIVE-01 are materialized through the governed chain, replayed, and verified — zero PARTIAL, zero FAILED_CLOSED, zero replay drift, zero unexplained duplicates.

## Scope

Exactly the frozen chain proven in Part G and `LEGAL-CORPUS-PUH-COURT-BATCH-01` — no new logic, no chunker changes. Run in five deterministic, sequential slices of 100 (the last of 70) so a real failure could have been isolated to one slice. None was.

## Coverage

| Metric | Count |
|---|---|
| Manifest targets (total objects in the P2 download manifest) | 511 |
| Unique attachments (by content_hash) | 510 |
| Known duplicate attachments | 1 (same decision attached to two publications — the same pattern documented in P2-HARVEST-LIVE-01) |
| Documents attempted | 510 |
| **PROVEN** | **510** |
| PARTIAL | 0 |
| FAILED_CLOSED | 0 |
| Extraction failures | 0 |
| Zero-chunk documents | 0 |
| Replay drift (identity changed between run 1 and run 2) | 0 |
| Duplicate materializations from a replay bug | 0 |

## Chunk statistics

| Metric | Value |
|---|---|
| Total governed court chunks | 20,164 |
| Chunk count per document — min | 1 |
| Chunk count per document — max | 868 |
| Chunk count per document — median | 23.5 |
| Chunk count per document — mean | 39.54 |

**`court_section` distribution** (20,164 chunks): DOMSKÄL 7,418 · YRKANDEN 7,516 · BAKGRUND 2,465 · DOMSLUT 1,645 · ÖVRIGT 551 · SKÄL 569.

**Largest documents by chunk count**, all processed cleanly, including a 24.7 MB PDF:

| File | Chunks | Bytes |
|---|---|---|
| MMOD_2025-06-02_M_15371-22 | 868 | 4.67 MB |
| MMOD_2025-11-20_M_991-25 | 564 | 6.65 MB |
| MMOD_2026-06-25_M_1104-25 | 387 | 3.33 MB |
| MMOD_2025-11-10_Svea_HR_M_4599-24 | 310 | 24.7 MB |
| MMOD_2026-01-26_M_17392-24 | 301 | 1.49 MB |

## Replay status

Every one of the 510 documents was materialized twice against the same persistent database. All 510 replays: identical `canonical_record_key`, identical chunk row count, zero duplicate `LegalCorpusRecord` rows. 510 distinct materialization identities, zero collisions.

## One explained discrepancy — not a contract gap

The database shows **511** MMÖD `LegalCorpusMaterialization` rows and **20,372** chunk rows, not 510 / 20,164. Root cause, verified directly against the two rows in question: the single document used in the earlier Part G pilot (`M 307-24`) was materialized there with `text_projection_version: 'html-extract@1.0'` — a copy-paste artifact in the Part G script, which hardcoded that label for every document regardless of mime type, rather than the correct `pdf-parse@2.4.5` used everywhere else for PDF sources (including this same document when it was re-materialized in `PUH-COURT-BATCH-01`). Since `text_projection_version` is identity-bearing by design (`LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2`), the two runs correctly produced two distinct, immutable materializations of the same underlying document rather than colliding or silently overwriting one another — exactly the behavior the identity model is supposed to produce when a projection label genuinely differs, even though in this one case the difference was a labeling mistake in an earlier ad-hoc script, not a real change in how the text was extracted. This is a tooling inconsistency in a one-off pilot script, not a defect in the frozen chain, and is left as-is rather than silently reconciled — both rows are legitimate, governed, replay-proven materializations under their own recorded identity.

## What this does not claim

- `LEGAL-CHUNKING-LAW-V2.4` (the `"2 a kap."` gap) remains open, untouched, as instructed.
- No embeddings, vector index, or retrieval exist yet.
- This is the full *currently acquired* PUH corpus (MMÖD decisions from 2025-03-04 onward, per the approved source's signed scope) — not all Swedish case law; the pre-2025 / first-instance MMD coverage gap documented earlier in this session remains open and unrelated to this unit.

`LEGAL-CORPUS-PUH-COURT-SCALE-01` is now **PROVEN**: the court-family materialization is no longer pilot-scale — it holds across the entire currently available PUH corpus.
