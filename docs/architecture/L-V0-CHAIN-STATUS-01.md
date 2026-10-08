# L-V0 chain status — 01

This note locks the chain. It does not amend `L-V0-IDENTITY-01`.

No VERIFIED, PROVEN, COLD_VERIFIED or EXECUTION_VERIFIED is assigned.

## Proof chain

| Role | Commit | Document |
| --- | --- | --- |
| Design evidence | `008894e7667916d5d82a18c2c61ec9e4f6d704dc` | [LOKE-V0-REPORT.md](./LOKE-V0-REPORT.md), [LOKE-V0-REUSE-INVENTORY.md](./LOKE-V0-REUSE-INVENTORY.md) |
| Normative decision (identity) | `286b7f519a4618350ba09eb5ec75e0ef4a69f7db` | [L-V0-IDENTITY-01.md](./L-V0-IDENTITY-01.md) |
| Status lock (identity closed; validator not started) | `5fddb5cb405601b8183e7a4a9bd1101c2185a47c` | this file at that commit |
| Superseded historical validator closure | `32fb3e6c0b4c44bc32029c4681e66f7f563ff216` | not normative |
| Open questions | `30a9b18dd53c697ec65113f5f403fe516fbcc596` | draft superseded by the closure below |
| Prefetch validator contract | this commit on `feature/loke-v0` | [L-V0-PREFETCH-VALIDATOR-CONTRACT.md](./L-V0-PREFETCH-VALIDATOR-CONTRACT.md) |

`008894e7` explains why pre-fetch `SKIP` could not be bound to `DownloadManifest` identity. `286b7f51` accepts that limit. The text of `L-V0-IDENTITY-01.md` is unchanged.

`32fb3e6c` is superseded historical state. It is not revived. The normative validator closure is the later commit that records Q1–Q7.

## Status

- **L-V0-IDENTITY-01 — DECIDED / CLOSED.** `DownloadManifestIdentity.ts` is not edited. Local deduplication is not evidence that the upstream object is still the same object.
- **L-V0-PREFETCH-VALIDATOR-CONTRACT — DECIDED / CLOSED.** V0 `SKIP` is only a registry-authorized strong ETag, one token, conditional GET or HEAD on the same canonical locator, and a `304` that echoes that same ETag. Everything else is `FETCH`. Digest and revision are RESERVED / NOT_SUPPORTED_V0. No upstream source is selected. No product code.
- **Loke V0 — DESIGN_CLOSED / IMPLEMENTATION_NOT_STARTED, NON_BLOCKING_FOR_U51.**

Canonical invariant (unchanged):

> `SKIP` är inte deduplicering. `SKIP` är ett upstream-verifierat påstående att den resurs som annars skulle hämtas är identisk med den resursversion som redan är bunden till aktuell target-identitet.

`STRONG_ETAG` does not mean any string without `W/`. It means a registry or adapter capability that says equal token means the same representation for that locator. Provider fields are not sniffed into the class.

## Next

Implementation has not started. A later unit may implement only this closed path. It must not treat `32fb3e6c` as the contract, and it must not select a source unless that source is shown against the capability rule in that later unit.
