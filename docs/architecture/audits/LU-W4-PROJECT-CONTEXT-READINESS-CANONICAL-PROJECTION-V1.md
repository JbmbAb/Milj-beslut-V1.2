# LU-W4-PROJECT-CONTEXT-READINESS-CANONICAL-PROJECTION-V1 -- RED-only candidate

**Status:** CANDIDATE -- RED probes only, zero production code. For cold review of test design
before any implementation, per the K-28 ordering.
**Unit:** `governance/devgov/units/lu-w4-project-context-readiness-canonical-projection-v1.json`
**Base:** `44e3e3df68a3ed3f22515eed55f3068fdc742baa` (W3d merged).
**Design authority:** `Claude outputs/w4-design-2026-09-30/W4-PROJECT-CONTEXT-READINESS-CANONICAL-PROJECTION-DESIGN-2026-09-30.md`,
itself authored on Jimmy's own direct scoping message (quoted in that document's §0), narrowing
several rounds of earlier relayed framing down to exactly two design items. Jimmy then gave direct,
explicit RED-only authorization with his own precise behavioral contract for the probes (2026-09-30):
accept all three of the design note's proposed defaults (no implicit bootstrap from the read path;
closed union with no invented forward-compat states; new files placed alongside
`resolveCanonicalProjectContext.ts`), and require the RED probes to demonstrate seven specific
behaviors (quoted in full in §1 below, mapped one-to-one to the tests that prove them).

## 0. Scope, restated precisely

**In scope (this candidate):** two new files, `src/application/resolveProjectContextReadiness.ts`
and `src/application/resolveCanonicalLuProjection.ts`, and their RED-probe test files. Zero
production code in this candidate -- per Jimmy's own explicit "Ingen implementation ännu."

**Explicitly frozen/out of scope (do not build, not even as a RED probe, in this unit):** any
`mapLayerSelection.unavailable` producer; the richer `CHECKED_PRESENT/CHECKED_ABSENT/NOT_CHECKED/
SOURCE_UNAVAILABLE/OUTSIDE_COVERAGE/COVERAGE_UNKNOWN/QUERY_FAILED` vocabulary or any Loke-ingestion
work; the groundwater/flood-risk data-coverage investigation (separate, parallel, non-blocking
lane); the funding-risk or C-anmälan adapters themselves.

## 1. RED probes, mapped to Jimmy's own required behaviors

Two new test files, testing the two new (not-yet-existing) modules. `resolveCanonicalProjectContext`
and `resolveProjectContextReadiness` are mocked at the module boundary in the respective test files
-- their own underlying cryptographic verification is already extensively covered by
`tests/unit/projectContextBindingRuntime.test.ts` and siblings; this unit's own new logic is the
wrapper's translation/fail-closed/no-side-effect behavior, not a re-proof of already-proven crypto.

**`tests/unit/resolveProjectContextReadiness.test.ts`** (new, 6 tests):

| Jimmy's required behavior | Test |
|---|---|
| "verifierad korrekt binding → readiness kan bli READY" | `returns READY with the real resolved context when a verified correct binding exists` -- mocks a successful resolution, asserts `{status: 'READY', context: <the exact resolved object>}`. |
| "ingen binding → NOT_READY" | `returns NOT_READY when no binding exists at all` -- mocks a rejection with `REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE`. |
| "binding som inte kan kryptografiskt verifieras → NOT_READY" | `returns NOT_READY when a binding exists but cannot be cryptographically verified` -- mocks a rejection with `REJECT_PROJECT_CONTEXT_BINDING_AUTHORITY_INVALID`. |
| "fel/mismatch i projekt/context → NOT_READY" | `returns NOT_READY on a project/context mismatch...` -- mocks a rejection with the exact `REJECT_PROJECT_CONTEXT: binding project_id does not match requested project` message the real function throws. |
| "ingen synthetic fallback" | `never synthesizes a fallback context...` -- asserts a NOT_READY result has no `context` property at all (`hasOwnProperty` check, not an `undefined`-check), so a caller cannot accidentally read a fabricated context off a failure result even by mistake. |
| "ingen bootstrap side effect från read-path" | `has no bootstrap side effect...` -- a source-level "absence as proof" check: reads the new module's own committed source and asserts it never references `ProjectContextBootstrapRequest`/`projectContextBootstrapRequest` at all, matching this program's established retirement-proof convention (e.g. W3b's `vertexDirigent.ts`-not-deleted guard) applied here to prove a *design boundary* rather than a deletion. |

**`tests/unit/resolveCanonicalLuProjection.test.ts`** (new, 2 tests):

| Jimmy's required behavior | Test |
|---|---|
| "projection kan inte producera ett auktoritativt LU-resultat när readiness inte är READY" | `cannot produce an authoritative LU result when readiness is NOT_READY` -- mocks Part 1's readiness check to `NOT_READY`, asserts the projection returns `{status: 'NOT_AVAILABLE'}` with no `findings` property; a second test confirms the projection short-circuits on `NOT_READY` without attempting to resolve anything further (no resolvable context is ever supplied, so a real implementation that tried to use one anyway would throw instead of returning cleanly). |

This candidate does **not** yet specify or test the shape of the `AVAILABLE`/`READY` projection
case beyond the type sketch in the design note's §4 -- that is real future work, explicitly not
frozen by this RED-only candidate, matching Jimmy's own "RED-only ska frysa kontraktet, inte
lösningen" (RED-only should freeze the contract, not the solution) framing for what *is* tested
here (the fail-closed boundary), not an instruction to test the untested-here happy path of Part 2.

## 2. Verified RED

Both probes run via their exact embedded command, against a freshly isolated worktree
(`C:\wt-w4-base`, pinned to `44e3e3df`, `node_modules` junctioned from `C:\wt-w4`'s own tree since
`package.json`/`package-lock.json` are unchanged by this candidate):
- `w4-resolve-project-context-readiness`: exit 1 (`Failed to resolve import
  ".../resolveProjectContextReadiness"` -- the module does not exist yet, the correct RED state for
  a zero-production-code candidate, matching the established precedent from W2/W3c/W3b's own first
  RED-only candidates).
- `w4-resolve-canonical-lu-projection`: exit 1 (same failure mode, for
  `resolveCanonicalLuProjection`).

## 3. Non-claims -- what this candidate does not do

No production code. No GREEN proof has been run or can meaningfully be run yet. Does not specify
the `READY`/`AVAILABLE` happy-path shape for Part 2 beyond the design note's own sketch (§1). Does
not touch `resolveCanonicalProjectContext.ts` itself, `ProjectContextBindingProvider`, or any other
part of the already-shipped, already-PROVEN governed binding chain -- both new modules are pure
additive wrappers. Does not build the funding-risk or C-anmälan adapters, the layer-availability
vocabulary, or any Loke-ingestion work -- all explicitly frozen per Jimmy's own scoping (§0).
