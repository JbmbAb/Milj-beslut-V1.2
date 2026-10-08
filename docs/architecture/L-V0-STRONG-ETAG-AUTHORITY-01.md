# L-V0-STRONG-ETAG-AUTHORITY-01 — design

**Status: ADAPTER_AUTHORITY_ACCEPTED / HEAD_ONLY_V0 / IMPLEMENTATION_NOT_STARTED.**

This note does not assign VERIFIED, PROVEN, COLD_VERIFIED or EXECUTION_VERIFIED.

No product code. No schema change. No source selection. No runtime wiring. No push.

| | |
| --- | --- |
| Unit | L-V0-STRONG-ETAG-AUTHORITY-01 |
| Start HEAD | `6bd82fc87a412db47c85cce572dbf1a4085eb408` |
| Start tree | `a07b00cd707b8ccc57e77e071bb03dab3c7ca46b` |
| Normative contract | [L-V0-PREFETCH-VALIDATOR-CONTRACT.md](./L-V0-PREFETCH-VALIDATOR-CONTRACT.md) at `321b588cdcd9cf1cf1d5e7dabc6aa435bd16edd0` |
| Port under review | `PrefetchValidator.ts` at the start HEAD |
| Static review | `LOKE-STRONG-ETAG-AUTHORITY-STATIC-REVIEW-2026-10-06.md`, SHA-256 `5787F3DE75FF2BE0F3DDA796005739C8A9A269435A9548F4432C52C623511946` |

## 0. Status of the port this unit does not change

L-V0-PREFETCH-VALIDATOR-IMPL-01 is:

- **WORKING / DESIGN_EXTENSION_RESOLVED_PENDING_IMPLEMENTATION**
- **IMPLEMENTED_PORT / NOT_RUNTIME_WIRED**

The design extension is resolved on paper by sections 6 and 7. The boolean is still in the code. Wiring has not started.

`PrefetchTargetRequest.strongEtagCapability: boolean` is a caller assertion. It is not SKIP authority. This document chooses the authority design. It does not replace the boolean.

`decidePrefetch` is not called from `GovernedDownloadExecutor` or `HarvestRuntimeCompositionRoot`.

## 1. Question

Q1 of the closed contract says SKIP requires a registry or adapter `STRONG_ETAG` capability: for this source and locator, an equal strong ETag token means the same representation. Syntax without that declaration is `FETCH`. `change_detection.strategy` is not that declaration. Provider fields are not sniffed into the class.

The open point is whether an adapter declaration can be that authority without a new registry field.

## 2. What is already bound

`calculateSourceRegistryContentHash` covers `adapter` together with `source_id`, producer, channel, artifact types, collection frequency, `change_detection`, policy and geographic scope. The approval predicate binds `source_id` and `source_content_hash` to that digest, and the attestation subject digest is `sha256:` of the same hash. `verifySourceRegistryArtifact` copies `adapter`, `registryArtifactId` and `sourceContentHash` onto `VerifiedSourceDefinition` only after those checks.

`VerifiedSourceDefinition` does not carry `change_detection`. The runtime therefore has no strategy field to treat as capability.

`DownloadTargetResolverRegistry.resolve` loads the verified source, then selects `resolvers[source.adapter]`. A missing source is `REJECT_SOURCE`. A missing resolver is `REJECT_ADAPTER`. There is no fallback that fetches the endpoint under another adapter, and no inference from the URL.

`PRODUCTION_ADAPTER_RESOLVERS` is keyed by the same adapter string. The composition root states that the signed entry, not code, chooses the adapter, and that an adapter with no approved source is not registered. Unknown adapter still fails closed in the resolver registry.

`DownloadTarget.source_metadata` is documented as provenance transport, not classification. The executor copies it nested and does not interpret it.

## 3. Alternative A — adapter authority

### 3.1 Decision

Adapter authority is legitimate under the closed contract.

The contract's trust binding is a registry declaration or an adapter declaration. The adapter alternative is not a second content hash. Q1 already accepted the residual that a declaration which names a careless origin will SKIP. Putting the capability bit itself into `sourceContentHash` would be a stricter policy than that closure.

The resolver registry is the existing fail-closed binding from the attested adapter id to the only code allowed to speak for that source. A capability minted by that resolver, for the verified source it was given and the target it emitted, is the adapter declaration Q1 names. A caller boolean is not.

### 3.2 What is cryptographic, and what is logical

Cryptographic, already: the adapter id on the approved source. Changing `artifact.adapter` changes `sourceContentHash` and breaks the current attestation.

Logical, required by a later implementation, not built here: the capability token is minted only on the resolver path `DownloadTargetResolverRegistry` selected. The token carries `sourceId`, `sourceContentHash`, `registryArtifactId` and `adapterId` copied from that verified source. `locatorIdentity` is the canonical locator that same resolver emitted. `targetIdentity` is not on `DownloadTarget` today. Section 6 requires one construction of it at the resolver boundary, then the same value on the token, the request and the binding store.

`PrefetchValidator` does not mint the token, does not switch on source id, does not read `change_detection`, does not read `source_metadata`, and does not invent a locator or a target identity. It accepts the token or it does not.

Not cryptographic: the predicate inside the adapter module. A later edit that starts minting tokens does not change `sourceContentHash` and does not force re-approval. That is the adapter declaration Q1 already chose. It is not fixed by this note. An owner who later wants the bit inside the attestation needs alternative B as a new unit.

### 3.3 Shape a later implementation must have

`strongEtagCapability: boolean` is removed from the decision request. The request carries `strongEtagAuthority: DeclaredStrongEtagAuthority | null`, plus `adapterId` copied from `VerifiedSourceDefinition.adapter` by the caller that already holds the verified source. The decision port does not look the adapter up.

`DeclaredStrongEtagAuthority` is runtime-verifiable issuance from that resolver path. A TypeScript brand, a cast, or `as` is not issuance. The mint function lives with the resolver, not in `PrefetchValidator`. The harvest caller of `decidePrefetch` cannot pass `true`, a plain object, or a cast.

Eligibility of the capability conjunct, and only that conjunct, requires all of:

- the value passes the runtime issuance check, not a compile-time cast
- `authority.sourceId` equals the request `sourceId`
- `authority.sourceContentHash` equals the request `sourceContentHash`
- `authority.registryArtifactId` equals the request `registryArtifactId`
- `authority.adapterId` equals the request `adapterId`
- `authority.locatorIdentity` equals the request `locatorIdentity`
- `authority.targetIdentity` equals the request `targetIdentity`

Any miss, a boolean, a plain object, or a null authority is `FETCH` / `SIGNAL_CLASS_FORBIDDEN`. No exchange is sent. Eligibility is not `SKIP`. The other conjuncts in contract §8 stay in force.

`file_name`, when the adapter declares it, stays an independent binding check on the recall record. `targetIdentity` is the single value defined in section 6. `PrefetchValidator` does not derive it, and the caller does not invent a second one.

No production adapter mints a token in this unit. `SingleEndpointTargetResolver`, `PuhRattspraxisTargetResolver` and `LantmaterietStacByggnaderTargetResolver` stay without a capability declaration. Until a later unit adds a mint at a specific resolver, every real source is unknown capability and the port's answer remains `FETCH`. This note does not choose that resolver.

### 3.4 Tests a later unit must be able to run

| Case | Result |
| --- | --- |
| Branded authority whose six fields equal the request | Capability conjunct eligible |
| `authority.adapterId` differs | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| `authority.sourceContentHash` differs | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| `authority.registryArtifactId` differs | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| `authority.locatorIdentity` differs | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| `authority.targetIdentity` differs | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| Caller passes `true`, a plain object, or a TypeScript cast | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| Caller supplies a `targetIdentity` other than the resolver-boundary value | `FETCH` / `BINDING_MISMATCH` |
| `change_detection.strategy` is `ETAG`, authority is null | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| `source_metadata` carries an ETag or a flag, authority is null | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| Null, missing brand, or unknown kind | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |

These tests are not in the tree. Writing them is a later RED.

## 4. Alternative B — registry schema authority

A field on `SourceRegistryArtifact`, for example a per-locator `STRONG_ETAG` declaration, would put the bit in the hashed body.

Consequences, none of which are done here:

- **Schema.** `SourceRegistryArtifact` and the shape check gain a field the canonical JSON must always include. A source-level boolean would not name a locator. A locator list can name locators the registry already stores, such as `channel.endpoint_url`. `targetIdentity` often includes the adapter-chosen `file_name`, which is not a registry field today. The schema would still not by itself name target identity unless that identity is also stored and hashed.
- **Hash.** `calculateSourceRegistryContentHash` includes the new field. Adding a key changes the canonical bytes even when the value is absent. Every current `source_content_hash` changes.
- **Re-attestation.** The approval predicate and the subject digest both bind that hash. Every existing APPROVED attestation fails verification after the hash changes. Each entry needs a new governance signature. There is no compatible default that preserves old digests.
- **Existing artifacts.** `source-registry/national-registry.json` cannot verify until every entry has the field and a new attestation. Entries that will not declare capability still change hash, because absence must be canonical.
- **Migration cost.** One coordinated re-approval of the whole approved set, plus runtime code that reads the new field off `VerifiedSourceDefinition`. No partial rollout keeps old signatures valid.

That cost is real, and it is not required to satisfy Q1. It is the path that makes the capability bit itself part of `sourceContentHash`.

## 5. Disposition

**ADAPTER_AUTHORITY_ACCEPTED / HEAD_ONLY_V0 / IMPLEMENTATION_NOT_STARTED**

`DownloadTargetResolverRegistry` is enough, under the closed contract, because it already binds the attested adapter id to one resolver and fails closed otherwise. The capability token must still carry the six identity fields, and issuance must be runtime-verifiable from that resolver path. The boolean in `PrefetchTargetRequest` remains in the code until that later implementation. Section 6 and section 7 are normative for it. Section 7 freezes HEAD-only V0. It does not start wiring.

## 6. Constraints pinned by the 2026-10-06 static review

The review accepts section 3.1. It does not start implementation. No product file changes in that review, and none in this pin.

### 6.1 A1 — runtime issuance

A structural TypeScript brand is not authority. A later implementation must make issuance observable at runtime. A generic caller must not fabricate it with a cast, a plain object, or a boolean. The capability originates on the registry-selected resolver path. `PrefetchValidator` may validate the opaque authority and the bound fields. It must not mint it.

### 6.2 A2 — one targetIdentity at the resolver boundary

`DownloadTarget` today has `url`, `file_name` and `source_metadata`. It has no `targetIdentity`. The sentence in earlier drafts that the resolver already produces that identity is withdrawn.

The later implementation defines one deterministic target identity at the resolver boundary, including adapter-declared `file_name` when the adapter declares it. The same value is the authority token's `targetIdentity`, `PrefetchTargetRequest.targetIdentity`, and the `ValidatorBindingStore` key. The caller must not invent a parallel identity.

### 6.3 A3 — adapter code is not registry attestation

The capability predicate stays outside `sourceContentHash`. That is the closed Q1 adapter declaration. Governance of the adapter implementation is part of the trust chain. Evidence must say so. The capability bit must not be described as registry-attested.

### 6.4 §8.1 — closed for V0 by section 7

The open choice in the static review is closed below. Conditional GET is not a V0 path.

## 7. Coordinator decision — HEAD-only V0

**DECISION: HEAD-ONLY V0.**

L-V0 uses HEAD-only for strong-ETag validation in the first implementation.

Conditional GET is not in V0. No code path may perform a conditional GET in which a `200 OK` body can be received and then discarded. GET-handoff waits for a separate governed design step if that need appears.

Contract §8.1 still says a content-bearing conditional GET is the acquisition. V0 does not enter that path. A later handoff unit would have to land that body in the existing quarantine, hash and manifest path. This decision does not build that unit.

The smallest runtime chain, when implementation starts, is:

`registry → resolver → targetIdentity → authority issuance → HEAD request → validator → binding store`

Normative invariants:

- The resolver selected through the registry is the only allowed issuance path.
- `targetIdentity` is created exactly once at the resolver boundary.
- The same `targetIdentity` is on the authority token, the HEAD request's binding, and the persisted binding.
- `PrefetchValidator` may consume and verify authority. It must not create it.
- Adapter capability must not affect `sourceContentHash`.
- No URL fallback, implicit adapter, or synthetic authority is allowed.

A HEAD response with a strong ETag proves the representation validator at that observation. It does not prove that a later GET returns the same representation. The HEAD result is a prefetch validator and a binding update. It is not a stronger end-to-end content guarantee than the closed contract gives. `RESUME` stays a separate, unsupported path.

Wiring has not started. No schema change and no broader refactor are part of this decision.
