# LU-W4-PROJECT-CONTEXT-READINESS-CANONICAL-PROJECTION-V1

**Status:** CANDIDATE (implementation complete). RED probes were cold-reviewed on their own first
(§1), confirmed sound and cleared for implementation -- including the mocking-boundary question
this session itself flagged, independently confirmed correct by the reviewer -- before any
production code was written, per the K-28 ordering.
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

## 2. What changed (implementation, after the RED-only candidate was cleared for it)

- **`src/application/resolveProjectContextReadiness.ts`** (new): wraps
  `resolveCanonicalProjectContext()` in a try/catch. On success, returns
  `{status: 'READY', context}` with the real resolved `CanonicalProjectContext`. On **any** thrown
  error, returns `{status: 'NOT_READY'}` -- no distinction between failure causes, matching Jimmy's
  own explicit instruction that missing/invalid/authority-failed bindings are deliberately one
  unified state in this first version. No import of, or reference to,
  `ProjectContextBootstrapRequest` anywhere in the file.
- **`src/application/resolveCanonicalLuProjection.ts`** (new): calls
  `resolveProjectContextReadiness()` first; if not `READY`, returns `{status: 'NOT_AVAILABLE'}`
  immediately. The `READY` branch **deliberately throws** (`W4_NOT_IMPLEMENTED: ...`) rather than
  also returning `NOT_AVAILABLE` -- a self-caught design choice during implementation: silently
  returning the same value for both branches would make "not yet built" indistinguishable from "an
  intentional no-result design," which is exactly the kind of ambiguity this program's own
  non-drive-by/no-silent-scope-creep norms exist to prevent. The `AVAILABLE` case itself is not
  built in this candidate (§3).

**Self-caught bug during GREEN verification, not present in the reviewed RED-only candidate's
intent:** the "no bootstrap side effect" test's original assertion (`expect(source).not.toMatch(/ProjectContextBootstrapRequest/)`)
produced a false failure against the real implementation -- the new module's own doc comment
legitimately *names* `ProjectContextBootstrapRequest` to explain why it is absent, and a bare
textual search cannot distinguish that from actual usage. Fixed by stripping comments from the
source before checking, and narrowing the check to an actual import path or a Prisma-style
property access (`.projectContextBootstrapRequest`) -- targeting real usage specifically, not any
mention of the concept. Re-verified RED (still fails for the same "module does not exist" reason,
unaffected by this fix) and GREEN (now passes) after the correction.

## 3. Verified evidence

**RED**, re-confirmed against a fresh, separate worktree pinned to `44e3e3df` (`C:\wt-w4-base2`,
junctioned `node_modules`, K-29 pattern) after cold review cleared the RED-only candidate for
implementation, using the corrected test source (§2): both probes still fail for the same "module
does not exist" reason as the original RED-only candidate, unchanged.

**GREEN**, run via the exact embedded command against this candidate: both exit 0 -- 6/6 for
`resolveProjectContextReadiness.test.ts`, 2/2 for `resolveCanonicalLuProjection.test.ts`. Includes
the K-118-style byte-identity self-check, built in from the start -- verified it actually fires by
deliberately appending a comment to `resolveProjectContextReadiness.test.ts`, confirming the GREEN
proof then failed with exit 2 and the expected `W4_HARNESS_ERROR ... does not byte-match ...`
message, then restoring the file and reconfirming exit 0 (6/6).

**Typecheck:** both new files sit under `src/application/**`, and their tests under `tests/**` --
both directories wholesale-excluded by `tsconfig.json`'s own `exclude` list, so a scoped,
explicit-file-list check was required (same `compilerOptions` as `tsconfig.json`). Since neither
file exists at base, a base-vs-candidate diff is not possible for them specifically (matching the
established precedent for brand-new files); checked standalone on the candidate instead: **14
errors**, all in transitively-imported packages (`packages/mps-lu/**`, `packages/mps-runtime/**`,
`packages/mps-artifact-store/**`) -- the exact same files and error classes already flagged as
pre-existing, unrelated errors in every prior W-unit's own scoped tsc check this session (W3a, W3c,
W3d). **Zero errors** in either of this unit's own two new production files or two new test files.

## 4. Non-claims -- what this unit does not do

Does not specify or build the `READY`/`AVAILABLE` happy-path shape for Part 2 beyond the design
note's own sketch and this candidate's own deliberate `W4_NOT_IMPLEMENTED` throw (§2) -- propagating
an actually-verified governed assessment's findings and provenance is real future work. Does not
touch `resolveCanonicalProjectContext.ts` itself, `ProjectContextBindingProvider`, or any other part
of the already-shipped, already-PROVEN governed binding chain -- both new modules are pure additive
wrappers with zero changes to existing files. Does not build the funding-risk or C-anmälan adapters,
the layer-availability vocabulary, or any Loke-ingestion work -- all explicitly frozen per Jimmy's
own scoping (§0). Does not wire either new function into any live route, service, or consumer --
both are new, unreferenced application-layer functions with no caller yet.

## 5. Final disposition

RED-only candidate cold-reviewed and cleared for implementation before any production code was
written, including independent confirmation of this session's own flagged mocking-boundary
question. Implementation complete: both RED probes still fail on a fresh base, both now pass on
this candidate (8/8 combined), a real bug in the unit's own test design was caught and fixed during
GREEN verification (not glossed over), typecheck clean (zero errors in this unit's own files,
identical pre-existing package errors on the candidate matching every prior unit's own scoped
check). Awaiting cold review of the implementation itself before freezing the exact SHA, then the
established chain: cold verification -> owner push-go -> PR (branch
`w4-project-context-readiness-canonical-projection`, the unit's own `remote.branch`) -> dispatch
(owner only) -> attestation -> merge.
