# DEVGOV-HELPERS-STEP3 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN
**Base:** `864a62f7d1f6f480c41a9c9395e6ce7b920fed99` (current protected `main`, includes the merged
LU-CANONICAL-RUNTIME-HARDENING-R1 PROVEN record)
**Unit definition:** `governance/devgov/units/devgov-helpers-step3-v1.json`
**Branch:** `tooling/devgov-helpers-step3`

## Purpose

Owner directive after LU-CANONICAL-RUNTIME-HARDENING-R1 finalized: step 3 of the frozen DEV-GOV
roadmap ("linter + preflight + prompt template") should be cheap productivity tooling, not new
authority. This unit packages exactly that: a static linter and a preflight command for DEV-GOV
unit definitions, a producer/cold-audit/packaging prompt template, and the single Prettier fix
identified during R1's finalization, folded in here rather than given its own unit.

This is **not** a hardening or product unit and does not claim to prove anything about LU, Prisma,
authority, admission, or any product path. It proves only that the advisory tooling exists, does
not crash, and detects the defect classes it was built to detect.

## What this is not

- Not an authority. The tooling never writes to, or overrides, the protected controller
  (`scripts/devgov/**`), the workflows (`.github/**`), or the schema
  (`governance/devgov/schema/**`). Every command it runs is read-only against the checkout it is
  given, plus its own throwaway git repositories under the OS temp directory for its test suite.
- Not a replacement for `scripts/devgov/devgov.mjs`. Where the helper and the controller would
  disagree, the controller is right; the CLI prints "advisory only" on every invocation.
- Not a fix to the stale outcome-id assertion in `scripts/ops/prove-lu-replay-cold-verify-01.ts`.
  Owner decision: leave it in the gap ledger until a natural tooling/proof-script delta.
- No independent (Codex-style) cold audit was performed for this unit, unlike
  LU-CANONICAL-RUNTIME-HARDENING-R1. Verification here is self-testing only: 29 automated tests
  (27 of them mutation-tested against synthetic defects), a retroactive run against R1's own
  historical defective definitions, a structural (AST + comment) equality proof that the Prettier
  change is formatting-only, and a noise measurement across all 25 pre-existing unit definitions.
  See "Non-claims" below.

## Changed paths

Implementation (already committed, unchanged by packaging):

- `scripts/dev-helpers/devgov-helper.mjs` — CLI (`lint`, `preflight`)
- `scripts/dev-helpers/lib/importClosure.mjs` — masked-source import-closure scan (working tree or
  a single git tree; no history walk)
- `scripts/dev-helpers/lib/preflight.mjs` — wraps the controller's own exported functions
  (`evaluateRepositoryState`, `verifyUnitDefinitionProvenance`, `runManifestCommand`) read-only,
  and adds remote-state and approvals-estimate checks the controller does not surface early
- `scripts/dev-helpers/lib/unitLint.mjs` — static rules `DGL-xxx`, each traced to a real R1 defect
  (see below)
- `scripts/dev-helpers/unit/devgovHelpers.test.ts` — 27 tests, each proving a rule against a known
  defect reproduced in a throwaway git repository
- `docs/templates/devgov-unit-prompt-templates.md` — producer / cold-audit / packaging prompt
  templates and the environment facts that cost R1 dispatch rounds
- `tests/unit/luBootstrapProofScriptsIsolation.test.ts` — Prettier formatting only (structure and
  comments verified unchanged; see "Prettier-only verification")

Packaging (this unit):

- `governance/devgov/units/devgov-helpers-step3-v1.json`
- `docs/architecture/audits/DEVGOV-HELPERS-STEP3.md`

## Rule-to-defect traceability

| Rule | R1 defect it would have caught |
|---|---|
| `DGL-020` | A RED command without `blocked_exit_codes` lets any crash count as a valid RED |
| `DGL-021` | A RED command that shells out to `git` |
| `DGL-022` | A RED command naming a file that exists only at the candidate ("file not found" RED) |
| `DGL-031` | A command that natively loads `server/db/prisma.ts`; the trusted attest workflow
  installs with `npm ci --ignore-scripts`, so the generated client is absent (R1's first dispatch,
  run `35556115424`) |
| `DGL-040` | `process.exit()` inside `try` skips `finally`, leaking a `mkdtemp` sandbox on the
  violation (RED) path |
| `PRE-IGNORE` | `governance/devgov/units/*.json` matches the repository's `*.json` ignore rule; a
  plain `git add` silently skips it |

Retroactive check against R1's own history: linting `governance/devgov/units/lu-canonical-runtime-hardening-r1-v1.json`
at commit `8d82f0aec7a8dcdf84a321cd1421b479a21e2d7f` (the first, failed R1 packaging — reachable as
an ancestor of the merged R1 candidate) reports 6 `DGL-031` errors, naming exactly the three proofs
that were `BLOCKED_ENVIRONMENT` in that dispatch. Linting the final gated R1 candidate
`7186f187e4b34a6ae6b99ace544f34f4270b0b78` and the PROVEN-doc candidate `26eb6a81…` reports zero
errors and zero warnings.

## Prettier-only verification

`tests/unit/luBootstrapProofScriptsIsolation.test.ts` was reformatted with `prettier --write`. The
change was verified formatting-only by parsing both versions with the TypeScript compiler API and
comparing node kinds and literal values (ignoring quote style, semicolons, wrapping and redundant
parentheses) — identical — and comparing extracted comment text (whitespace-insensitive) —
identical. The comparator was checked for a false negative by mutating one string literal and
confirming it reports a difference.

## Noise measurement

Linting all 25 committed unit definitions on `main`: 19 report at least one finding, mostly
`DGL-020` (older units did not set `blocked_exit_codes`) and `DGL-050` (no audit record path
declared in `allowed_paths`). Zero false-positive `DGL-031` findings after calibration (an earlier
draft flagged string fixtures and `vi.mock()`-guarded imports; both are excluded now). Findings
carry a `kind` — `gate`, `proof-validity`, or `hygiene` — so an ERROR never overstates: only `gate`
findings drive a `LIKELY_TO_FAIL` preflight verdict.

## Newly discovered gap (not fixed here, recorded for the next tooling unit)

The trusted attest workflow's "Checkout exact execution SHA" step
(`.github/workflows/devgov-v0-attest.yml`) does not set `fetch-depth`, so RED and GREEN commands
run against a **shallow** checkout containing only the single target commit. A proof command that
needs a different commit's history (`git show <other-sha>`, `git cat-file <other-sha>`) would fail
there even though it works in a full local clone. This unit's retroactive historical check above
was therefore run locally only, never as a candidate RED/GREEN command; the trusted proofs use only
files present in the single checked-out commit.

## RED (executed at `base_sha`)

Both RED commands are inline `node` programs. Neither depends on a file introduced after the base,
and neither runs `git`. Exit `0` = property holds (`PASS`), exit `1` = violation confirmed
(`FAIL`, the only valid RED), exit `2` = harness fault (`BLOCKED_ENVIRONMENT` via
`blocked_exit_codes: [2]`), never a valid RED.

| RED proof ID | Property falsified on `864a62f7…` |
|---|---|
| `isolation-test-prettier-violation` | `npx prettier --check tests/unit/luBootstrapProofScriptsIsolation.test.ts` reports a formatting violation |
| `dev-helpers-cli-absent` | None of `scripts/dev-helpers/{devgov-helper.mjs,lib/*.mjs}` exist on this tree |

## GREEN (executed at the candidate)

The same two programs, expected `PASS`, plus one GREEN-only proof:

| GREEN proof ID | Evidence |
|---|---|
| `isolation-test-prettier-violation` | Prettier reports the file already formatted |
| `dev-helpers-cli-absent` | All four tooling files are present |
| `dev-helpers-unit-tests` | `scripts/dev-helpers/unit/devgovHelpers.test.ts` (27 tests) passes |

## Non-claims

This unit does **not**:

- claim an independent cold audit occurred (none did; see above);
- claim the linter or preflight tool is complete or exhaustive — it is explicitly heuristic
  (regex-based import parsing, no type information) and can both over- and under-approximate;
- change, weaken, or bypass `scripts/devgov/devgov.mjs`, any `.github/workflows/**` file, or
  `governance/devgov/schema/**`;
- fix the stale outcome-id in `scripts/ops/prove-lu-replay-cold-verify-01.ts`;
- introduce any new trust root; a clean lint or preflight result proves nothing on its own, and the
  protected controller and canonical gate remain the sole authority.

## Finalization rule

This document remains CANDIDATE until the exact candidate SHA receives
`DEV-GOV-V0 / trusted-execution = success`, is merged with a merge commit, and the merge tree is
verified equal to the gated candidate tree — the same rule LU-CANONICAL-RUNTIME-HARDENING-R1 used.
Given the absence of an independent cold audit, this unit is not asserted PROVEN by this record
alone even after the gate passes; the owner should treat the trusted gate result as tooling-grade
confidence, not authority-grade.
