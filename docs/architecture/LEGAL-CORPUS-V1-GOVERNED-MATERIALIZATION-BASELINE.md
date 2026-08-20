# LEGAL CORPUS V1 — GOVERNED MATERIALIZATION BASELINE

**Status:** PROVEN. The governed chain — acquisition → projection → classification → chunk admission → materialization → replay — now covers all 10 currently-live-proofed single-scope sources plus one representative PUH court decision, with zero unresolved defects and zero unexplained rejections.

## Chain

```
P2-HARVEST-LIVE-01 (governed acquisition, PROVEN)
  → TEXT-L1 projection (real pdf-parse / real HTML tag-stripping)
  → classification (document family → chunk strategy)
  → LEGAL-CHUNK-ADMISSION-V1 (family-aware, no fabricated structure)
  → LEGAL-CHUNK-IDENTITY-V2 (content-addressed, chunk-policy-bound)
  → CorpusImportGate → GovernedLegalCorpusMaterializer (one transaction)
  → replay (proven per source, against the same persistent database)
```

## Coverage

| Metric | Count |
|---|---|
| Sources acquired live (P2-HARVEST-LIVE-01) | 11 (10 PROVEN, 1 FAILED_CLOSED — `boverket-planbestammelser`) |
| Sources materialized | 10 of 10 acquired-PROVEN sources (100%), plus 1 representative PUH court decision |
| Documents materialized | 11 |
| Documents PROVEN (materialization + replay) | 11 / 11 |
| Law paragraphs (`law` family, real chapter/paragraph) | 5,474 |
| Court chunks (`court` family) | 208 |
| Standard/guidance chunks (`standard` family) | 13 |
| **Total governed chunk rows** | **5,695** |
| Rejected fragments (all `NOT_ADMITTED_TO_PARAGRAPH_CORPUS`, all the same class: pre-first-§ heading prose) | 6 |
| Sources PARTIAL | 0 |
| Sources FAILED_CLOSED (materialization) | 0 |
| Replay: identity stable | 11 / 11 |
| Replay: duplicate rows | 0 / 11 |
| Replay: identity drift | 0 / 11 |

## Per-source detail

| source_id | family | authority | chunks admitted | chunks rejected | chunk rows | STATUS |
|---|---|---|---|---|---|---|
| `regeringskansliet-sfs-1998-808` (Miljöbalken) | law | Regeringskansliet | 1658 | 1 | 1658 | PROVEN |
| `regeringskansliet-sfs-2013-251` (Miljöprövningsförordningen) | law | Regeringskansliet | 584 | 1 | 584 | PROVEN |
| `regeringskansliet-sfs-2020-614` (Avfallsförordningen) | law | Regeringskansliet | 792 | 1 | 792 | PROVEN |
| `regeringskansliet-sfs-2010-900` (PBL) | law | Regeringskansliet | 1523 | 1 | 1523 | PROVEN |
| `regeringskansliet-sfs-2011-338` | law | Regeringskansliet | 593 | 1 | 593 | PROVEN |
| `regeringskansliet-sfs-1998-899` | law | Regeringskansliet | 324 | 1 | 324 | PROVEN |
| `hav-hvmfs-2016-17` | standard | Havs- och vattenmyndigheten | 2 | 0 | 2 | PROVEN |
| `sgu-groundwater-influence-analytical-models` | standard | SGU | 4 | 0 | 4 | PROVEN |
| `sgu-well-drilling-guidance` | standard | SGU | 7 | 0 | 7 | PROVEN |
| `domstolsverket-puh-mmod` (1 of 511 acquired decisions) | court | Domstolsverket | 208 | 0 | 208 | PROVEN |

Every SFS document independently produced exactly one rejected fragment — the chapter-heading prose preceding the first `§` marker, which genuinely has no paragraph identity of its own. This is the same, understood, non-fabricated behavior across all six law documents, not six separate anomalies.

## What this baseline does not claim

- **Not all 511 PUH court decisions are materialized** — only the one used in the Part G pilot. Bulk court materialization is explicitly deferred to its own bounded batch, per instruction, given the volume (~504 MB, 511 documents) relative to what this baseline needed to prove.
- **The documented `"2 a kap."` chapter-detection gap remains open**, unfixed by design during this bulk phase — none of the 11 materialized documents were blocked by it. A future versioned chunking unit should address it deliberately, not as a side effect of a bulk run.
- **No embeddings, vector index, or retrieval exist yet.** This baseline proves the corpus's governed structure and provenance, not its searchability.
- **`boverket-planbestammelser`** remains unresolved (`BOVERKET-SOURCE-REDISCOVERY-01`), not silently worked around.

## Next decision point

Embeddings/retrieval remain explicitly out of scope until instructed. Before that, the remaining open questions are: (a) whether to run a bounded PUH court-decision bulk batch (with an explicit object/chunk budget, not all 511 at once), and (b) whether/when to open a versioned chunking unit for the `"2 a kap."` gap.

`LEGAL CORPUS V1 — GOVERNED MATERIALIZATION BASELINE` is now **PROVEN**, at commit `60d597e`.
