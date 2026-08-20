# P2-HARVEST-LIVE-01 — Governed Live Acquisition, PROVEN (10/11)

**Status:** PROVEN for 10 of 11 currently APPROVED sources; 1 FAILED_CLOSED (source-specific, not a pipeline defect)
**Scope:** live proof that the existing, already-built governed harvest pipeline — `SourceRegistry` (signed) → `composeHarvestRuntime()` → `GovernedDownloadExecutor` → `DiskQuarantineStorage` → `DownloadManifest` (`FileDownloadManifestStore`) — works end to end against real network sources, including persistent replay.

## Chain proven

```
signed SourceRegistry (11 APPROVED entries, verified against the recovered GOVERNOR public key)
  → composeHarvestRuntime()
  → real HTTP acquisition (HttpDownloadTransport, no bypass)
  → DiskQuarantineStorage (hash-verified on write)
  → DownloadManifest (FileDownloadManifestStore)
  → persistent replay (second live execution, same persistent store, no forced state reset)
```

Proven across both acquisition adapter classes in production use: `SINGLE_ENDPOINT_V1` (9 sources) and `PUH_RATTSPRAXIS_V1` (1 source, 511 real court-decision PDFs).

## Defect found and fixed during this proof: `P2-DOWNLOAD-MANIFEST-REPLAY-01`

Manifest **identity** already excluded `generated_at`/`attempts`/`deduplicated` (Model 1 — semantic acquisition result), but manifest **persistence** compared the full raw body, which still included those fields. Two honest, independent live executions of the same acquisition therefore produced the same identity but different bodies, and were rejected as a false "collision". Fixed in `DownloadManifestStore.ts` by sharing the canonical identity payload (`buildDownloadManifestIdentityPayload`) between the identity hash and the persistence comparison, for both `InMemoryDownloadManifestStore` and `FileDownloadManifestStore`. Tamper detection on genuinely differing identity-bearing content was preserved and re-proven. Focused proof: `packages/mps-data-governance/tests/P2DownloadManifestReplay01.test.ts` (12/12 green). Full `mps-data-governance` suite: 31 files / 278 tests, 0 regressions.

## Closure matrix — all 11 APPROVED sources

| source_id | authority | adapter | ACQUISITION | REPLAY | RAW BYTE STABILITY | PROVENANCE | bytes | objects | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| domstolsverket-puh-mmod | Domstolsverket | PUH_RATTSPRAXIS_V1 | PROVEN | PROVEN | STABLE | COMPLETE | 528,746,115 | 511 (510 unique) | PROVEN |
| regeringskansliet-sfs-1998-808 | Regeringskansliet | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | STABLE | COMPLETE | 581,045 | 1 | PROVEN |
| regeringskansliet-sfs-2013-251 | Regeringskansliet | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | STABLE | COMPLETE | 183,083 | 1 | PROVEN |
| regeringskansliet-sfs-2020-614 | Regeringskansliet | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | STABLE | COMPLETE | 282,654 | 1 | PROVEN |
| regeringskansliet-sfs-2010-900 | Regeringskansliet | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | STABLE | COMPLETE | 383,562 | 1 | PROVEN |
| regeringskansliet-sfs-2011-338 | Regeringskansliet | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | STABLE | COMPLETE | 175,854 | 1 | PROVEN |
| regeringskansliet-sfs-1998-899 | Regeringskansliet | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | STABLE | COMPLETE | 128,701 | 1 | PROVEN |
| hav-hvmfs-2016-17 | Havs- och vattenmyndigheten | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | VOLATILE | COMPLETE | 75,669 | 1 | PROVEN |
| sgu-groundwater-influence-analytical-models | SGU | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | VOLATILE | COMPLETE | 39,323 | 1 | PROVEN |
| sgu-well-drilling-guidance | SGU | SINGLE_ENDPOINT_V1 | PROVEN | PROVEN | VOLATILE | COMPLETE | 71,297 | 1 | PROVEN |
| boverket-planbestammelser | Boverket | SINGLE_ENDPOINT_V1 | FAILED_CLOSED | NOT_PROVEN | NOT_PROVEN | PARTIAL | — | 0 | FAILED_CLOSED |

**Totals (10 PROVEN sources):** 519 objects, 518 unique SHA-256 (1 legitimate PUH cross-publication duplicate), ~530.9 MB, 9 download manifests, all provenance-complete.

## Known, explicitly deferred findings (not fixed here, not blocking)

- **`HTML-SOURCE-STABILITY-01`** (3 sources: `hav-hvmfs-2016-17`, `sgu-groundwater-influence-analytical-models`, `sgu-well-drilling-guidance`): raw HTTP response bytes vary between fetches (root cause on `sgu-well-drilling-guidance`, verified by diff: a server-generated random UUID in navigation markup, unrelated to the actual guidance/regulation text). Acquisition and replay both PROVEN regardless — each fetch is captured and manifested correctly, just as a different identity. This is a projection/canonical-content-identity question (raw observation hash vs. semantic content hash), explicitly deferred to the corpus materialization phase where `TEXT-L1/TEXT-L2` projection is expected to absorb this kind of presentation noise. No normalization was added to the download/quarantine layer — raw capture stays exactly what the server returned.
- **`boverket-planbestammelser`**: the signed endpoint (`https://api.boverket.se/planbestammelser/v2/json`) now returns 404, and so does the API root (`https://api.boverket.se/`) — the service appears to have moved or been decommissioned since GOVERNOR approval. Not silently re-pointed to a new URL; the signed scope is authority, not a suggestion. Handled as a separate unit, `BOVERKET-SOURCE-REDISCOVERY-01`.

## Not in scope for this freeze

Corpus materialization, text projection, chunking, embeddings, retrieval/RAG. This document proves acquisition only.

`P2-HARVEST-LIVE-01` is now **PROVEN (10/11 APPROVED sources)**, frozen as the acquisition-layer basis for `LEGAL-CORPUS-MATERIALIZATION-V1`.
