# L-V0-PREFETCH-VALIDATOR-CONTRACT

**Status: DECIDED / CLOSED.**

This note does not assign VERIFIED, PROVEN, COLD_VERIFIED or EXECUTION_VERIFIED.

It is a contract and design unit only. It does not change product code, does not select an upstream source, does not amend `L-V0-IDENTITY-01`, and does not change CAS, Librarian, PostGIS, U51, G814, F-4 or any integration branch.

| | |
| --- | --- |
| Unit | `L-V0-PREFETCH-VALIDATOR-CONTRACT` |
| Branch | `feature/loke-v0` |
| Worktree | `D:\mimer-loke-v0` |
| Design evidence | `008894e7667916d5d82a18c2c61ec9e4f6d704dc` |
| Normative identity decision | `286b7f519a4618350ba09eb5ec75e0ef4a69f7db` |
| Identity status lock | `5fddb5cb405601b8183e7a4a9bd1101c2185a47c` |
| Open draft | `30a9b18dd53c697ec65113f5f403fe516fbcc596` |
| Superseded historical closure | `32fb3e6c0b4c44bc32029c4681e66f7f563ff216` |
| Owner closure of Q1–Q7 | this document |
| Selects source | none |
| Implements | nothing |

`32fb3e6c` is superseded historical state. It is not revived. That commit closed a looser path: syntactic strong ETags, a naked `304`, and an implementation unit. This closure is stricter and is the normative contract. `30a9b18d` remains the draft that listed Q1–Q7. `L-V0-IDENTITY-01.md` is unchanged.

## 0. Purpose

Define when a pre-fetch decision may be `SKIP` or must be `FETCH`.

> Given an approved source and one resolved target, may Loke refrain from acquiring the current remote representation, and on what upstream proof?

The only V0 proof is:

```text
one registry-authorized strong ETag, already bound to this target
  → conditional GET or HEAD on the same canonical locator
  → If-None-Match carries that single ETag
  → 304 echoes that same strong ETag
  → SKIP
```

Everything else is `FETCH`.

The contract does not define inventory completeness, post-fetch deduplication, resume, reharvest, CAS admission, Librarian import or PostGIS materialization.

## 1. Normative rules already closed

These come from `L-V0-IDENTITY-01` and the status lock. They are not reopened.

1. `DownloadManifest` identity and its SHA domain do not change to enable pre-fetch `SKIP`. Manifest identity stays a provenance and execution identity, not a cache key.
2. `SKIP` is not deduplication. `SKIP` is an upstream-verified claim that the resource which would otherwise be acquired is identical to the resource version already bound to the current target identity.
3. A local `DownloadManifest` hash, quarantine hash, CAS hash or local cache must not by itself yield `SKIP`.
4. A missing, stale, ambiguous or unverifiable signal yields `FETCH`. Upstream unavailable yields `FETCH`. Never a heuristic `SKIP`.
5. `RESUME` is a separate capability and stays unsupported until a contract can prove that the byte range belongs to the same immutable remote representation. HTTP Range alone is not that proof.
6. No Loke-owned inventory store. The `ValidatorBindingRecord` in §5 is recall state, not inventory.
7. No change to CAS, Librarian or PostGIS.
8. Post-fetch quarantine dedup may show that bytes matched after a fetch. That result is not `SKIP`.
9. No upstream source is chosen in this unit.

Canonical invariant:

> `SKIP` är inte deduplicering. `SKIP` är ett upstream-verifierat påstående att den resurs som annars skulle hämtas är identisk med den resursversion som redan är bunden till aktuell target-identitet.

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| **Target** | One acquisition unit: approved source, one canonical locator, and the target identity in §4.3. |
| **Remote representation** | The immutable upstream byte sequence a successful content GET of that target would return at decision time. |
| **STRONG_ETAG capability** | A registry or adapter declaration that, for this source and locator, an equal strong ETag token means the same representation. It is a trust binding, not an extra hash check, and not “any ETag without `W/`”. |
| **Validator signal** | The upstream ETag observed on a live conditional exchange, accepted only when that capability is declared. |
| **Live affirmation** | A conditional GET or HEAD performed for this decision episode. A stored token is not live. |
| **ValidatorBindingRecord** | Recall of one earlier upstream token for one target. Not authority. |
| **Decision** | Exactly one of `SKIP` or `FETCH`. |
| **FETCH** | Acquire the current representation through the existing governed download path. Every fail-closed case is `FETCH`. |
| **SKIP** | Do not take another content-bearing acquisition of this target in this episode, because the live `304` echoed the single bound strong ETag. |

`change_detection.strategy` (`ETAG`, `LAST_MODIFIED`, `CONTENT_HASH`, `NONE`) is a registry hint. It is not a `STRONG_ETAG` capability and not authority to `SKIP`.

## 3. Decisions

```text
PrefetchDecision ::= SKIP | FETCH
```

| Outcome | Legal when | Must not mean |
| --- | --- | --- |
| `SKIP` | Every conjunct in §8 holds | Local dedup, cache hit, prior manifest equality, quarantine byte equality, CAS presence, a replayed historical token, a naked `304` |
| `FETCH` | Any conjunct fails, or the case is unclassified | A license to drop the observation, to call CAS, or to resume a partial object |

There is no third pre-fetch outcome. `RESUME` is not one.

## 4. Identity binding

A comparison is identity-bound only when source binding, remote-representation binding and target binding are all present and refer to the same object. Equality is exact. No silent aliasing. No sniffed provider field.

### 4.1 Source binding

Required, from the verified APPROVED registry entry of this run:

- `source_id`
- `source_content_hash` — hash of the registry entry that authorized the run
- `registry_artifact_id`
- a declared `STRONG_ETAG` capability for this source and locator

A signal observed under another registry entry, another `source_content_hash`, or a non-APPROVED lifecycle does not bind. Prior bindings under an older `source_content_hash` do not authorize `SKIP` after re-approval.

Absence of the capability declaration is `FETCH` / `SIGNAL_CLASS_FORBIDDEN`, even if the origin sent an ETag without `W/`.

### 4.2 Remote-representation binding

Required:

- `locator_identity` — the locator the registry or adapter already treats as canonical for this target
- `validator_class` — `STRONG_ETAG` for any V0 `SKIP`
- `validator_token` — exactly one strong ETag

`STRONG_ETAG` does not mean “a string without `W/`”. RFC 9110 defines a strong validator as one that changes when the representation data changes, for a conforming origin. Loke does not infer that authority from syntax. The registry or adapter declaration is the trust binding that says equal token means the same representation for this locator.

Two observations are the same remote representation only when locator, class and that single token are equal. This unit does not add a Loke URL normalizer.

The conditional exchange and any content GET must use that same `locator_identity`.

### 4.3 Target binding

Required:

- the source binding in §4.1
- the same `locator_identity`
- `target_identity` for this run

`target_identity` is one object, not the source as a whole.

When the adapter declares `file_name`, that name is part of `target_identity`. The same locator with a different adapter `file_name` must not reuse the previous binding. That is `BINDING_MISMATCH` and `FETCH`. Using bytes already stored under a new name is a separate local materialization or dedup step. It is not prefetch `SKIP`.

A source-level “nothing changed” claim does not authorize `SKIP` for an individual target.

### 4.4 Final URL

`allowed_domains` only means the transport may contact that host. It does not mean two locators are the same identity.

If the final URL of the conditional exchange differs from `locator_identity`, the result is `BINDING_MISMATCH` and `FETCH`.

The only exception is a redirect the registry or adapter has already reduced to that same canonical locator before the binding is read or written. Canonicalization discovered only from the live response is not that exception.

### 4.5 Unbound fields

These do not participate in pre-fetch `SKIP` identity:

- `execution_id`
- `quarantine_id`
- local object `content_hash` by itself
- `DownloadManifest` digest by itself
- `generated_at` on a manifest
- `deduplicated` and `attempts`
- any Loke inventory key
- CAS artifact ids
- a hash minted by the validator binding store

`DownloadManifestIdentity` stays post-fetch.

## 5. ValidatorBindingRecord

A minimal recall store is allowed. It is not an inventory of upstream content, not a `DownloadManifest`, and not CAS.

Required fields:

- source binding: `source_id`, `source_content_hash`, `registry_artifact_id`
- `locator_identity`
- `target_identity`, including adapter `file_name` when the adapter declares it
- `validator_class`
- `validator_token` — one strong ETag
- `observed_at` — when that upstream token was observed

At most one record per target identity. Zero records is `FETCH` / `NO_PRIOR_BOUND_TOKEN`. More than one record for the same target is `FETCH` / `SIGNAL_UNVERIFIABLE`. V0 does not send a list.

The record may be replaced after a content acquisition observes a new upstream token under a declared `STRONG_ETAG` capability. Replacement is recall maintenance. It is not `SKIP`. A `SKIP` does not mint a new token. It may record that a live exchange affirmed the existing token. That timestamp update is not authority.

Forbidden:

- minting a content hash or byte identity
- writing CAS
- replacing `DownloadManifest` identity
- storing an inventory of what the origin publishes
- yielding `SKIP` without a new live exchange in this episode
- storing a list of ETags for one target

An old binding and no live verification is `FETCH`.

## 6. Authority

| Actor | May assert current representation identity? | Role |
| --- | --- | --- |
| Upstream origin of the bound locator | Yes, only by the `304` rule in §7 | Sole content authority for this episode |
| Registry or adapter `STRONG_ETAG` capability | No, not by itself | Trust binding that says the origin’s strong ETag is representation identity for this locator. Without it, syntax is not enough. |
| Source adapter or target resolver | No | May carry an upstream ETag only through that declared capability. Must not sniff a header into the class. |
| Governed harvest runtime | No | May evaluate this contract. Must not mint tokens. |
| `ValidatorBindingRecord` | No | Recall only. |
| Local quarantine, manifest store, HTTP cache, filesystem | No | Not `SKIP` authority. |
| CAS, Librarian, PostGIS | No | Out of domain |
| Operator, agent, benchmark | No | Non-authority |
| Registry `change_detection` | No | Hint only |

> Only the upstream origin may assert that the current representation is unchanged, and only inside a registry-authorized `STRONG_ETAG` capability. A local cache, an earlier Loke run or a quarantine record must not be promoted to upstream authority.

Carriage of upstream headers into `DownloadTarget.source_metadata` stays provenance. Carriage without the live `304` rule is `FETCH`.

## 7. Validator signals

### 7.1 V0 class

| Class | V0 status | `SKIP` rule |
| --- | --- | --- |
| `STRONG_ETAG` | The only `SKIP`-capable class | §8 |

A token is eligible only when all of these hold:

- the registry or adapter declares `STRONG_ETAG` for this source and locator, with the meaning “equal token means same representation”
- the token has no weak marker `W/`
- exactly one such token is bound to the target
- the live request puts that exact token, and no other, in `If-None-Match`
- the response status is `304`
- the `304` response carries the same strong ETag

RFC 9110 requires a `304` to send an ETag when the corresponding `200` would have sent one. A `304` that omits the ETag, or sends a different one, is `FETCH`. A naked `304` is not affirmation.

Weak ETags are `FETCH` / `SIGNAL_UNVERIFIABLE`. A syntactically strong ETag without the capability declaration is `FETCH` / `SIGNAL_CLASS_FORBIDDEN`.

### 7.2 Reserved, not V0

`UPSTREAM_CONTENT_DIGEST` and `IMMUTABLE_REVISION_ID` are **RESERVED / NOT_SUPPORTED_V0**.

Their registry schema is not closed here. They may receive later contracts. In V0 they yield `FETCH` / `SIGNAL_CLASS_FORBIDDEN`. They do not block this closure.

No other class, including a generic “trust this provider header” mapping, is `SKIP`-capable in V0.

### 7.3 Disallowed as `SKIP` authority

| Signal | Why |
| --- | --- |
| Quarantine SHA-256 alone | Previous bytes, not current remote identity |
| `DownloadManifest` digest or `sameSemanticManifest` alone | Post-fetch execution identity |
| CAS hash or CAS presence | Wrong domain |
| Filesystem or HTTP cache hit | Local optimization |
| ETag without `W/` and without a `STRONG_ETAG` capability | Syntax is not the trust binding |
| Weak ETag | Not byte identity |
| `Last-Modified` alone | Not representation-unique |
| `change_detection.strategy` without the capability | A label |
| Sniffed `ETag`, `Digest`, STAC property, PUH field or soft flag | Provider leakage |
| `If-None-Match` list, or more than one stored tag | Q7: not deterministic |
| `304` that does not echo the bound strong ETag | Naked or divergent `304` |
| Final URL different from the canonical locator | Different identity, even inside `allowed_domains` |
| Changed adapter `file_name` | Different target binding |
| “Harvested this URL before” | History |
| Loke-invented URL normalization | Breaks locator binding |
| Partial body or `206` | `RESUME`, not authorized |
| AI or heuristic “looks unchanged” | Not verifiable |
| Replayed `SKIP` transcript | Not a live exchange |

### 7.4 Class assignment

The class is assigned only by the registry or adapter capability declaration. The runtime must not read an `ETag` header and categorize it as `STRONG_ETAG` by itself. Sniffing is `FETCH` / `SIGNAL_CLASS_FORBIDDEN`.

## 8. Conjuncts for `SKIP`

`SKIP` is legal only when all of the following hold in the same episode:

1. The source is verified APPROVED, and `source_id`, `source_content_hash` and `registry_artifact_id` match the binding.
2. A `STRONG_ETAG` capability is declared for this source and locator.
3. `target_identity` matches, including adapter `file_name` when declared.
4. `locator_identity` is the canonical locator, and the final URL of the exchange is that locator, subject only to §4.4.
5. The store holds exactly one `ValidatorBindingRecord` for that target, class `STRONG_ETAG`, one strong token.
6. This episode performs a conditional GET or HEAD to that locator.
7. `If-None-Match` contains that token and no other.
8. The response is `304` and its ETag is that same strong token.
9. The exchange stays inside the source’s domain, credential and URL-scope policy.
10. The decision does not depend on `RESUME`, a partial object, a local hash, a manifest digest, CAS or cache.

If any conjunct fails, or the situation is not classified, the decision is `FETCH`.

### 8.1 Content already in hand

If the conditional GET returns a content-bearing body, that body is the acquisition for this target. It must be passed to the existing governed landing path. It must not be discarded and fetched again. A second GET can observe a different representation.

That outcome is `FETCH` in the sense “bytes are acquired”, not “throw these bytes away and GET again”.

A HEAD response has no body to reuse. Any HEAD result other than the `304` rule in §7.1 is `FETCH`, and a later content GET is a separate acquisition.

### 8.2 Recording `SKIP`

A `SKIP` may update `observed_at` on the existing `ValidatorBindingRecord` to the time of the live exchange. It must not mint a content hash, write a `DownloadManifest` as a cache key, or write CAS.

If that recall update cannot be persisted, `SKIP` does not stand. The episode is `FETCH`. An unauditable `SKIP` is not a `SKIP`.

The record remains non-authoritative. Replaying it later without a new live exchange is `FETCH`.

## 9. Freshness and replay

A token is fresh only when this episode’s conditional exchange returns `304` with the same strong ETag, under the current credential and domain policy.

`observed_at` is not a TTL. A yesterday-valid tag without a new live `304` is `FETCH`.

| Situation | Outcome |
| --- | --- |
| Offline replay of a captured observation through manifest `resolve` | Not this contract. Do not contact the network to invent `SKIP`. |
| Stored binding, no live exchange | `FETCH` |
| Stored `SKIP` transcript replayed as if it were fresh | `FETCH` |
| `304` without the same echoed ETag | `FETCH` |
| Registry `source_content_hash` changed | `FETCH` / `BINDING_MISMATCH` |
| Digest or revision match | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |

Failures are not negative-cached into `SKIP`. HTTP 404 is not `SKIP` and must not delete or rewrite a prior observation.

## 10. Failure semantics

| Condition | Decision | Reason |
| --- | --- | --- |
| Unclassified | `FETCH` | `SIGNAL_UNVERIFIABLE` |
| No binding for this target | `FETCH` | `NO_PRIOR_BOUND_TOKEN` |
| Only local manifest, quarantine, CAS or cache | `FETCH` | `LOCAL_NON_AUTHORITY` |
| No `STRONG_ETAG` capability, or class is reserved | `FETCH` | `SIGNAL_CLASS_FORBIDDEN` |
| ETag sniffed from a header or provider field | `FETCH` | `SIGNAL_CLASS_FORBIDDEN` |
| Transport cannot send conditional GET or HEAD with one `If-None-Match` | `FETCH` | `VALIDATOR_EXCHANGE_UNSUPPORTED` |
| `304` omits ETag or echoes a different one | `FETCH` | `SIGNAL_MISSING` or `SIGNAL_UNVERIFIABLE` |
| Weak or malformed token | `FETCH` | `SIGNAL_UNVERIFIABLE` |
| More than one stored tag, or a list in `If-None-Match` | `FETCH` | `SIGNAL_UNVERIFIABLE` |
| Content-bearing response, or token differs | `FETCH` | `REPRESENTATION_CHANGED` |
| Source, locator, registry hash, final URL or `file_name` mismatch | `FETCH` | `BINDING_MISMATCH` |
| Timeout, DNS, TLS, connection failure, HTTP 5xx | `FETCH` | `UPSTREAM_UNAVAILABLE` |
| HTTP 401 or 403 on the validator path | `FETCH` | `UPSTREAM_UNAUTHORIZED` |
| Domain, credential or URL-scope mismatch, including redirect off scope | `FETCH` | `SCOPE_VIOLATION` |
| Partial bytes or Range | `FETCH` | `RESUME_UNSUPPORTED` |
| All §8 conjuncts hold | `SKIP` | `REMOTE_REPRESENTATION_UNCHANGED` |

Reason codes do not soften `FETCH` into `SKIP`.

`DownloadTransport.get` today takes a URL, timeout and optional size limit. It has no conditional headers. Until a later implementation can express this exchange, conjuncts 6–8 cannot hold. This unit does not add that transport.

## 11. Target procedure

For each resolved target, before accepting bytes as the acquisition:

1. If the source is not verified APPROVED, do not enter this procedure and do not contact the network. That gate stays in `loadVerifiedSourceRegistry` and `GovernedDownloadExecutor`.
2. Bind source, capability, canonical locator and target identity, including `file_name` when declared.
3. Load the single `ValidatorBindingRecord`. Zero or several is `FETCH`.
4. If the only evidence would be local hash, manifest, CAS or cache, `FETCH`.
5. Conditional GET or HEAD on that locator with exactly one `If-None-Match`. Final URL must remain the canonical locator unless §4.4 already canonicalized it.
6. `304` echoing the same strong ETag is `SKIP`. Anything else is `FETCH`.
7. Do not consult CAS, Librarian, PostGIS or a Loke inventory table.

One target’s `SKIP` does not cover its siblings.

## 12. `RESUME`

`RESUME` is not a `PrefetchDecision`.

Range, `206`, or a partial local file does not authorize resume. A future resume contract must prove that every byte range belongs to the same immutable remote representation. This V0 validator does not provide that proof. Partial state is `FETCH` of a full representation, or a hard stop if a full representation cannot be acquired without stitching. This contract does not choose which. It forbids fabricating `RESUME`.

## 13. Existing components

| Component | Relation |
| --- | --- |
| `DownloadManifestIdentity` | Untouched. Not a cache key. |
| `ValidatorBindingRecord` | Recall only. Authorized here. Not implemented here. |
| `GovernedDownloadExecutor` | Still acquires when the plan has targets. No short-circuit is added here. |
| `DownloadTransport` | No conditional exchange yet. Silence is not success. |
| `SourceChangeDetection` | Hint only. Not the `STRONG_ETAG` capability. |
| `DiskQuarantineStorage.findByHash` | Post-fetch byte dedup. Not `SKIP`. |
| `FileDownloadManifestStore` | Not `SKIP` authority. |
| `HarvestExecutionStateMachine` | Not used. |

## 14. Test vectors

Contract expectations, not implemented tests. No source is named.

### 14.1 Normative `SKIP`

| ID | Setup | Live exchange | Expected |
| --- | --- | --- | --- |
| TV-S1 | One binding: capability declared, token `T`, same source hash, same canonical locator, same target including declared `file_name` | Conditional GET or HEAD, `If-None-Match: T` only, final URL unchanged, `304` with ETag `T` | `SKIP` / `REMOTE_REPRESENTATION_UNCHANGED` |

### 14.2 Normative `FETCH`

| ID | Setup | Live signal | Expected |
| --- | --- | --- | --- |
| TV-F1 | Quarantine or manifest or CAS or cache only | none | `FETCH` / `LOCAL_NON_AUTHORITY` |
| TV-F2 | Strong ETag `T` on the wire, no capability declaration | `304` echoing `T` | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| TV-F3 | Capability declared, binding `T` | no request, binding replayed | `FETCH` |
| TV-F4 | Binding `T` | `304` with no ETag | `FETCH` / `SIGNAL_MISSING` |
| TV-F5 | Binding `T` | `304` with ETag `U` | `FETCH` / `SIGNAL_UNVERIFIABLE` |
| TV-F6 | Binding `T` | weak `W/"T"` | `FETCH` / `SIGNAL_UNVERIFIABLE` |
| TV-F7 | Binding `T` | `If-None-Match` lists `T` and `U` | `FETCH` / `SIGNAL_UNVERIFIABLE` |
| TV-F8 | Two records for one target | any | `FETCH` / `SIGNAL_UNVERIFIABLE` |
| TV-F9 | Binding under registry hash H1 | run uses H2 | `FETCH` / `BINDING_MISMATCH` |
| TV-F10 | Binding for locator A | final URL B, host allowed | `FETCH` / `BINDING_MISMATCH` |
| TV-F11 | Binding includes adapter `file_name` N1 | same locator, adapter name N2 | `FETCH` / `BINDING_MISMATCH` |
| TV-F12 | Binding `T` | upstream timeout, 5xx, 401 or 403 | `FETCH` |
| TV-F13 | Digest or revision equal | any | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| TV-F14 | `Last-Modified` equal, or strategy name `ETAG` only | any | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| TV-F15 | Sniffed provider field `unchanged=true` or raw `ETag` header | present | `FETCH` / `SIGNAL_CLASS_FORBIDDEN` |
| TV-F16 | Partial local bytes or `206` | any | `FETCH` / `RESUME_UNSUPPORTED` |
| TV-F17 | Conditional GET returns `200` and a body | body in hand | `FETCH`. That body is the acquisition. No second GET. |
| TV-F18 | Post-fetch quarantine dedup would hit | after content GET | The decision was `FETCH`. Dedup is not `SKIP`. |
| TV-F19 | Redirect off `allowed_domains` | any | `FETCH` / `SCOPE_VIOLATION` |

TV-S2 and TV-S3 from the draft, digest match and revision match, are TV-F13. They are not `SKIP`.

## 15. Critical self-review

### 15.1 Fail-open

Closed by this decision: a naked `304` is `FETCH` (Q3). A list of tags is `FETCH` (Q7). Syntax without a capability declaration is `FETCH` (Q1). Sniffing is `FETCH`. Local stores cannot `SKIP` (Q2). A changed final URL or `file_name` is `FETCH` (Q5, Q6).

Accepted residual risk, not an open question: if a declared `STRONG_ETAG` capability names an origin that fails to change its strong ETag when the bytes change, Loke will `SKIP`. That is the trust binding Q1 chose. It is not a second hash check.

`32fb3e6c` accepted a naked `304` and syntactic strength. Those fail-open edges are not part of this closure.

### 15.2 Replay

A binding, a `SKIP` transcript and a resolved manifest are each insufficient without a new live exchange. Offline manifest replay must not call this contract.

### 15.3 Stale metadata

`Last-Modified`, weak ETags and strategy labels cannot `SKIP`. A new `source_content_hash` invalidates the binding. `observed_at` is not freshness. A `304` that echoes a different tag is not fresh.

### 15.4 Provider leakage

Provider fields are not self-categorized. Digest and revision stay reserved so their schemas are not invented here. The only class is a declared `STRONG_ETAG` capability.

### 15.5 Identity regression

`DownloadManifestIdentity` is unchanged. The binding record cannot mint a content hash or write CAS. One target cannot accumulate an ETag list.

## 16. Owner decisions

Q1–Q7 are closed as follows.

1. **Q1.** RFC-strong syntax is not Loke’s trust policy. `SKIP` requires a registry or adapter `STRONG_ETAG` capability stating that an equal token means the same representation for this locator.
2. **Q2.** A `ValidatorBindingRecord` is allowed as recall only. An old binding without a new live exchange is `FETCH`.
3. **Q3.** The `304` must echo the same strong ETag that `If-None-Match` sent. A naked or divergent `304` is `FETCH`.
4. **Q4.** `UPSTREAM_CONTENT_DIGEST` and `IMMUTABLE_REVISION_ID` are RESERVED / NOT_SUPPORTED_V0. Their schema is not closed. They do not block V0.
5. **Q5.** Declared adapter `file_name` is part of target identity. A changed name is `BINDING_MISMATCH`. Renaming stored bytes is not `SKIP`.
6. **Q6.** A different final URL is `BINDING_MISMATCH`. `allowed_domains` is transport permission, not identity. The only exception is canonicalization the registry or adapter already performed before the binding comparison.
7. **Q7.** Exactly one bound ETag may be sent. Several tags are `FETCH`.

## 17. Non-actions

This unit does not:

- add or modify product code, tests, registry entries or transport behavior
- change `DownloadManifestIdentity.ts`
- select a source
- start an implementation unit
- revive `32fb3e6c`
- wire `HarvestExecutionStateMachine`
- touch U51, G814, F-4, RC or integration branches
- claim that product `SKIP` exists

## 18. Status

- **L-V0-IDENTITY-01 — DECIDED / CLOSED** at `286b7f51`. Unchanged.
- **L-V0-PREFETCH-VALIDATOR-CONTRACT — DECIDED / CLOSED** by this document.
- **Loke V0 — DESIGN_CLOSED / IMPLEMENTATION_NOT_STARTED, NON_BLOCKING_FOR_U51.**

Design closure is not product proof. No source has been accepted against the capability rule. Implementation has not started.
