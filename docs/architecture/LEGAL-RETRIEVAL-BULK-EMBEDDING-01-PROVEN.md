# LEGAL-RETRIEVAL-BULK-EMBEDDING-01 — PROVEN

**Status:** PROVEN. Full embedding coverage of the frozen `LEGAL-CORPUS-V1-TEXT-STRUCTURE-
BASELINE-V2` corpus under the identity/persistence/provider contract already frozen in
`LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01` and proven at bounded scale in
`LEGAL-RETRIEVAL-BOUNDED-PILOT-01`. No identity, policy, persistence, or provider decision was
reopened in this unit — this only proves the same contract holds at full corpus scale.

## Operational incident: ACCIDENTAL_DUAL_LAUNCH

```
operational incident: ACCIDENTAL_DUAL_LAUNCH

impact:
  - no duplicate persistence
  - no data corruption
  - 1,315 rows safely persisted (from the dual-launch period)
  - cost/throughput metrics contaminated for that first attempt only

response:
  - both runs stopped
  - one clean run restarted
  - all metrics in this report measured from the clean run only
```

A nested-background launch mistake started two concurrent instances of the bulk script against
the same database. Both terminated cleanly once identified (via `Get-CimInstance Win32_Process`,
matching command lines) and killed. The `embedding_identity_hash` unique constraint — the actual
identity, not an incidental column — did exactly its job under real concurrent writers: 1,315
rows landed safely with zero duplicates, independently verified (distinct hash count == row
count) before the clean run started. Those 1,315 rows are legitimate, immutable embedding rows
and are **not** reset or discounted — only the operational metrics (wall time, throughput) from
that contaminated period are excluded from this report, per instruction. The clean run's own
pre-check correctly recognized 1,310 of those chunks as already-covered (skipped, not re-billed)
before it began embedding.

## CORRECTNESS

| Check | Result |
|---|---|
| Expected chunks (frozen baseline scope) | 31,706 |
| Embeddings covered (exact model `gemini-embedding-001` / pipeline `embed-pipeline-gemini-v1`) | **31,706 / 31,706 — 100%** |
| Unique embedding identities | 31,711 total rows in the table, 31,711 distinct `embedding_identity_hash` values — **zero duplicates anywhere**, independently re-queried after the run, not read from the script's own counters |
| Null vectors | 0 (both the clean run's own count and an independent post-run query) |
| Dimension mismatches / provider drift | 0 — every vector was exactly 3072 dimensions; the run's own STOP-on-drift guard never triggered |
| Unresolved chunk bindings | 0 — coverage-by-family/policy/source queries below show `embedded == total` for every group, with no orphaned or dangling embedding row (enforced at the DB level by the `legal_corpus_chunk_embeddings -> legal_corpus_materialized_chunks` foreign key) |
| Replay/idempotency | Proven again at full scale: 1,310 chunks already covered from the pilot + incident period were correctly skipped (zero API calls, zero new rows) before the clean run embedded the remaining 30,396 |

**Status: PROVEN.** The script's own exit code (0) and printed `"status": "PROVEN"` were not
taken at face value — every figure above was re-derived independently against the live database
after completion.

## COVERAGE

| Family | Total | Embedded |
|---|---|---|
| court | 20,372 | 20,372 |
| law | 11,321 | 11,321 |
| standard | 13 | 13 |

| `chunk_policy_version` | Total | Embedded |
|---|---|---|
| `legal-chunker-v2.3` | 25,859 | 25,859 |
| `legal-chunker-v2.4` | 1,357 | 1,357 |
| `legal-chunker-v2.4.1` | 4,490 | 4,490 |

| Source | Total | Embedded |
|---|---|---|
| `domstolsverket-puh-mmod` | 20,372 | 20,372 |
| `regeringskansliet-sfs-1998-808` (Miljöbalken, v2.3+v2.4+v2.4.1 combined) | 4,372 | 4,372 |
| `regeringskansliet-sfs-2010-900` | 2,824 | 2,824 |
| `regeringskansliet-sfs-2020-614` | 1,366 | 1,366 |
| `regeringskansliet-sfs-2013-251` | 1,128 | 1,128 |
| `regeringskansliet-sfs-2011-338` | 1,033 | 1,033 |
| `regeringskansliet-sfs-1998-899` | 598 | 598 |
| `sgu-well-drilling-guidance` | 7 | 7 |
| `sgu-groundwater-influence-analytical-models` | 4 | 4 |
| `hav-hvmfs-2016-17` | 2 | 2 |

10 distinct sources, every one at 100% coverage.

## OPERATIONS (clean run only)

| Metric | Value |
|---|---|
| Clean-run wall time | 2,476s (~41.3 minutes) |
| Requests / batches | 1,520 (batch size 20) |
| Skipped, already-covered rows (not re-billed) | 1,310 |
| Retries | 0 |
| Rate-limit events | 0 |
| Failures | 0 |
| Throughput | ~12.3 chunks/s (stable across the entire run — 11.7 chunks/s at batch 25, 12.3 by batch 1520, no degradation) |
| Provider call time (sum across all requests) | 743,776 ms (~490 ms/request average) |
| DB write time (sum across all persisted rows) | 1,490,931 ms (~49 ms/row average) |
| Estimated tokens embedded this run | ~7,103,000 (character-count heuristic, ~4 chars/token — `embedContent`'s response exposes no usage/token metadata, so this is explicitly an estimate, not a billed figure) |

These are the clean-run's own numbers only — the contaminated dual-launch period's metrics are
excluded per instruction, as noted above.

## What this does not claim

- Retrieval quality is unaffected by this unit — the bounded pilot's honest 3/6 top-1 / 4/6
  top-3/5 result still stands as the only retrieval-quality evidence that exists. Full coverage
  is not a quality claim.
- No retrieval tuning, reranking, query rewriting, hybrid BM25+vector, metadata filtering, or
  RAG/UI consumer work was done in this unit — all explicitly out of scope, per instruction.
- Vertex AI remains unused; the Gemini API-key path (`gemini-embedding-001`, pinned) is the sole
  provider for the entire corpus, with zero fallback exercised or needed.

## Next

`LEGAL-RETRIEVAL-QUALITY-BASELINE-01` — a much larger golden-query set across law/court/standard,
measuring retrieval quality on its own terms (hybrid BM25+vector, metadata/chapter-aware
filtering, case-number lexical lookup, reranking are candidates to evaluate there, not decided
here). Not started in this unit.
