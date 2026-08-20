# LEGAL CORPUS V1 — TEXT/STRUCTURE BASELINE

**Status:** FROZEN. This is the coverage snapshot of the governed legal corpus (acquisition ->
projection -> chunk admission -> materialization -> replay) at the point where `law` chunking
gains a second, coexisting proven policy version. It exists to draw a clean line under
text/structure work before embeddings, vector indexing, or retrieval/RAG begin.

All numbers below are read directly from the live database (`legal_corpus_materializations`,
`legal_corpus_materialized_chunks`, `legal_corpus_records`), not from script self-reports, and
are scoped explicitly to `chunk_policy_version IN ('legal-chunker-v2.3', 'legal-chunker-v2.4')` --
see "Excluded from this baseline" for what that scoping deliberately leaves out and why.

## Acquisition (P2-HARVEST-LIVE-01)

| Metric | Count |
|---|---|
| Approved sources attempted | 11 |
| PROVEN | 10 |
| FAILED_CLOSED | 1 (`boverket-planbestammelser` — dead endpoint; real replacement endpoint found at `api-portal.boverket.se` during live investigation but deliberately NOT silently substituted — open as `BOVERKET-SOURCE-REDISCOVERY-01`) |

Full detail: [`P2-HARVEST-LIVE-01-PROVEN.md`](P2-HARVEST-LIVE-01-PROVEN.md).

## Materialization — law v2.3

**Baseline chunker.** `chunkSwedishLaw` (`packages/mps-chunking/src/text/LegalChunker.ts`) --
paragraph-aware chunking with verified `§`/`kap.` markers; does not capture letter-suffixed
chapters (`"2 a kap."`).

| Source | logical_source_id | Materializations | Chunk rows |
|---|---|---|---|
| Miljöbalk (1998:808) | `regeringskansliet-sfs-1998-808` | 1 | 1,658 |
| Miljöprövningsförordning (2013:251) | `regeringskansliet-sfs-2013-251` | 1 | 584 |
| Avfallsförordning (2020:614) | `regeringskansliet-sfs-2020-614` | 1 | 792 |
| Plan- och bygglag (2010:900) | `regeringskansliet-sfs-2010-900` | 1 | 1,523 |
| Förordning om miljöfarlig verksamhet och hälsoskydd (miljötillsyn) (2011:338) | `regeringskansliet-sfs-2011-338` | 1 | 593 |
| Förordning om miljöfarlig verksamhet och hälsoskydd (1998:899) | `regeringskansliet-sfs-1998-899` | 1 | 324 |
| **SFS family total (6 documents)** | | **6** | **5,474** |
| HVMFS 2016:17 (små avlopp) | `hav-hvmfs-2016-17` | 1 | 2 |
| SGU — influensområde grundvatten (analytiska modeller) | `sgu-groundwater-influence-analytical-models` | 1 | 4 |
| SGU — vägledning för att borra brunn | `sgu-well-drilling-guidance` | 1 | 7 |
| **standard family total (3 documents)** | | **3** | **13** |
| MMÖD court decisions (all 510 unique + 1 Part G duplicate identity, see below) | `domstolsverket-puh-mmod` | 511 | 20,372 |

**law v2.3 total: 6 materializations, 5,474 chunk rows, 0 letter-suffixed chapters captured
(known limitation, by design — see [`LEGAL-CORPUS-PUH-COURT-SCALE-01-PROVEN.md`](LEGAL-CORPUS-PUH-COURT-SCALE-01-PROVEN.md)
for the court family and above for `standard`).**

All figures in this table and below are parent-materialization-scoped (chunk rows counted
against the `chunk_policy_version` recorded on their owning `legal_corpus_materializations` row,
not any per-chunk label) and independently re-verified via direct database queries after the
first draft of this document surfaced a counting error — see "Excluded from this baseline" for
what that re-verification found and removed.

## Materialization — law v2.4

**Versioned improvement, proven on one real governed source.** `chunkSwedishLawV24`
(`packages/mps-chunking/src/text/LegalChunker.ts`) adds letter-suffixed chapter capture
(`"2 a kap." -> "2 a"`) and a bounded cross-reference boundary mitigation. A new, separately
versioned function — `chunkSwedishLaw` (v2.3) is unmodified and independently regression-tested.
`chunk_policy_version` is identity-bearing (`LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2`), so a v2.4
materialization of the same raw source is a distinct, immutable row, never an overwrite of its
v2.3 counterpart.

**`LEGAL-CORPUS-LAW-V2.4-REMATERIALIZATION-01`** rematerialized Miljöbalk (1998:808) — the exact
same real quarantined bytes, download manifest, and projection already used for the v2.3 row
above — under `chunk_policy_version = 'legal-chunker-v2.4'`.

| | v2.3 | v2.4 | delta |
|---|---|---|---|
| Admitted | 1,658 | 1,357 | −301 (fewer spurious boundary splits from cross-references being correctly merged back) |
| Rejected | 1 | 1 | unchanged |
| Chapter labels | 33 (all plain numeric) | 35 (33 plain numeric + 2 letter-suffixed) | +2 letter-suffixed chapters newly captured |
| Letter-suffixed chapters found | 0 | 2: `"17 a"` (1 chunk), `"10 a"` (1 chunk) | see below |
| fragment_ids | — | — | 100% distinct from v2.3's (chunk_policy_version is part of the fragment_id hash input) |
| materialization_id | `canonical:legal-corpus:c36b2f1d...` | `canonical:legal-corpus:cad01758...` | distinct, both present in DB |

**Real value demonstrated:** `"17 a kap."` is a genuine (now-repealed) Miljöbalken chapter
heading — v2.3 cannot capture it at all (falls through to the honest
`"(ingen kapitelindelning)"` marker or an incorrect default); v2.4 correctly labels it `"17 a"`.

**Known drift, honestly reported, not fixed by this unit:** the second letter-suffixed match,
`"10 a"`, is **not** a real Miljöbalken chapter heading — it is a cross-reference to a *different*
statute (`sjölagen (1994:1009)`, "...omfattas av 10 eller 10 a kap. sjölagen...") embedded inside
paragraph 19's body. `chapMatch` (in both `chunkSwedishLaw` and `chunkSwedishLawV24`) scans the
*whole* paragraph fragment for a `"N[ x] kap."` pattern rather than anchoring to the fragment's
start, so this embedded mention overwrites `currentChapter` for that one fragment. This is a
pre-existing limitation shared with v2.3 (which has the same unanchored match for plain numeric
`"N kap."` cross-references); letter-suffix support makes it reachable by one additional real
phrasing, but does not introduce the underlying flaw. Affects exactly 1 of 1,357 admitted v2.4
chunks in this document. Left open as a candidate for a future, separately scoped unit (anchoring
`chapMatch` to the fragment start) — not addressed here per the narrow scope of this unit.

**Replay and coexistence, proven directly against the live database (not script self-report):**

| Check | Result |
|---|---|
| v2.3 materialization (`c36b2f1d...`) still exists after the v2.4 run | yes |
| v2.3 row: same primary key, same chunk count (1,658), same `createdAt` before/after | yes — byte-for-byte untouched |
| v2.4 materialization_id distinct from v2.3's | yes |
| v2.4 replay (run 1 vs run 2): same materialization_id | yes |
| v2.4 replay: same chunk row count (1,357 vs 1,357) | yes |
| v2.4 replay: duplicate `legal_corpus_records` rows for this key | 0 |
| v2.4 replay: identity stable (`documentId` run1 == run2) | yes |

`LEGAL-CORPUS-LAW-V2.4-REMATERIALIZATION-01`: **PROVEN.**

**law v2.4 total: 1 materialization (Miljöbalk only — deliberately not yet applied to the other 8
law/standard single-endpoint sources; see "What this does not claim"), 1,357 chunk rows.**

## Chunk policies present in the governed corpus

| `chunk_policy_version` | Materializations | Chunk rows | Scope |
|---|---|---|---|
| `legal-chunker-v2.3` | 520 (6 law + 3 standard + 511 court) | 25,859 (5,474 law + 13 standard + 20,372 court) | full governed corpus baseline |
| `legal-chunker-v2.4` | 1 | 1,357 | Miljöbalk only, proof-of-real-value |

**Grand total, real governed corpus: 521 materializations, 27,216 chunk rows.**

## Court family (unchanged in this unit — reconfirmed present and untouched)

510 unique MMÖD decisions, 511 materialization rows (1 explained duplicate identity from an
earlier pilot script's mislabeled `text_projection_version` — see
[`LEGAL-CORPUS-PUH-COURT-SCALE-01-PROVEN.md`](LEGAL-CORPUS-PUH-COURT-SCALE-01-PROVEN.md) for the
full, previously-frozen explanation; not touched or revisited by this unit).

`court_section` distribution (20,372 chunk rows — 208 more than the 20,164 reported in
`PUH-COURT-SCALE-01` because that count predates this session's re-verification pass; the extra
208 rows all belong to the same known-duplicate Part G identity, not new drift): DOMSKÄL 7,495 ·
YRKANDEN 7,626 · BAKGRUND 2,465 · DOMSLUT 1,665 · SKÄL 569 · ÖVRIGT 552.

## Excluded from this baseline

- **`legal_corpus_materializations` rows with `logical_source_id` starting
  `pilot-persistence-proof-...`** (4 rows total: 3 under `chunk_policy_version = 'unknown'` /
  `'legal-chunker-v2.4-test'`, plus 1 more that happens to carry the real
  `'legal-chunker-v2.3'` label at the parent level; 8 chunk rows total, all with
  `corpus_record.title = "Persistence proof synthetic document"`): these are
  `LEGAL-CORPUS-CHUNK-PERSISTENCE-V1`'s own F2 replay/rechunk proof-script fixtures (synthetic
  content used to test identity-divergence behavior, not real acquired sources). Correctly
  excluded from every count above; caught during this document's own verification pass, which is
  why every figure above is stated as parent-materialization-scoped and independently re-queried,
  not taken from any script's self-reported totals.
- **`source_family IN ('LOCAL_ARCHIVE', 'FOUNDATION')`** (5 + 6 = 11 `legal_corpus_records`,
  dated 2026-08-09): pre-existing local/foundation data seeded before P2-HARVEST-LIVE-01 and the
  governed materialization chain existed. Not part of this governed pipeline; not counted above.

## What this does not claim

- v2.4 has **not** been applied to the other 8 already-materialized law/standard single-endpoint
  sources (the 5 remaining SFS ordinances, HVMFS, the 2 SGU guidance documents). This baseline
  proves v2.4 works correctly and coexists immutably with v2.3 on one real, structurally-relevant
  source — it does not claim v2.4 is the corpus-wide policy. A bulk rechunk-under-v2.4 migration,
  if wanted, is a separate, explicitly deferred decision.
- The known cross-statute chapter-mislabel drift (unanchored `chapMatch`) is documented, not
  fixed, here.
- `LEGAL-CHUNKING-LAW-V2.4`'s cross-reference mitigation remains a bounded content heuristic, not
  a structural guarantee (TEXT-L1 projection preserves no newlines — see the module-level doc
  comment in `LegalChunker.ts`).
- No embeddings, vector index, or retrieval/RAG exist yet.
- `boverket-planbestammelser` remains FAILED_CLOSED; the pre-2025 / first-instance MMD case-law
  coverage gap remains open. Both are unrelated to, and unaffected by, this unit.

This freezes the text/structure baseline. `law v2.3` is the corpus-wide baseline; `law v2.4` is a
versioned improvement proven real on governed content, ready for a separately-decided rollout.
