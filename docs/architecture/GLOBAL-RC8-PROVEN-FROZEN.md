# GLOBAL RC8 — PROVEN / FROZEN

**Status:** PROVEN / FROZEN
**Evidence commit:** `547b921` (branch `feat/p2-p3-governed-chain-reproducible`, pushed, `0 ahead / 0 behind origin`)
**Evidence run:** fresh clean-checkout, `/c/rc8-clean-checkout-v2`, disposable `riskguard_test` database provisioned from scratch (`scripts/db/provision-spatial-test-db.ts --drop`), `npx vitest run --project unit --project component --project compliance`

```
Test Files  736 passed | 5 skipped (741)
     Tests  5537 passed | 45 skipped (5582)
Duration    145.62s
```

**0 failed.**

## What RC8 claims

Every non-skipped test file and every non-skipped test in the `unit`, `component`, and `compliance` vitest project lanes passes, reproducibly, from a fresh `git clone` of `feat/p2-p3-governed-chain-reproducible` at `547b921`, against a freshly provisioned disposable PostGIS test database — with no reliance on leftover local state, stale caches, or a pre-existing checkout.

This closes the reproducibility gap explicitly left open after [LU v0.1](LU-V0.1-REPRODUCIBLE-GOVERNED-CHECKPOINT.md) froze: LU v0.1 proved the LU execution-identity trust boundary in isolation; GLOBAL RC8 proves the platform-wide test suite as a whole, run together, in the exact composition and order it runs in CI/large-batch use.

## The sole blocker this closes: RC8-LU-POSTGIS-ORDER-ISOLATION-01

The last remaining failure before this freeze was `packages/spatial-provider-postgis/tests/LUMagicMomentPostGIS.test.ts`, an order-dependent / batch-only flake: isolated it was always green; in a full-suite batch run it occasionally failed its identity-stability assertion (`same request → same content_hash`, SV-I06).

**Root-cause finding (read-only investigation performed before any fix):** this was traced to shared PostGIS database state across test files, not to nondeterminism in canonical artifact identity itself. `SpatialProviderPostGIS`'s content-hash computation is a pure function of its query result set — the *canonical payload before hashing* was itself unstable, but only because the underlying database rows it was reading were being mutated concurrently by a sibling test file, not because hashing or identity computation is nondeterministic.

Specifically:
- This file's seed geometry used the exact coordinate `(591234, 6612345)`, identical to the coordinate seeded by two sibling files (`LUMagicMomentE2E.chain.test.ts`, `luWorkspace.magicMoment.e2e.test.tsx`), all writing into the same shared `riskguard_test` database (this suite has no per-file database isolation).
- This file's cleanup delete range was unbounded (`id >= 999900`, no upper bound), unlike every sibling file in the same directory, which bounds its range.
- The failing assertion runs two `provider.query()` calls back-to-back within a single test. If a concurrently-running sibling file's insert/delete landed at the identical coordinate — within the 100m query buffer — in the narrow window between those two calls, the row set returned by PostGIS (and therefore the returned `content_hash` set) could differ between the two calls.

This is TEST ISOLATION / shared fixture collision, not a product defect in canonical artifact identity. Per the applicable branching rule, a test-pollution root cause called for a fix to isolation, not a change to product hashing/identity logic — and none was made.

**Fix (`547b921`):** gave the file its own coordinate (`596234, 6617345`, far outside any buffer distance used by it or its siblings) and bounded its delete range (`>= 999900 AND < 999910`, matching the pattern already used elsewhere in the directory). No production code in `packages/mps-lu/*` or `packages/spatial-provider-postgis/src/*` was touched.

**Proof sequence run before freeze (closure criterion):**
1. `LUMagicMomentPostGIS.test.ts` isolated, repeated 3x — 3/3 GREEN.
2. Combined with both Magic Moment siblings (`LUMagicMomentE2E.chain.test.ts`, `luWorkspace.magicMoment.e2e.test.tsx`) — 3/3 files GREEN.
3. Full `packages/spatial-provider-postgis/tests/` batch (6 files) — 6/6 files GREEN, 13/13 tests GREEN (2 skipped).
4. Fresh clean-checkout, full `unit`+`component`+`compliance` lanes — **0 failed** (see run output above).

## Scope

This freeze covers reproducibility of the test suite as a whole: given a clean checkout and a freshly provisioned disposable test database, the full `unit`+`component`+`compliance` lane composition passes deterministically. It does not itself assert anything new about product semantics beyond what each individual test already asserts — it is a claim about the suite's reproducibility, not a re-review of what the suite covers.

The `integration` vitest project lane was not part of this run and is out of scope for this freeze.

GLOBAL RC8 is now **PROVEN / FROZEN** at `547b921`.
