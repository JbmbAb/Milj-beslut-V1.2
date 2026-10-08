# L-V0-HEAD-WIRING-CONTRACT-01 — runtime wiring contract

**Status: HEAD_WIRING_CONTRACT_CLOSED / IMPLEMENTATION_NOT_STARTED.**

This note does not assign VERIFIED, PROVEN, COLD_VERIFIED or EXECUTION_VERIFIED to this unit or to the harvest runtime.

No product code. No test change. No schema change. No source selection. No runtime wiring. No push.

| | |
| --- | --- |
| Unit | L-V0-HEAD-WIRING-CONTRACT-01 |
| Start HEAD | `417ef72eda8f09168964597a7d24356871a4ef57` |
| Start tree | `490e157bb5b1a2673c6c123dcaa2ee903c5fe4d8` |
| Normative validator | [L-V0-PREFETCH-VALIDATOR-CONTRACT.md](./L-V0-PREFETCH-VALIDATOR-CONTRACT.md) |
| Normative authority | [L-V0-STRONG-ETAG-AUTHORITY-01.md](./L-V0-STRONG-ETAG-AUTHORITY-01.md) |
| Identity lock | [L-V0-IDENTITY-01.md](./L-V0-IDENTITY-01.md) |
| Repair review | `LOKE-HEAD-WIRING-REPAIR-INDEPENDENT-REVIEW-2026-10-06.md`, SHA-256 `CCE517A1B102DB2B829C65719666BCF6721864FF6CB3C64FE86C5207A3D7E0C7` |
| HW-F6 review closed here | `LOKE-HEAD-WIRING-3BEAB228-INDEPENDENT-REVIEW-2026-10-06.md`, SHA-256 `8BBEF01DBC248AABA53087E84067DE2F35384E68AEE98BF7560C30F5301F9483` |
| Lease primitive | L-V0-LEASE-PRIMITIVE-DECISION-01, DECIDED / CLOSED. Repairs §3.1 only. |

Frozen statuses this unit does not reopen:

- **L-V0-STRONG-ETAG-AUTHORITY-IMPL-01 — EXECUTION_VERIFIED** (scoped strong-ETag authority provenance + HEAD-only prefetch regression).
- **L-V0-PREFETCH-VALIDATOR-IMPL-01 — IMPLEMENTED_PORT / NOT_RUNTIME_WIRED.**
- **HEAD_ONLY_V0** is frozen. Conditional GET is not a V0 path.
- No production resolver declares `STRONG_ETAG`.

`decidePrefetch` remains the decision port. A later wiring unit calls it. It must not grow a second decision inside `GovernedDownloadExecutor`.

## 0. Repairs

`36be2e6a` was blocked on three findings. `713c3496` closed them. Review of `713c3496` was blocked again on `observed_at` and on the orchestrator return path. `3beab228` closed those two and was then blocked on HW-F6 (`BLOCKED / CONTRACT_PORT_REPAIR_REQUIRED`). `ca78e7b9` closed that port mismatch only and did not edit `PrefetchValidator.ts`. L-V0-LEASE-PRIMITIVE-DECISION-01 then replaces the lease-file lock in §3.1 and does not reopen the rest of this contract. Wiring has not started.

| Finding | Closure |
| --- | --- |
| HEAD `Content-Length` | Closed in `713c3496`. Length is metadata. A null body is a valid HEAD observation. |
| File-store concurrency | Closed in `713c3496` as one writer for the store root. Not cross-process CAS. `proper-lockfile` does not implement that lease. The lease-file lock in that wording is replaced by L-V0-LEASE-PRIMITIVE-DECISION-01 in §3.1. |
| `SKIP` outside `dl-canonical-1` | Closed in `713c3496` by a separate `pex-canonical-1` artifact. `L-V0-IDENTITY-01` is not amended. |
| `observed_at` in the PEX hash | Closed in `3beab228`. The timestamp stays in the body and is excluded from identity and replay equality. |
| PEX entering verification | Closed in `3beab228`. `execute` returns a discriminated result. `PREFETCH_EVIDENCE_RECORDED` is a terminal state and does not call verification. |
| HW-F6. `VALIDATOR_EXCHANGE_UNSUPPORTED` after the exchange has started | Closed here. `ConditionalExchangeResponse.failure` gains `"unsupported"`. The later `decidePrefetch` maps that value to `FETCH` / `VALIDATOR_EXCHANGE_UNSUPPORTED` before status interpretation. Unsupported is not a throw. |

## 1. Current architecture

```
verified registry
  → DownloadTargetResolverRegistry
      → stamp targetIdentity
      → strongEtagAuthority or null
  → GovernedDownloadExecutor
      → DownloadTransport.get()     // unconditional GET, reads a body
      → quarantine.put
      → DownloadManifest
```

`PrefetchValidator` and `InMemoryValidatorBindingStore` sit beside that chain. Nothing in `GovernedDownloadExecutor` or `HarvestRuntimeCompositionRoot` calls `decidePrefetch`.

`DownloadTransport.get` takes a URL, a timeout and an optional size limit. `HttpDownloadTransport.get` sends `GET`, follows 301/302/303/307/308 with `redirect: "manual"`, re-checks every hop with the source predicate, and returns `{ status, bytes, headers }`. It does not return the terminal URL. `LantmaterietStacByggnaderAssetTransport.get` sends an authenticated `GET` and refuses every redirect.

`DownloadManifest.objects` is a list of `DownloadedObject`. Each object has `quarantine_id`, `content_hash` and `byte_length` because bytes were landed. `no_changes` is a resolver claim that a listing was consulted and **zero targets** were produced. It is not a per-target validator result.

`DownloadManifestIdentity` (`dl-canonical-1`) hashes `manifest_version`, `execution_id`, source binding, and the fetched object tuple (`quarantine_id`, `source_id`, `url`, `file_name`, `content_hash`, `byte_length`). It does not hash `generated_at`, `deduplicated`, `attempts`, `source_metadata` or `no_changes`.

## 2. A — HEAD transport

**Decision: a separate conditional HEAD exchange. `DownloadTransport` does not grow `head()`, and `get()` stays an unconditional GET that still reads its body.**

| Candidate | Result |
| --- | --- |
| 1. `ConditionalValidatorExchange` implemented beside the HTTP transport | **Selected.** |
| 2. `DownloadTransport.head()` or a method flag on `get()` | Rejected. |

`get()` is the acquisition path for every governed byte. Putting HEAD on that port forces every transport, including the authenticated asset transport and the test doubles, to share a response shape whose `bytes` field is the body. An empty buffer is a body that was read and dropped. A shared redirect walker with a method parameter can turn a HEAD redirect into the GET follower that already exists. That is the GET-path risk this unit refuses.

The later implementation adds one type, `HttpConditionalHeadExchange`, implementing `ConditionalValidatorExchange` with the failure seam below. It is constructed from the same source-scoped `isUrlAllowed`, redirect budget, user-agent and `fetch` implementation as that source's executor transport. It does not call `DownloadTransport.get`. It does not add conditional headers to `get`.

HEAD request rules:

- The HTTP method is `HEAD`. No conditional GET is representable on this type.
- The request URL is `locatorIdentity`, which is the resolver's `target.url`. This exchange adds no URL normalizer.
- `If-None-Match` is that one `validatorToken` and no other value. No comma, no added `W/`, no second header.
- `redirect: "manual"`.
- 307 and 308 may be followed. The next request stays `HEAD` and keeps the same single `If-None-Match`. Each hop, including the initial URL, is checked with the source predicate before the request is sent. These are the only redirects this exchange follows.
- 301 and 302 are not followed. The refusal is deliberate. It is not a claim that those statuses rewrite `HEAD` into `GET`. RFC 9110 permits a historical method change from `POST` to `GET` on 301 and 302. It does not define that change for `HEAD`. V0 still refuses them so the validator never issues a second request outside a method-preserving 307 or 308. 303 is not followed because its subsequent retrieval is a different request and must not become a conditional GET. An unfollowed 301, 302 or 303 returns `failure: "unsupported"`. The exchange does not throw, does not send a second HEAD, and does not send a GET.
- The terminal URL is the URL that produced the non-followed status, after its scope check. That string is `ConditionalExchangeResponse.finalUrl`. Comparison with `locatorIdentity` stays exact, in `decidePrefetch`. A redirect the live response invented is not the §4.4 exception.
- The exchange does not call the body reader used by `get()`. It does not set `ConditionalExchangeResponse.body`. It does not pass any HEAD byte to quarantine or to `fetchOne`.
- `Content-Length` on HEAD is metadata about the selected representation. It is not proof that this response has a body. A response may be status 200, `Content-Length: 123`, a strong ETag, and `response.body === null`, with zero bytes to read. That response is a valid HEAD observation. Do not reject it because the length is greater than zero.
- Body presence is the runtime body, not the length header. `response.body === null` means there is no body. If the runtime exposes a non-null body, do not read it and do not copy it. Cancel the stream, do not set `ConditionalExchangeResponse.body`, and return `failure: "unsupported"`. Do not throw. That result is not `SKIP`. The later GET, if section E allows one, is the only acquisition.
- Timeout, DNS, TLS and connection failure map to `failure: "unavailable"`, or they throw. HTTP 5xx maps to `failure: "unavailable"`. HTTP 401 and 403 map to `failure: "unauthorized"`. A scope or redirect-scope refusal maps to `failure: "scope"`. `decidePrefetch` already turns those into `UPSTREAM_UNAVAILABLE`, `UPSTREAM_UNAUTHORIZED` and `SCOPE_VIOLATION`. A thrown exchange error stays `UPSTREAM_UNAVAILABLE`. It is not the unsupported signal.

The frozen exchange seam, for the later implementation, is:

```
ConditionalExchangeResponse.failure =
  "unavailable" | "unauthorized" | "scope" | "unsupported"
```

After the exchange returns, and before `decidePrefetch` interprets `status`, `finalUrl`, `etag` or `body`:

`failure === "unsupported"` → `FETCH` / `VALIDATOR_EXCHANGE_UNSUPPORTED`

The cases that set `"unsupported"` are an unfollowed 301, 302 or 303, and an actual non-null HEAD body. The current `PrefetchValidator.ts` union is still `"unavailable" | "unauthorized" | "scope"`. This unit does not change that file. The later implementation adds `"unsupported"` there. That modified port requires its own independent execution re-verification. The scoped **EXECUTION_VERIFIED** status of **L-V0-STRONG-ETAG-AUTHORITY-IMPL-01** does not cover it and must not be widened automatically.

`LantmaterietStacByggnaderAssetTransport` refuses every redirect and attaches a bearer token. A HEAD exchange for that port, if one is ever built, must refuse every redirect and must use that same credential port. It must not be the public `HttpConditionalHeadExchange`. This unit does not build it, and section F forbids declaring the capability on that adapter.

## 3. B — Binding store / durability

**Decision: production recall is a file store of exactly one record per key. `InMemoryValidatorBindingStore` remains the test double. The store is not an authority.**

No new approval model is required. The record recalls an upstream token. It does not approve a source, mint a content hash, write CAS, or identify a `DownloadManifest`.

| Question | Closed answer |
| --- | --- |
| Where | A directory beside download manifests, default `join(quarantineRootPath, "validator-bindings")`, overridable the same way `downloadManifestRootPath` is. Not inside a manifest file. Not CAS. Not `H:\ GEO_Master_Archive`. |
| Restart | The record must survive process restart. Otherwise every process start is `NO_PRIOR_BOUND_TOKEN` and the live HEAD can never run. Survival is recall, not freshness. `observed_at` is still not a TTL. |
| Key | `JSON.stringify([sourceId, locatorIdentity, targetIdentity])`, the same triple as `keyOf` today. The filename is the SHA-256 of that UTF-8 string. The body repeats the three key fields. |
| Not in the key | `sourceContentHash`, `registryArtifactId`, `adapterId`, `validatorToken`, `observedAt`. |
| Replace | One record per key. Write a temporary file in the same directory, then replace the key file so a reader sees the previous complete body or the new complete body, never a torn body. If the platform cannot do that, the write fails and the previous body stays. |
| `touchObservedAt` | Under the single-writer lease below: read the one record, and if its `validatorToken` is still the token just read, write the same record with only `observedAt` changed, using the same temp-file replace. If the token differs or the key is not exactly one record, return `false` and do not write. This is compare-then-replace inside one writer. It is not cross-process compare-and-swap. `decidePrefetch` already cancels `SKIP` when touch returns `false`. |
| Corruption | Parse failure, filename/key mismatch, missing fields, or any body that is not exactly one well-formed record is not an empty lookup. The port maps it to `SIGNAL_UNVERIFIABLE` before any HEAD. It must not look like `NO_PRIOR_BOUND_TOKEN`. |
| Hash or registry mismatch | Key still resolves. `decidePrefetch` returns `BINDING_MISMATCH`. The wiring does not delete the record on that read. |
| Several records | Unverifiable. Do not pick one. Do not send a list. |
| Concurrency | One production writer for the store root. Ownership is the OS primitive in §3.1, not a file. Inside that process, one flight per key. No cross-process compare-and-swap. |
| Classes stored | V0 writes only `STRONG_ETAG` records created by section C. A stored digest or revision class stays `FETCH` / `SIGNAL_CLASS_FORBIDDEN` or `SIGNAL_UNVERIFIABLE` through the existing port. |

### 3.1 Exclusive store-root writer lease

L-V0-LEASE-PRIMITIVE-DECISION-01 replaces the requirement that the operating system lock the lease file itself. Locking that file is not a separate invariant. The invariant is process-bounded, OS-owned exclusivity that leaves no persistent ownership state after the process ends.

V0 does not implement cross-process compare-and-swap. A read, a temp write, and an atomic replace are not a CAS. Two writers can resurrect an older token: writer A reads `T`, writer B replaces `T` with `U`, writer A writes a touched `T`.

The V0 rule is one writer for the whole store root.

Ownership and the lease record are different objects.

- The ownership primitive is OS-owned. Its lifetime is the owning process. Windows V0 uses one exclusive named pipe created with `node:net`. The pipe is not the lease record and it is not a binding record.
- The pipe name is `\\.\pipe\loke-v0-validator-binding-` plus the lowercase SHA-256 hex of the UTF-8 bytes of the resolved store-root path, with a trailing separator removed. The hash is not truncated. The same root always maps to the same pipe. A different root must not map to that pipe. The name does not contain `targetIdentity`, a source hash, an ETag, or `observed_at`. It is not a new authority identity.
- Acquisition succeeds only when this process binds that pipe. `EADDRINUSE`, or any other failure to bind, throws `LEASE_ALREADY_HELD` for an already held pipe and fails closed for an unexpected OS or runtime error. Neither result means the lease is free. The process must not read the store, must not write it, and must not `SKIP`. A second process fails the same way. A second bind in the same process fails the same way. The primitive is not re-entrant. There is no fallback to `O_EXCL`, a PID, `mtime`, a timeout, polling, or optimistic ownership.
- A normal release closes the pipe. Crash or kill releases it because the kernel drops the process resource. The next process may bind immediately. It does not delete a file first, and it does not judge age or liveness.
- A persistent lease record in the store root may still hold diagnostic metadata. Its existence, `mtime`, and any PID inside it do not mean a live owner. A record left after a crash must not block acquisition. It must not be deleted because it looks old. It must not be used as the lock through `O_EXCL`.
- If the runtime cannot establish this primitive, construction throws. No other locking mechanism is substituted. `proper-lockfile`, `mkdir`, `mtime`, a stale timeout, PID reclaim, and an in-memory mutex as the only cross-process guard are rejected. A native addon or a new dependency is a separate design decision and is not authorized here.
- Inside the holding process, each key has one in-flight operation. `touchObservedAt` holds that key across its read and its replace. Compare-then-replace is safe only under this single-writer invariant.

The primitive does not create or change authority for `targetIdentity`, representation, `sourceContentHash`, `observed_at`, or PEX. It is orchestration exclusivity only.

`InMemoryValidatorBindingStore` has no lease. It remains the test double. It is not a second production writer.

Failed replace of a **different** token must not leave the old token readable as the single valid record. The key becomes unreadable (`SIGNAL_UNVERIFIABLE`) by the same atomic replace, using a tombstone body that fails the one-record check. A later successful acquisition may replace that tombstone under section C. A tombstone is not absence and not a second record the validator may choose.

If neither the new record nor the tombstone can be committed, the episode throws. This run does not succeed and does not `SKIP`. The residual, if a stale file survives a crash, is the same one the validator contract already accepts: the next episode still needs a live HEAD, and a dishonest origin can `304`. This store does not add a second content check.

## 4. C — How the first binding is created

A binding is written only after a governed content GET has landed bytes, and only as recall of the ETag on that response.

Procedure, after `fetchOne` has a 2xx body that passed the existing size, non-empty and checksum checks, and after `quarantine.put` has returned:

1. Read the ETag from `DownloadResponse.headers` of **this GET**. The header name is the transport's lower-cased `etag`. Do not read `source_metadata`, `change_detection`, or any provider field.
2. Accept the token only when it is one strong token: non-empty, no `W/` prefix, no comma. Anything else writes nothing. The acquisition still stands.
3. Require `isDeclaredStrongEtagAuthority` on this target's resolver-issued authority, and require its six fields to match this run's source, adapter, `target.url` and `targetIdentity`. Otherwise write nothing.
4. Require the GET's terminal URL. `DownloadResponse` does not carry it today. A later unit adds `finalUrl` to that response. `get()` still returns the same status, bytes and headers. `DownloadedObject.url` stays `target.url`. The new field is not a manifest field and not an identity input.
5. Write the binding only when `finalUrl` is present and exactly equals `locatorIdentity` (`target.url`). If the field is absent, or the strings differ, write nothing. Do not bind a redirected representation to the pre-redirect locator. Do not invent a canonical URL from the redirect.
6. `replace` one `ValidatorBindingRecord`: the source triple, `locatorIdentity`, `targetIdentity`, declared `fileName` or null, class `STRONG_ETAG`, the token, and `observedAt` from the run clock. This write is not `SKIP`.

Order relative to landing:

`GET → existing checks → quarantine.put → checksum → binding replace → section D persist`

A 200 GET without an ETag is a normal acquisition. It quarantines, it appears in `objects`, and it writes no binding.

If bytes have landed and the binding write fails:

- The decision for this target is already `FETCH`. It must not become `SKIP`.
- The object remains a `DownloadedObject` for this episode's in-memory result.
- The run does not persist a successful manifest. The episode throws after the fail-closed store rule in section B.
- Quarantine may already hold the bytes, as it can today when a later step throws.
- The next episode must not `SKIP` on a token this episode already observed to be different. That is why a failed replace of a different token tombstones the key.

404 and other non-2xx GET results do not create or delete a binding. The existing executor throws. Section 9 of the validator contract still holds: a 404 does not rewrite the prior observation.

## 5. D — Execution evidence at SKIP

`DownloadedObject` means bytes landed in this acquisition. A `SKIP` lands none.

`DownloadManifestIdentity` (`dl-canonical-1`) hashes the execution and source binding plus the fetched objects. `DownloadManifestStore` semantic equality uses that same payload. An unhashed observation list does not bind which targets were skipped. Same execution, same source, and `objects: []` collapse `SKIP` of target A with `SKIP` of target B. A mixed run with the same fetched subset and a different skipped target collapses the same way. A completeness check before persist does not repair that: the persisted reference still does not bind the outcomes, and a second persist of the same identity keeps the first body.

**Explicit decision: OPTION 2. This is a new artifact and a new canonical identity. It does not amend `L-V0-IDENTITY-01`.**

| Option | Result |
| --- | --- |
| 1. `dl-canonical-2` on `DownloadManifest`, hashing `SKIP` outcomes into the download-manifest identity | Rejected. That would change the download-manifest SHA domain `L-V0-IDENTITY-01` locked. This repair does not edit that decision. |
| 2. Keep `dl-canonical-1` as fetched-byte identity. Add a separate content-addressed prefetch-execution artifact, `pex-canonical-1`, whose identity binds every target outcome. | **Selected.** |

`prefetch_observations` is not added to `DownloadManifest`. `DownloadManifestIdentity.ts` is not modified.

`no_changes` is not used. Its existing meaning is a resolver plan `NO_CHANGES`: at least one listing page, `targets_produced === 0`, and a `listing_url`. A `SKIP` plan is `TARGETS` with one or more targets.

### 5.1 `pex-canonical-1`

The persisted body carries provenance and identity. `Timestamp` in `packages/mps-core/src/types.ts` is provenance. It does not participate in canonical identity, hashing, signing, or replay equality (`IMPORT-TIME-001`, `SV-I06`).

`observed_at` stays on each `SKIP` outcome in the body. It is the time of that live HEAD. It is excluded from the identity payload and from replay equality. The exclusion is an explicit list, `observed_at` only. No other outcome field is excluded.

The identity payload is:

- canonical version `pex-canonical-1`
- `execution_id`
- `source_id`, `source_content_hash`, `registry_artifact_id`
- `download_manifest_ref` — the `dl-canonical-1` reference, or null
- `outcomes` — one element per resolved target, sorted by `target_identity`

Every outcome carries an explicit discriminator. `FETCH` is not inferred from which citation fields are present.

A `FETCH` outcome is `outcome: "FETCH"`, plus `target_identity`, `locator_identity`, `file_name`, `quarantine_id`, `content_hash`, and `byte_length`. The citations must match the referenced manifest. They are not a second landing.

A `SKIP` outcome is `outcome: "SKIP"`, plus `target_identity`, `locator_identity`, `file_name`, `method: "HEAD"`, `reason_code: "REMOTE_REPRESENTATION_UNCHANGED"`, `validator_class: "STRONG_ETAG"`, `validator_token`, and `final_url`. The body also has `observed_at`. The identity payload does not. A `SKIP` outcome has no `quarantine_id`, `content_hash`, or `byte_length`.

`download_manifest_ref` is null only when every outcome is `SKIP`. When any outcome is `FETCH`, the reference is the manifest whose `objects` are exactly those `FETCH` outcomes and nothing else.

Replay equality compares identity payloads. Two bodies that differ only in `observed_at` are the same artifact. The evidence store keeps the first body, as the manifest store already does for non-identity fields.

### 5.2 Discriminated executor result

Today `HarvestExecutor.execute` returns `Promise<ContentReference>`. `HarvestOrchestrator.runHarvesting` saves that value as `manifest_ref` and calls `runVerification`. There is no type or state that can tell a download-manifest reference from a PEX reference. A comment that says "stop after persist" is not representable on that signature.

The integration unit changes the executor and the orchestrator together. The return type becomes:

```
{ kind: "DOWNLOAD_MANIFEST", ref: ContentReference }
| { kind: "PREFETCH_EVIDENCE", ref: ContentReference }
```

Dispatch uses `kind`. It does not inspect `ref.id`, a string prefix, or the hash.

| Run | Download manifest | Prefetch evidence | `execute` result |
| --- | --- | --- | --- |
| Every target `FETCH` | Today's manifest. One `DownloadedObject` per target. `no_changes` absent. | Not written. | `{ kind: "DOWNLOAD_MANIFEST", ref }` where `ref` is the `dl-canonical-1` reference. |
| Every target `SKIP` | Not written. No `objects: []` manifest. | `pex-canonical-1` with `download_manifest_ref: null` and one `SKIP` outcome per target. | `{ kind: "PREFETCH_EVIDENCE", ref }`. |
| Mixed | `dl-canonical-1` for the `FETCH` objects only. | `pex-canonical-1` whose identity includes that manifest reference, `outcome: "FETCH"` citations, and `outcome: "SKIP"` observations. | `{ kind: "PREFETCH_EVIDENCE", ref }`. |

### 5.3 Orchestrator state `PREFETCH_EVIDENCE_RECORDED`

`HarvestOrchestrator` handles the two kinds as follows.

`DOWNLOAD_MANIFEST`: save `ref` in checkpoint `manifest_ref`, transition `HARVESTING` → `HARVESTED`, then verify that reference as today. `prefetch_evidence_ref` stays absent.

`PREFETCH_EVIDENCE`: save `ref` in a new checkpoint field `prefetch_evidence_ref`. Leave `manifest_ref` absent, including when the PEX body cites a download manifest. Transition `HARVESTING` → `PREFETCH_EVIDENCE_RECORDED`. Do not transition to `HARVESTED` or `VERIFYING`. Do not call `VerificationExecutor`, compliance, import, or projection with the PEX reference or with `download_manifest_ref`.

`PREFETCH_EVIDENCE_RECORDED` is terminal. Its only edges are none. Re-invocation of a terminal checkpoint returns that state and does not resume harvesting, verification, or import. `produced_artifacts` contains the PEX reference. `evidence_refs` stays empty. The checkpoint's `updated_at` remains non-canonical, as it is today.

A crash while the checkpoint is still `HARVESTING` re-enters `execute` on the next run. That retry is not verification of a PEX file left on disk. If the retry's result kind is `PREFETCH_EVIDENCE`, it takes the terminal path above. It does not look at an id prefix and decide the file was a download manifest.

Until this integration unit lands, the current `Promise<ContentReference>` signature stays. No production resolver may declare `STRONG_ETAG`. No production `SKIP` may be reachable. An all-`FETCH` wiring may return a download-manifest reference into the current orchestrator only when production composition proves `SKIP` unreachable. A PEX reference must not be returned into the current `HarvestOrchestrator`.

Rejected bodies:

| Model | Why it is rejected |
| --- | --- |
| Omit `SKIP` targets and persist the `FETCH` objects as the execution result | The returned reference does not bind the skipped targets. |
| Synthesize a `DownloadedObject` for a `SKIP` | No bytes were acquired. |
| Reuse a prior `quarantine_id` or `content_hash` on that synthetic object | Those values were not observed in this episode. |
| Put outcomes on `DownloadManifest` outside `dl-canonical-1` | Replay identity ignores them. |
| Change `dl-canonical-1` or add `dl-canonical-2` for this purpose | Amends the locked download-manifest domain. |
| Fold `SKIP` into `no_changes` | The resolver did produce targets. |
| Keep `Promise<ContentReference>` and rely on the caller not to verify a PEX reference | The current orchestrator always stores the return value as `manifest_ref` and verifies it. |
| Choose the artifact by an id prefix, or store the PEX reference in `manifest_ref` | There is no discriminator, so verification cannot tell the two references apart. |

## 6. E — Order and failure semantics

Per resolved target, after the existing pre-loop `REJECT_URL_SCOPE` check on every `target.url`:

1. The resolver has already set `targetIdentity` and either a real authority or `null`.
2. Call `decidePrefetch`. The executor does not mint authority and does not send `If-None-Match` itself.
3. No valid authority, no single binding, a binding mismatch discovered before the exchange, or a reserved class: the port returns `FETCH` and does **not** call the exchange. Continue at step 6.
4. Otherwise the exchange performs one conditional HEAD under section A.
5. `SKIP` / `REMOTE_REPRESENTATION_UNCHANGED` only when the port says so, which already includes a successful `touchObservedAt`. Do not call `get()`. Keep that target as a `SKIP` outcome for `pex-canonical-1`. A failed touch is `FETCH`, not `SKIP`.
6. `FETCH` continues to the existing `fetchOne` only for the reason codes listed below.
7. After a successful `fetchOne`, section C may replace the binding.
8. After the whole target list, persist and return under section D. Do not put the outcomes on the download manifest.

`PrefetchDecision = FETCH` means `SKIP` is forbidden. It does not always mean `get()`.

| Reason after `decidePrefetch` | Next step |
| --- | --- |
| `SIGNAL_CLASS_FORBIDDEN` | `fetchOne`. This is every current production target. |
| `NO_PRIOR_BOUND_TOKEN` | `fetchOne`. |
| `LOCAL_NON_AUTHORITY` | `fetchOne`. |
| `VALIDATOR_EXCHANGE_UNSUPPORTED` | `fetchOne`. Before the exchange, this is still method other than `HEAD`, a missing exchange, or `performLiveExchange` false. After the exchange returns, it is only `failure === "unsupported"`, read before status interpretation. |
| `SIGNAL_MISSING` | `fetchOne`. |
| `SIGNAL_UNVERIFIABLE` | `fetchOne`. Includes several bindings, a divergent 304, a weak token, and a corrupt store read. |
| `BINDING_MISMATCH` | `fetchOne` of `target.url` only, never of a redirected final URL. |
| `UPSTREAM_UNAVAILABLE` | `fetchOne`. HEAD timeout or 5xx does not block acquisition. |
| `REPRESENTATION_CHANGED` | `fetchOne`. The HEAD 200 body is not the acquisition. |
| `RESUME_UNSUPPORTED` | `fetchOne` as a full GET. `fetchOne` sends no `Range`. The HEAD body is not landed. |
| `SCOPE_VIOLATION` | **Hard stop.** Do not call `get()`. A scope failure softened into GET would be a governance bypass. |
| `UPSTREAM_UNAUTHORIZED` | **Hard stop.** Do not call `get()`. The credential already refused this locator. |
| `REMOTE_REPRESENTATION_UNCHANGED` | No `get()`. |

Hard stop throws a `GovernedDownloadError` that keeps the prefetch reason code. No successful manifest is persisted. Earlier targets may already have landed in quarantine, which is the executor's existing throw-after-put behaviour. They must not be persisted as a complete run.

Politeness uses the source's existing `rate_limit_requests_per_second` and `politeness_delay_ms`. It applies before every outbound HTTP request of the execution except the first. A target that performs HEAD and then GET waits between those two requests. The wait is not inside `DownloadTransport.get`. `fetchOne`'s own retry backoff stays the retry delay and is not a second politeness policy.

HEAD is one attempt. It does not use `retry_policy.max_attempts`. Retrying HEAD could turn a transient into a later `304` and `SKIP`. GET retries stay inside `fetchOne`, and only `REJECT_HTTP_STATUS` remains retryable there.

Store read failure and multi-record reads do not delete the key and do not `SKIP`. Store write failure on touch sends the target to `fetchOne`. Store write failure on replace follows section B and section C.

## 7. F — No production capability

This design does not declare `STRONG_ETAG` on `PUH_RATTSPRAXIS_V1`, `SINGLE_ENDPOINT_V1`, `LM_STAC_BYGGNADER_V1`, or any other production resolver.

A later wiring of the chain, with those resolvers left as they are, takes this path for every current production target:

`authority null → decidePrefetch → FETCH / SIGNAL_CLASS_FORBIDDEN → no HEAD → existing get() → existing manifest`

No source is selected here. No registry hash changes. No adapter flag is added.

## 8. Target state machine

```
resolver target
  → URL scope of target.url (existing; fail the run if outside)
  → decidePrefetch
      → authority? no → FETCH, no HEAD
      → binding lookup
          → 0 records → FETCH, no HEAD
          → ≠1 or corrupt → FETCH / SIGNAL_UNVERIFIABLE, no HEAD
          → field mismatch → FETCH / BINDING_MISMATCH, no HEAD
          → one strong token → one conditional HEAD
              → failure "unsupported" → FETCH / VALIDATOR_EXCHANGE_UNSUPPORTED, then GET
              → thrown error or failure "unavailable" → FETCH / UPSTREAM_UNAVAILABLE, then GET
              → scope or 401/403 → hard stop, no GET
              → 304 same strong token + touch persisted → SKIP
              → touch failed → FETCH
              → any other HEAD result → FETCH
  → SKIP: observation only, no bytes
  → FETCH: existing GET / quarantine
      → optional binding replace from that GET's ETag
  → every target FETCH: { kind: "DOWNLOAD_MANIFEST" } then HARVESTED → verification
  → any SKIP: { kind: "PREFETCH_EVIDENCE" } then PREFETCH_EVIDENCE_RECORDED
      manifest_ref stays empty
      VerificationExecutor is not called
```

A `SKIP` of one target does not cover its siblings.

HEAD proves the validator at that observation only. It does not prove that the following GET, or a later run's GET, returns the same bytes. `RESUME` stays unsupported.

## 9. Failure matrix

Prefetch reason codes stay the ones `PrefetchValidator` already returns. Wiring adds only the "what happens next" column.

| Condition | Decision | Reason | Wiring |
| --- | --- | --- | --- |
| No `STRONG_ETAG` authority | `FETCH` | `SIGNAL_CLASS_FORBIDDEN` | GET, no binding write |
| Store empty | `FETCH` | `NO_PRIOR_BOUND_TOKEN` | GET |
| Store corrupt or not exactly one record | `FETCH` | `SIGNAL_UNVERIFIABLE` | GET, no `SKIP` |
| Binding source hash, registry id, locator, target or declared file name differs | `FETCH` | `BINDING_MISMATCH` | GET of `target.url` |
| HEAD cannot be expressed before the exchange (method other than `HEAD`, exchange absent, or `performLiveExchange` false) | `FETCH` | `VALIDATOR_EXCHANGE_UNSUPPORTED` | GET. No exchange call |
| Unfollowed HEAD 301, 302 or 303 | `FETCH` | `VALIDATOR_EXCHANGE_UNSUPPORTED` | Exchange sets `failure: "unsupported"`. No second HEAD. No GET inside the exchange. Mapped before status interpretation |
| Runtime exposes a non-null HEAD body | `FETCH` | `VALIDATOR_EXCHANGE_UNSUPPORTED` | Cancel the stream. Do not read it. Do not set `body`. `failure: "unsupported"`. Not a throw. `Content-Length` alone does not do this |
| HEAD timeout, transport error, HTTP 5xx | `FETCH` | `UPSTREAM_UNAVAILABLE` | GET. A throw stays this reason. It is not `failure: "unsupported"` |
| HEAD 401 or 403 | `FETCH` | `UPSTREAM_UNAUTHORIZED` | no GET, run fails |
| HEAD scope or redirect off scope | `FETCH` | `SCOPE_VIOLATION` | no GET, run fails |
| HEAD 304 without the same strong ETag | `FETCH` | `SIGNAL_MISSING` or `SIGNAL_UNVERIFIABLE` | GET |
| HEAD final URL differs | `FETCH` | `BINDING_MISMATCH` | GET of `target.url` only |
| HEAD 200, body null | `FETCH` | `REPRESENTATION_CHANGED` | GET. Length metadata is ignored. No HEAD byte is quarantined |
| HEAD 206 | `FETCH` | `RESUME_UNSUPPORTED` | full GET, no Range |
| Touch cannot persist | `FETCH` | `SIGNAL_UNVERIFIABLE` | GET |
| All §8 conjuncts and touch persisted | `SKIP` | `REMOTE_REPRESENTATION_UNCHANGED` | no GET |
| GET 200, no strong ETag, or no `finalUrl` match, or no authority | `FETCH` acquisition | — | quarantine, no binding write |
| GET landed, binding replace fails | `FETCH` acquisition | store failure | no manifest success, no `SKIP` |
| Any `SKIP` before `pex-canonical-1` exists | — | evidence artifact absent | do not persist an empty or partial download manifest as the execution result |

## 10. Proposed implementation seams

Not in this unit.

| Seam | Later change |
| --- | --- |
| `HttpConditionalHeadExchange` | New. Implements `ConditionalValidatorExchange`. Does not call `get()`. |
| `DownloadTransport` / `HttpDownloadTransport.get` | Unchanged. No `head()`, no conditional headers, body still read for GET. |
| `DownloadResponse.finalUrl` | Added before any binding replace. Not a manifest field. |
| `FileValidatorBindingStore` | New recall store. `InMemoryValidatorBindingStore` stays for tests. |
| `GovernedDownloadExecutor` | Calls `decidePrefetch`, then section E. Returns the discriminated result from section 5.2. Does not reimplement the conjuncts. |
| `HarvestExecutor` / `HarvestOrchestrator` | Same integration unit. `DOWNLOAD_MANIFEST` keeps today's `manifest_ref` path. `PREFETCH_EVIDENCE` writes `prefetch_evidence_ref` and stops in terminal `PREFETCH_EVIDENCE_RECORDED`. |
| `HarvestRuntimeCompositionRoot` | Injects the store and the source-scoped HEAD exchange next to the existing executor transport. Production composition must prove `SKIP` unreachable until that integration unit lands. |
| `pex-canonical-1` evidence store | New artifact. `observed_at` is body provenance, not identity. Not a field on `DownloadManifest`. Required before any `SKIP` result is returned. |
| `DownloadManifestIdentity.ts` | Not modified. Stays `dl-canonical-1`. |
| `PrefetchValidator.ts` | Later implementation adds `"unsupported"` to `ConditionalExchangeResponse.failure` and maps `failure === "unsupported"` to `FETCH` / `VALIDATOR_EXCHANGE_UNSUPPORTED` before status interpretation. It does not throw for that case. That modified port requires its own independent execution re-verification. The prior scoped **EXECUTION_VERIFIED** status must not be widened automatically. This unit does not edit the file. Corruption must still surface as `SIGNAL_UNVERIFIABLE`, not as an empty resolve. |
| Production resolvers | No `strongEtagCapabilityDeclaration`. |

## 11. RED matrix for the later implementation

These are the assertions a later RED commit must fail against the unwired tree. They are not tests in this unit.

| ID | Assertion |
| --- | --- |
| HW-A1 | A `SKIP` path does not call `DownloadTransport.get`. |
| HW-A2 | No request uses method `GET` together with `If-None-Match`. |
| HW-A3 | `If-None-Match` is the single bound token and no list. |
| HW-A4 | A redirect off scope is `SCOPE_VIOLATION` and `get()` is not called. |
| HW-A5 | 301 and 302 are not followed, without claiming they rewrite `HEAD` to `GET`. 303 is not followed. The refusal is `failure: "unsupported"`, with no second HEAD and no GET inside the exchange. 307/308 stay `HEAD`, each hop scope-checked, and `finalUrl` is the terminal URL. |
| HW-A6 | `Content-Length > 0` with `response.body === null` is still a valid HEAD observation and is not quarantined. A non-null HEAD body is cancelled, not read, and is `failure: "unsupported"`. |
| HW-A7 | HEAD timeout or 5xx is one attempt, then GET. HEAD is not retried. |
| HW-A8 | HEAD 401/403 does not call GET. |
| HW-B1 | The file key is only `sourceId`, `locatorIdentity`, `targetIdentity`. |
| HW-B2 | A second record, or a corrupt body, is `SIGNAL_UNVERIFIABLE`, not `NO_PRIOR_BOUND_TOKEN`, and not `SKIP`. |
| HW-B3 | A failed touch does not `SKIP`. |
| HW-B4 | Process restart still resolves the one record. The in-memory class is not the production store. |
| HW-B5 | A second process cannot bind the same named pipe. A second bind in the same process is rejected. After clean exit or abrupt termination, the next process binds without a timeout, a PID probe, an `mtime` check, or a delete-first step. `proper-lockfile`, `mkdir`, `mtime`, `O_EXCL` as ownership, and a stale timeout are rejected. Touch is not cross-process CAS. |
| HW-B6 | A leftover lease record does not block acquisition while the pipe is free. The same record does not grant acquisition while another process holds the pipe. |
| HW-B7 | Two distinct store roots do not share a pipe name. The same root maps to the same pipe name in two processes. The hash is not truncated, and the name does not contain `targetIdentity`. |
| HW-B8 | If the named pipe cannot be established, construction fails closed and does not switch to a file heuristic. |
| HW-C1 | A 200 GET without an ETag still quarantines and writes no binding. |
| HW-C2 | A strong ETag with valid authority and `finalUrl === target.url` replaces the binding only after checksum-verified `quarantine.put`. |
| HW-C3 | Missing `finalUrl`, a different final URL, a weak tag, a tag list, or a missing authority writes no binding. |
| HW-C4 | An ETag in `source_metadata` or `change_detection: ETAG` writes no binding. |
| HW-C5 | A failed binding replace does not persist a successful manifest and does not `SKIP`. |
| HW-D1 | All-`FETCH` persists today's object list and no `no_changes`. |
| HW-D2 | All-`SKIP` persists `pex-canonical-1` with a null manifest reference. It does not persist `objects: []` and it does not use `no_changes`. |
| HW-D3 | A mixed run whose evidence omits a `SKIP` target is refused. `execute` returns `{ kind: "PREFETCH_EVIDENCE" }`, not a bare download-manifest reference. |
| HW-D4 | A `SKIP` outcome is not a `DownloadedObject` and does not reuse a prior `quarantine_id` or `content_hash`. |
| HW-D5 | Same execution and source, `objects` empty, `SKIP` of target A versus target B: two different `pex-canonical-1` digests. `dl-canonical-1` does not contain those outcomes. |
| HW-D6 | Same fetched objects and different skipped targets: two different `pex-canonical-1` digests. The download-manifest digest may match. The returned reference does not. |
| HW-D7 | Changing only `observed_at` keeps the same `pex-canonical-1` digest. Changing `target_identity`, the `FETCH`/`SKIP` discriminator, `validator_token`, or `final_url` changes the digest. |
| HW-D8 | A `FETCH` outcome whose discriminator is missing is refused, even when the citation fields are present. |
| HW-E3 | `kind: "PREFETCH_EVIDENCE"` is stored in `prefetch_evidence_ref`, moves to terminal `PREFETCH_EVIDENCE_RECORDED`, and does not call `VerificationExecutor`. Resume of that checkpoint does not harvest again and does not verify. A PEX reference in `manifest_ref`, or a dispatch on `ref.id`, is rejected. |
| HW-E1 | Politeness delay runs between HEAD and the following GET. |
| HW-E2 | One target's `SKIP` does not `SKIP` its sibling. |
| HW-F1 | With the production resolver map unchanged, every target is GET, no HEAD is sent, and the manifest is the current all-`FETCH` body. |
| HW-F6.1 | A returned exchange `failure` of `"unsupported"` is `FETCH` / `VALIDATOR_EXCHANGE_UNSUPPORTED`, before interpretation of `status`, `finalUrl`, `etag` or `body`. |
| HW-F6.2 | An unfollowed 301, 302 or 303 is `failure: "unsupported"`. The exchange sends no second HEAD and no GET. |
| HW-F6.3 | An actual non-null HEAD body is cancelled and not read. The response does not carry those bytes. The result is `failure: "unsupported"`. |
| HW-F6.4 | A timeout or other transport exception stays `UPSTREAM_UNAVAILABLE`. It is not reported as `failure: "unsupported"`. |

## 12. Non-actions

This unit does not:

- add or modify product code, tests, registry entries, transports, the executor, or `PrefetchValidator.ts`
- add `prefetch_observations`, `DownloadResponse.finalUrl`, `FileValidatorBindingStore`, or the `pex-canonical-1` store
- change `DownloadManifestIdentity.ts`, `dl-canonical-1`, or `L-V0-IDENTITY-01`
- declare `STRONG_ETAG` on a production resolver
- select a source
- wire `decidePrefetch`
- send a conditional GET
- touch CAS, Librarian, PostGIS, U51, G814 or F-4

## 13. Status

- **L-V0-HEAD-WIRING-CONTRACT-01 — HEAD_WIRING_CONTRACT_CLOSED / IMPLEMENTATION_NOT_STARTED.**
- **L-V0-STRONG-ETAG-AUTHORITY-IMPL-01** stays the scoped **EXECUTION_VERIFIED** named in the header. This document does not widen it. The later change to `PrefetchValidator.ts` that carries `failure: "unsupported"` is outside that scope. That modified port requires its own independent execution re-verification. The prior scoped **EXECUTION_VERIFIED** status must not be widened automatically. This contract does not assign **EXECUTION_VERIFIED** to the repaired port.
- **L-V0-PREFETCH-VALIDATOR-IMPL-01** stays **IMPLEMENTED_PORT / NOT_RUNTIME_WIRED**.

The next implementation unit may wire the all-`FETCH` production path only while production composition proves `SKIP` unreachable, and only by returning a download-manifest reference into the current orchestrator. A `SKIP` result waits for the section 5.2 integration. That unit must not declare `STRONG_ETAG` on a production source, and it must not implement the binding lease with `proper-lockfile`, `O_EXCL`, or a PID or `mtime` reclaim. Windows V0 ownership is the named pipe in §3.1. |
