# L-V0-CLOSURE-01 — closure record

**Status: CLOSURE_READY / PARTIALLY_EXECUTION_VERIFIED.**

This record does not assign PROVEN, and it does not assign an unqualified VERIFIED or CLOSED to Loke V0 as a whole. It does not amend the frozen contracts.

| | |
| --- | --- |
| Unit | L-V0-CLOSURE-01 |
| Anchor HEAD | `af22f0816cd7bf585dd3f0394b24db1a265e7ac8` |
| Tree | `8c351eccbac2e20708471676f5805856662a6182` |
| Branch | `feature/loke-v0` |
| Implementation base | `583996e53fb7cb30650b235a9c75435775fd6447` |
| Independent review | ACCEPT of `af22f081`. F1 CLOSED. F2 CLOSED. Contract unchanged. |
| Wiring contract SHA-256 | `43CC861BA3FBBEF9E048E05FF5CDD53D97AE80881F6E6CABAA6C779D478DBD3F` |
| Identity decision | `286b7f519a4618350ba09eb5ec75e0ef4a69f7db`, file SHA-256 `ED19717B81ED13FE4C52B730C1F2FB5FAEA11C1CC78B5FD95DC3C39A13DED713` |
| Prefetch contract | `321b588cdcd9cf1cf1d5e7dabc6aa435bd16edd0`, file SHA-256 `05FFA0C8B6D83B6F0A06D79A0D59F7AEC0798BE7DDC7246F0AB39C47E4794D03` |
| Scoped authority proof | `417ef72eda8f09168964597a7d24356871a4ef57` |

The four contract files above are unchanged between `f6f17fc3` and this anchor. Their status lines that say `IMPLEMENTATION_NOT_STARTED` describe those earlier units. They are not rewritten here.

## What is execution-verified

`L-V0-HEAD-WIRING-IMPL-01` is `EXECUTION_VERIFIED` at this anchor.

That surface is the frozen HEAD-wiring contract as implemented: strong-ETag-only SKIP, registry-issued authority, `targetIdentity` at the resolver boundary, a separate HEAD exchange, one `If-None-Match`, 304 SKIP only on a valid binding, unsupported HEAD as FETCH, 307/308 followed as HEAD, 301/302/303 not followed, a non-null HEAD body cancelled, `SCOPE_VIOLATION` and unauthorized stopping before GET, a failed binding replace throwing after tombstone, and no successful manifest after that failure. `dl-canonical-1` is unchanged. `observed_at` is not part of `pex-canonical-1` identity. SKIP is not deduplication.

Targeted execution reproduced on this anchor:

| File | Result |
| --- | --- |
| `LokeHeadWiring.test.ts` | included |
| `LokeHeadWiringRuntime.test.ts` | included |
| `LokePrefetchValidator.test.ts` | included |
| Three files together | 66 / 66 PASS, 0 failed, 0 skipped |

Adjacent wiring regression on the same run: `GovernedDownloadExecutor.test.ts`, `HarvestOrchestrator.test.ts`, `P2Runtime01CompositionRoot.test.ts`, `P2LmStacRuntimeComposition.test.ts`. Seven files together: 105 / 105 PASS, 0 failed, 0 skipped. This is not a whole-repository result.

`L-V0-STRONG-ETAG-AUTHORITY-IMPL-01` stays the scoped `EXECUTION_VERIFIED` at `417ef72e`. This closure does not widen it.

## Production reachability

`PRODUCTION_REACHABLE` for the frozen all-FETCH path.

`harvest-live-pilot.ts` calls `composeHarvestRuntime` without an injected quarantine. That composition opens `FileValidatorBindingStore` on the named-pipe lease, builds `HttpConditionalHeadExchange` for every adapter other than `LM_STAC_BYGGNADER_V1`, and `GovernedDownloadExecutor` calls `decidePrefetch`. Production resolvers do not declare `STRONG_ETAG`, so the exchange is not invoked and the result is `{ kind: "DOWNLOAD_MANIFEST" }`. The pilot requires that kind. A prefetch-evidence result fails closed there.

SKIP and `pex-canonical-1` are on that same composition and run only when a resolver declares `STRONG_ETAG`. No production resolver does. That is the frozen rule.

The legacy scheduler in `scripts/import/harvest/harvestRuntime.ts` is not the canonical harvest entry. It does not instantiate the adapters of the current approved registry.

## Not in this closure

These are not implemented and are not claimed:

- conditional GET
- RESUME
- validator classes other than `STRONG_ETAG`
- general deduplication
- a production source selected for `STRONG_ETAG`
- an autonomous Loke beta
- U51, CAS, Librarian, or PostGIS work

Loke remains `NON_BLOCKING_FOR_U51`.

Canonical invariant, unchanged:

> SKIP är inte deduplicering. SKIP är ett upstream-verifierat påstående att den resurs som annars skulle hämtas är identisk med den resursversion som redan är bunden till aktuell target-identitet.
