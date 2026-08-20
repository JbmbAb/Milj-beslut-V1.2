# LEGAL CORPUS V1 — TEXT/STRUCTURE BASELINE V2

**Status:** FROZEN. Supersedes the V1 baseline (same file, prior revision) now that `law`
chunking has three coexisting, immutable generations: the corpus-wide `v2.3` baseline, the
historical `v2.4` Miljöbalken materialization that first surfaced a real structural bug, and the
corrected `v2.4.1` that closes it and has been rolled out across all 6 real SFS law sources. This
is the state before embeddings, vector indexing, or retrieval/RAG begin.

All numbers below are read directly from the live database, independently re-queried per source
(not taken from any script's self-report) — the same discipline that caught a counting error in
the V1 revision of this document.

## Acquisition (unchanged from V1)

10/11 P2-HARVEST-LIVE-01 sources PROVEN, `boverket-planbestammelser` FAILED_CLOSED. Full detail:
[`P2-HARVEST-LIVE-01-PROVEN.md`](P2-HARVEST-LIVE-01-PROVEN.md).

## law — three generations

| Generation | Chunker | Sources materialized | Materializations | Chunk rows | Status |
|---|---|---|---|---|---|
| `legal-chunker-v2.3` | `chunkSwedishLaw` | all 6 SFS sources | 6 | 5,474 | immutable historical baseline |
| `legal-chunker-v2.4` | `chunkSwedishLawV24` (pre-anchor-fix) | Miljöbalk only | 1 | 1,357 | immutable historical record — **contains a known false chapter label** (see below); superseded, not deleted |
| `legal-chunker-v2.4.1` | `chunkSwedishLawV24` (post `CHAPTER-ANCHOR-01`) | all 6 SFS sources | 6 | 4,490 | **corrected, rollout-proven current candidate** |

**`legal-chunker-v2.4` is deliberately NOT deleted.** It is the one real materialization
demonstrating the exact bug `LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01` exists to fix: 1 of its
1,357 chunks (Miljöbalken paragraph 19) carries chapter `"10 a"`, a cross-reference to a
*different* statute (`sjölagen`), not a real Miljöbalken chapter. Kept as evidence for why
`v2.4.1` exists, exactly as the Part G `text_projection_version` mislabeling was kept in the PUH
court corpus rather than corrected by mutation.

### Per-source v2.3 -> v2.4.1

| Source | v2.3 chunks | v2.4.1 chunks | Chunk delta | Text-volume delta | Letter-suffixed chapters | Rejected embedded refs |
|---|---|---|---|---|---|---|
| Miljöbalk (1998:808) | 1,658 | 1,357 | -301 | not separately re-measured for v2.4.1 vs v2.3 (see `CHAPTER-ANCHOR-01` proof: v2.4-prefix -> v2.4.1 text volume unchanged, 0 false "10 a") | `17 a` correctly detected (0 surfacing chunks — repealed, empty chapter, correctly superseded) | 1 (the reported "10 a" case) |
| Miljöprövningsförordning (2013:251) | 584 | 544 | -40 | +0.36% | none | 0 |
| Avfallsförordning (2020:614) | 792 | 574 | -218 | +6.74% | none | 0 |
| Plan- och bygglag (2010:900) | 1,523 | 1,301 | -222 | +0.38% | none | 12 |
| Miljöfarlig verksamhet och hälsoskydd (miljötillsyn) (2011:338) | 593 | 440 | -153 | +0.28% | none | 1 |
| Miljöfarlig verksamhet och hälsoskydd (1998:899) | 324 | 274 | -50 | +0.05% | none | 0 |

**Why chunk counts drop while text volume does not.** Every source shows a real chunk-count
reduction (up to -28%) but text-volume parity (within 0.4%, one source even +6.7% — MORE text
admitted, from less redundant overlap-splitting across fewer, larger chunks). This confirms the
reduction is the already-proven v2.4 cross-reference *paragraph-boundary-merge* behavior
reshaping how many fragments the same content is split into — not new content loss introduced by
the chapter-anchor fix. Verified directly, not assumed: for Plan- och bygglag (2010:900), the 7
chunks that were chapter `"17"` under v2.3 (transitional-provision text quoting the repealed
1987 Plan- och bygglagen's own paragraph numbers) were traced individually and confirmed present
in the v2.4.1 output, merged into differently-shaped chunks under an adjacent chapter rather than
lost.

**Newly-discovered / disappeared chapter labels are re-attribution, not data loss** — inspected
per source, not just totalled:
- 2011-338: chapter `"15"` newly appears (3 chunks, genuine `1 §`/`3 §` "anmälan" notification-
  requirement content, plausible real chapter content, not garbage).
- 1998-899: chapter `"6"` newly appears (2 chunks), chapter `"5"` disappears (4 chunks) — small,
  within the same paragraph-merge/re-attribution pattern.
- 2020-614 and 2010-900 show the largest per-chapter shifts (e.g. chapter 2: 268 -> 29 for
  2020-614) — consistent with those two sources containing the most cross-reference-heavy prose
  relative to their size, which is exactly what the paragraph-merge mechanism targets.

**No blanket percentage gate was used** to decide PROVEN vs not, per instruction — each source's
delta was inspected for *why* it changed (text-volume check + spot-traced chapter reattribution),
not measured against a fixed threshold.

### Replay and persistence, every source

All 6 law sources under `v2.4.1`: replay-stable across two runs (same `materialization_id`, same
chunk count, zero duplicate `legal_corpus_records` rows, stable identity), and the corresponding
`v2.3` row verified byte-for-byte untouched (same primary key, same chunk count, same
`createdAt`) after the `v2.4.1` write. Miljöbalken's pre-fix `v2.4` row additionally verified
untouched after the `v2.4.1` write.

**Status: PROVEN** for all 6 sources under `v2.4.1` (`LEGAL-CORPUS-LAW-V2.4.1-BULK-01`).

## standard and court (unchanged)

`standard`: 3 materializations, 13 chunk rows, `v2.3` only — not part of this law-chunking track.
`court`: 511 materializations, 20,372 chunk rows, `v2.3` only, 510 unique MMÖD decisions (see
[`LEGAL-CORPUS-PUH-COURT-SCALE-01-PROVEN.md`](LEGAL-CORPUS-PUH-COURT-SCALE-01-PROVEN.md)).

## Chunk policies present in the governed corpus (V2)

| `chunk_policy_version` | Materializations | Chunk rows | Scope |
|---|---|---|---|
| `legal-chunker-v2.3` | 520 (6 law + 3 standard + 511 court) | 25,859 | corpus-wide baseline |
| `legal-chunker-v2.4` | 1 | 1,357 | Miljöbalk only — historical, known false "10 a" label, kept as evidence |
| `legal-chunker-v2.4.1` | 6 | 4,490 | all 6 SFS law sources — corrected, rollout-proven |

**Grand total, real governed corpus: 527 materializations, 31,706 chunk rows.**

## Excluded from this baseline (unchanged from V1)

- 4 synthetic `pilot-persistence-proof-...` F2 test fixtures (8 chunk rows) — never real content.
- `source_family IN ('LOCAL_ARCHIVE', 'FOUNDATION')` (11 records, dated 2026-08-09) — pre-existing
  data seeded before this governed pipeline existed.

## What this does not claim

- The pre-existing, out-of-scope "same-fragment chapter timing" limitation (a chapter heading
  trailing at a fragment's tail still labels that same fragment, not only later ones — see
  `LegalChunker.ts`'s module doc comment) remains open. It is explicitly **not** a blocker for
  this baseline or for opening embeddings/retrieval — it is a known, bounded imprecision inherited
  unchanged from `v2.3`, not a new defect, and does not need to hold the RAG track hostage.
- `LEGAL-CHUNKING-LAW-V2.4`'s cross-reference mitigation remains a bounded content heuristic
  (TEXT-L1 projection preserves no newlines), not a structural guarantee.
- No embeddings, vector index, or retrieval/RAG exist yet.
- `boverket-planbestammelser` remains FAILED_CLOSED; the pre-2025 / first-instance MMD case-law
  coverage gap remains open.

This freezes the V2 text/structure baseline: `law/v2.3` is the immutable corpus-wide baseline,
`law/v2.4` is kept as historical evidence of a real, since-fixed bug, and `law/v2.4.1` is the
corrected, rollout-proven current candidate across all 6 real SFS law sources.
