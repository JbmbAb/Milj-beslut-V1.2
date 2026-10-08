# LOKE-V0 reuse inventory

Status of this unit: **BLOCKED** before product code.

Base: `cf1e8f1f9b2c7fbe9c43d77ca638f48e684db301`
Tree: `6ca7b5808bf5b03d587e7b6c5cf0c704df4bc66f`
Branch: `feature/loke-v0`
Worktree: `D:\mimer-loke-v0`

The capability note `Claude outputs/brunn-capability-map-2026-10-01/final/PROPOSAL-COMPARISON.md` is not on this tree. Every row below was checked against this worktree. Prior conclusions were not copied as authority.

`HarvestExecutionStateMachine` is not wired into Loke. Its transitions continue through approval, import gate and PostGIS projection. That is Librarian/admission, not observation.

## Contract that inventory must use

`DownloadManifest` identity is already defined. It is not redefined here.

`buildDownloadManifestIdentityPayload` / `computeDownloadManifestHash` / `buildDownloadManifestRef` in [DownloadManifestIdentity.ts](../../packages/mps-data-governance/src/DownloadManifestIdentity.ts) answer one question: what was fetched, from which approved source, under which governed contract.

The `ContentReference` digest is SHA-256 of `dl-canonical-1` plus the canonical payload. The payload contains:

- `manifest_version`
- `execution_id`
- `source_id`
- `source_content_hash` (hash of the registry entry, not of the object bytes)
- `registry_artifact_id`
- each object: `quarantine_id`, `source_id`, `url`, `file_name`, `content_hash`, `byte_length`

Excluded from identity, on purpose: `generated_at`, `deduplicated`, `attempts`. `source_metadata` is also outside the identity payload.

`sameSemanticManifest` in [DownloadManifestStore.ts](../../packages/mps-data-governance/src/DownloadManifestStore.ts) is the existing equality. Two manifests are the same download only when those identity payloads canonicalize equal. `validateResolvedManifest` recomputes the `ContentReference` from stored bytes and rejects a mismatch.

That identity is computable only after acquisition. `quarantine_id` and object `content_hash` are produced by `QuarantineStorage.put`.

## Why complete / stale / same hash cannot be decided yet

The approved decision table needs four classifications before `GovernedDownloadExecutor` runs:

| Intended decision | What the existing model actually has |
| --- | --- |
| complete + same SHA → SKIP, 0 fetch | Manifest identity includes `execution_id` and `quarantine_id`. Object SHA-256 exists only after `put`. There is no remote hash to compare with. |
| partial → `RESUME_UNSUPPORTED` | No partial object state. The executor refuses a manifest that omits an object. `DownloadTransport.get` has no Range/resume. |
| stale or hash mismatch → REHARVEST | No stale flag. A different `source_content_hash` is a different manifest identity, not a stale marker. Hash mismatch against the remote cannot be observed before fetch. |
| none → DOWNLOAD | Absence of a resolvable manifest is real, but it cannot be separated from "identity not yet computable" without a lookup key the store does not have. |

`SourceChangeDetection` is only `{ strategy: ETAG | LAST_MODIFIED | CONTENT_HASH | NONE }`. The approved SFS entry uses `CONTENT_HASH`. The strategy name is part of the registry-entry hash. No ETag, Last-Modified or remote digest is stored, and the download path never reads `change_detection`.

`FileDownloadManifestStore` addresses files by manifest digest. It has `persist` and `resolve`. It has no list-by-source.

`DiskQuarantineStorage.findByHash` deduplicates network bytes by SHA-256 alone. It does not require the same `source_id` or URL. Byte equality there is not "same observation".

`packages/mps-data-governance/src/RawSourceArtifact.ts` is a separate canonical type. The executor does not construct it. The bytes that actually land are `RawSourceArtifact` in [QuarantineStorage.ts](../../packages/mimers-brunn-core/src/governance/QuarantineStorage.ts).

Defining `complete`, `stale` or a pre-fetch "same canonical identity" on top of this would be a new inventory vocabulary. This unit does not add one.

## Reuse matrix

| Capability | Existing symbol/file | Reachability | Status | Reuse decision | Gap |
| --- | --- | --- | --- | --- | --- |
| Verified source load | `loadVerifiedSourceRegistry` in `packages/mps-data-governance/src/SourceRegistry.ts` | PRODUCT_REACHABLE | REUSE | Keep. Non-APPROVED and bad signatures fail the whole load. | None for the read gate. |
| Registry-bound acquisition | `GovernedDownloadExecutor.execute` | PRODUCT_REACHABLE | REUSE | `REJECT_SOURCE` happens before resolve/fetch. | None. |
| Composition root | `composeHarvestRuntime` in `HarvestRuntimeCompositionRoot.ts` | PRODUCT_REACHABLE | REUSE | Canonical wiring: registry, resolver, transport, quarantine, manifest store. No CAS, no signing key. | Does not decide inventory before fetch. |
| Canonical entrypoint | `packages/mps-data-governance/scripts/harvest-live-pilot.ts` | SCRIPT_ONLY | REUSE | Calls `executor.execute` directly. Second call fetches again. | Not an inventory gate. |
| Governed download | `GovernedDownloadExecutor` | PRODUCT_REACHABLE | REUSE | SHA-256, size limit, retry, politeness, quarantine, manifest. | Always fetches when the plan has targets. Post-fetch `deduplicated` is not SKIP. |
| Download manifest | `DownloadManifest`, `buildDownloadManifestRef` | PRODUCT_REACHABLE | REUSE | This is the identity. Do not add a second manifest. | Identity is post-fetch. |
| Manifest store | `FileDownloadManifestStore`, `sameSemanticManifest` | PRODUCT_REACHABLE | REUSE | Resolve and semantic equality only. | No source index. |
| HTTP transport | `HttpDownloadTransport` / `DownloadTransport.get` | PRODUCT_REACHABLE | REUSE | Injected `fetchImpl`. | No Range, no conditional GET. Resume cannot be implemented. |
| Single endpoint | `SingleEndpointTargetResolver` | PRODUCT_REACHABLE | REUSE | Registered as `SINGLE_ENDPOINT_V1`. | No remote hash. Never returns `NO_CHANGES`. |
| PUH enumeration | `PuhRattspraxisTargetResolver` | PRODUCT_REACHABLE | REUSE | Registered as `PUH_RATTSPRAXIS_V1`. | Many objects. Not the V0 fixture. |
| STAC enumeration | `LantmaterietStacByggnaderTargetResolver` | PRODUCT_REACHABLE | REUSE | Registered as `LM_STAC_BYGGNADER_V1`. | Bearer token and ZIP assets. |
| WFS enumeration | `WfsCapabilitiesTargetResolver` | UNWIRED | ADAPT | Code and tests exist. Not in `PRODUCTION_ADAPTER_RESOLVERS`. | No APPROVED source names a WFS adapter. |
| RSS | `scripts/import/harvest/harvestPlan.ts`, `contract.ts` | SCRIPT_ONLY | DO_NOT_REUSE | Legacy scheduler path. | Not registry-adapter bound. |
| Legacy scheduler | `scripts/import/harvest/harvestScheduler.ts` | SCRIPT_ONLY | DO_NOT_REUSE | File states it is non-operational. Adapters do not match APPROVED sources. | Bypasses the composition root. |
| Harvest state machine | `HarvestExecutionStateMachine` | TEST_ONLY | DO_NOT_REUSE | Used only by `HarvestOrchestrator`. | Transitions include `IMPORT_GATE` and `POSTGIS_PROJECTION`. |
| Harvest orchestrator | `HarvestOrchestrator` | TEST_ONLY | DO_NOT_REUSE | Constructed only in tests. | Would pull Loke into admission. |
| Orchestrator checkpoint | `HarvestExecutionCheckpoint` | TEST_ONLY | DO_NOT_REUSE | Documented as non-canonical runtime state. | Not a DownloadManifest identity. |
| Quarantine bytes | `DiskQuarantineStorage` | PRODUCT_REACHABLE | REUSE | Landing zone. Original bytes kept on status change. | Hash dedup is not source-scoped observation identity. |
| Canonical raw artifact type | `packages/mps-data-governance/src/RawSourceArtifact.ts` | TEST_ONLY | DO_NOT_REUSE | Schema test only. | Not the object the executor writes. |
| Dataset approval | `DatasetApprovalArtifact` | PRODUCT_REACHABLE | DO_NOT_REUSE | Librarian/admission artifact. | Loke must not mint it. |
| CAS admission | `LegacyMasterAdmission`, `DocumentEvidenceAdmission` | PRODUCT_REACHABLE | DO_NOT_REUSE | Separate from harvest composition. | Not an observation landing zone. |
| Librarian import | `scripts/import/import-librarian-manifest.ts` via `GovernedWriteCapability` | PRODUCT_REACHABLE | DO_NOT_REUSE | PostGIS write path belongs to Librarian. | Loke does not call it. |
| Inventory-first actions | `benchmarks/alpha_evolve_bibbi_harvest/problem_description.md` | BENCHMARK_ONLY | GAP | Ideas only: SKIP / DOWNLOAD / RESUME / REHARVEST. | Not bound to DownloadManifest identity. Do not port the vocabulary. |
| Governed open discovery | none | UNKNOWN | GAP | Resolvers are source-bound. No open-web crawler in the composition root. | Not built in this unit. |
| Dataportalen as registry source | `source-registry/national-registry.json` | UNKNOWN | GAP | No dataportal entry in the verified registry. Other dataportal scripts exist outside it. | Not an eligible first source. |

## First-source ranking (not executed)

Dataportalen is not in the verified registry.

1. `regeringskansliet-sfs-1998-808` — `SINGLE_ENDPOINT_V1`, no credentials, one URL, no database. Endpoint is HTML (`https://rkrattsbaser.gov.se/sfst?bet=1998:808`), not a stable PDF. Would have been the fixture source.
2. `hav-hvmfs-2016-17` — same adapter, narrower scope.
3. `domstolsverket-puh-mmod` — real enumerator, many objects.
4. `lantmateriet-stac-byggnader` — credentials and ZIP assets. Not V0.

No source was harvested. No live request was made.

## Stop

Product code is not written. A Loke decision function that emitted SKIP, REHARVEST or DOWNLOAD would have to invent the missing classifications. That is the prohibited parallel inventory format.
