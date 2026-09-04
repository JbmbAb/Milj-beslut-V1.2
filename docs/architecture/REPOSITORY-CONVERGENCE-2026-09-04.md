# Repository Convergence — 2026-09-04

**Status: NON-NORMATIVE / TEMPORARY**

This is a working ledger for one convergence pass. It records what was decided, what was closed, and
what remains — nothing more. It **does not own architecture semantics**. Where it touches a decision,
the decision lives elsewhere; this file only points at it. When convergence completes, mark this file
`CLOSED / HISTORICAL`.

Canonical live `main` at the end of this pass: `2855f6c6e890f1631bb4236d64b41171ca1f3dc1`

---

## Canonical source identities

| Identity                          | SHA                                                   | Standing                                                                                  |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Previously adopted A-Q-E state    | `9cbc88f8` (PR #112 head)                             | `HISTORICALLY_ADOPTED_SOURCE` / `PRESERVE_AS_PROVENANCE` / **not** current-main authority |
| Divergent sibling lane            | `9650d073` (`feat/p2-p3-governed-chain-reproducible`) | `ARCHIVABLE DIVERGENT LANE`                                                               |
| Rejected reconciliation candidate | `bccca11d`                                            | `REJECTED / NEVER PUSH / NEVER PROMOTE`                                                   |

---

## CLOSED

**`bccca11d` — failed reconciliation, never pushed.**
Independent verification found it does not preserve the adopted A-Q-E semantics. Four differences
classified `CONFLICTS_WITH_ADOPTED_SEMANTIC`; three independent refuters unanimously found the verdict
correct and _understated_, reclassifying two further items against it. The change is 100% additive
(61 insertions, 0 deletions; shared body byte-identical by sha256 and `cmp`), so the common review
heuristic "nothing was removed, so nothing was rewritten" passes it — every conflict lives in the
seams, where new text contradicts retained text.

**`9650d073` — archivable, nothing to extract.**
Its entire unique content is three paths, two with genuinely unique content: two unadopted-research
ADR drafts and one stale `package.json` byte-identical to the merge-base. The other 133 differing
paths carry blobs byte-identical to main. `GENUINELY_MISSING` count: **0**.

A material finding: `bccca11d`'s A-Q-E blob and `9650d073`'s are the **same blob**. `bccca11d` was
never a reconciliation of the adopted #112 line.

**A-Q-E current-main reconciliation attempt — closed with no candidate.**
Carrying the adopted document to main unchanged is not possible without introducing defects. Eleven of
its references dangle on main, three of them load-bearing: Sections A/B/C do not exist anywhere (and
§6, declared normative, has Section C category names as its entire left column), no `GA-N*` or `GA-L*`
identifier exists anywhere in the tree, and the document cites both a commit that is not an ancestor
of main and the banned lane by name. Any future current-main A-Q-E contract must be a **new successor
artifact** with explicit predecessor mapping, resolvable normative dependencies, and its own owner
adoption.

**DEV-GOV-V0 bootstrap defects.** See `DEV-GOV-V0-FOUNDATION-CLOSEOUT.md`.

---

## PARKED

- **Historical #112 A-Q-E** — provenance only. Do not copy unchanged; do not rewrite its adoption
  claims to fit main.
- **Authority-root material**, including `docs/ops/ROOT-OF-TRUST-BOOTSTRAP-CEREMONY-V1.md` —
  `UNADOPTED_AUTHORITY_ROOT_MATERIAL`, do not carry to main. No `Owner Decision` provenance may be
  asserted for it without explicit owner approval.
- **Authority-revocation research** — `DRAFT / PROPOSED / NOT ADOPTED`. Must not implicitly amend or
  supersede adopted A-Q-E semantics.

---

## Resolved non-problems

Recorded so they are not re-investigated:

| Signal                                   | Why it is not a repository defect                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #113 "Security audit" red             | Job **cancelled** at the 5-minute timeout during an npm registry 503 outage, with zero audit output. Not an assertion failure.                       |
| PR #113 "npm audit (high+)" green        | False green. `supply-chain.yml` sets `continue-on-error: true`; the step exited 1 and the job still reported success. Never cite it as a clean tree. |
| PR #113 staging-proof failures           | PR-metadata incompleteness. `staging-proof-gate.yml` has an explicit N/A path requiring a non-empty "Validated scope".                               |
| 3463 ESLint errors under `public/cesium` | Vendored Cesium build output, copied verbatim from `node_modules` by `scripts/copy-cesium-assets.cjs`. The defect was lint scope; U2 fixed it.       |
| 17 local-only Prisma typecheck errors    | Local environment artifact — `node_modules` is a symlink and `.prisma/client` was never generated. Absent in CI.                                     |
| 2 "critical" Dependabot alerts           | `vitest ^0.34.0` declared in two sub-manifests that are never installed; the root has no `workspaces` field. Outside the installed graph.            |

---

## Known observability traps

Both cost real time in this pass and will mislead again:

- **`continue-on-error` masks `outcome` behind `conclusion`.** The GitHub API reports a step's
  _masked_ conclusion. A DEV-GOV evidence-gate step showed `conclusion: success` while its real outcome
  was failure; only the publish step revealed it. Read `outcome`, or read the published result — never
  the step conclusion alone.
- **CI logs carry a timestamp prefix**, so `^\[warn\]` and `^\[error\]` anchors never match, and
  Prettier's own summary line is itself a `[warn]` line. Naive counting silently reports zero.

---

## ACTIVE

**CI recovery train U1–U4 — all four landed.** Each was a fresh direct child of the then-current live
main, proved by exact-SHA DEV-GOV RED/GREEN/attest/gate, and landed by pure fast-forward. **No
branch-protection exception was used at any point**, and branch protection was byte-identical before
and after each landing.

| Unit                                    | SHA        | Claim                                                                                       | Effect                                                                 |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| U1 `CI-BASELINE-SYNTAX-RECOVERY`        | `f7600ebb` | the staging C-anmälan E2E spec is syntactically valid                                       | Prettier parse errors 1 → 0; lint fatal parse 1 → 0                    |
| U2 `CI-BASELINE-LINT-SCOPE`             | `1f18c478` | no vendored build output is linted as first-party source                                    | lint errors 3517 → 53                                                  |
| U3 `CI-BASELINE-AUDIT-GATE-VALIDITY-V2` | `5b625396` | the blocking audit gate uses a supported npm threshold **and** its failure is not swallowed | declared threshold now matches the enforced one (see correction below) |
| U4 `CI-BASELINE-MODULE-RESOLUTION`      | `2855f6c6` | every module specifier in the tsc program resolves, except a declared contract divergence   | typecheck 93 → 87 (CI); TS2307 10 → 4                                  |

None of these units made CI green, and none claimed to. They made the CI signal **truthful**.

### Corrections to this pass's own reporting

Two claims made while the train was running did not survive adversarial re-measurement. Both are
recorded here rather than quietly amended.

**U3 loosened the audit gate; it did not un-mask it.** The interim report framed U3 as moving the gate
from "masked/cancelled" to a real assertion failure. That is wrong, and it conflated two unrelated
things: PR #113's _cancellation_ (a 503 infrastructure event on a different run) and the _flag defect_.
Measured against this exact lockfile: the pre-U3 form `npm audit --fail-on=high` exits **1** — the gate
was already red, asserting on real advisories. Because npm discarded the unsupported flag it fell back
to its default threshold (fail on any severity), so U3's move to `--audit-level=high` made the gate
**strictly more permissive**. The threshold is now genuinely live (`--audit-level=critical` → exit 0,
`--audit-level=moderate` → exit 1). What U3 actually fixed is real but narrower than claimed: the
declared threshold now matches the enforced one. Today both forms are red because six high advisories
exist; if those were resolved and only the one moderate remained, the old gate would still fail and the
new one would pass.

**U4's anti-trade guard is a measurement, not a proven property.** The guard (total 103 → 97, TS2307
10 → 4, zero newly appearing errors) was measured by hand before landing and holds. But the unit's
machine-checked assertion only requires that every remaining `error TS2307` line begins with
`packages/mps-query-budget/`. It asserts nothing about the total error count and nothing about the
file set in the tsc program. Since `tsconfig.json` is in the unit's `allowed_paths`, that green is
satisfiable by narrowing scope — and the commit exercised exactly that freedom: 2 of the 6 removed
TS2307 disappeared because `docs` was excluded from the program, not because anything was repaired.
Future units of this shape need an explicit anti-narrowing invariant in the probe itself.

---

## Phase D — six-way baseline classification

Every signal on `2855f6c6`, classified once. Measurements taken from the authoritative CI run
(33916289541) and independently reproduced locally where possible.

| Signal                                 | Classification                                    |
| -------------------------------------- | ------------------------------------------------- |
| Format check                           | `REAL_FIRST_PARTY_DEFECT`                         |
| Typecheck                              | `REAL_FIRST_PARTY_DEFECT`                         |
| Lint                                   | `REAL_FIRST_PARTY_DEFECT`                         |
| Security audit                         | `EXPECTED_SECURITY_FAILURE` — disputed, see below |
| Unit / Integration / Build / E2E tests | `UNCLASSIFIED`                                    |
| Gate on CI success                     | `UNCLASSIFIED`                                    |
| Deploy to staging                      | `UNCLASSIFIED`                                    |
| CodeQL analyze                         | job `PASS`, but see the alert finding below       |
| `DEV-GOV-V0 / trusted-execution`       | `PASS`                                            |

`UNCLASSIFIED` on the skipped test jobs is deliberate and is not uncertainty. Those jobs declare
`needs: [typecheck, lint, format, audit]`; all four failed, so GitHub skipped them by correct DAG
gating. That is neither a pass, nor a first-party defect, nor an environment failure — the six-category
taxonomy has no bucket for "correctly gated non-execution producing zero evidence", so the gap is
recorded rather than papered over.

All 87 typecheck errors and all 53 lint errors are first-party; zero are vendored and zero are
environment artifacts. Both were attributed to root-cause groups summing exactly, and both reproduce
locally (lint exactly; typecheck reconciles 97 local → 87 CI entirely through the ungenerated Prisma
client, verified error-code by error-code).

### Disputed classifications

- **Security audit.** Given the U3 correction above, calling this purely `EXPECTED_SECURITY_FAILURE`
  understates it: four of the six high advisories offer only a `fixAvailable` that is a semver-major
  _downgrade_, so the gate is not merely red-today but structurally red, and it sits in the `needs:`
  list that blocks every test job. The advisories themselves are genuinely third-party and expected;
  the gate's position in the DAG is a configuration question the owner may want to revisit separately.
- **CodeQL.** The check-run passes, but it is a non-asserting reporter. There are **63 open code
  scanning alerts** — 3 critical, 57 high, 3 medium — of which **49 are first-party**. No gate in the
  repository reports on them, and neither the CI DAG nor branch protection references them. Recording
  the job as a plain `PASS` is technically correct and materially misleading.
- **Deploy to staging.** Classified `UNCLASSIFIED` for consistency with its sibling job in the same
  run; a `skipped` conclusion renders as neutral rather than red, which is itself a reporting hazard.

### Unobserved gates

Sixteen workflows exist; most contributed nothing to this baseline. The ones worth naming:

- **`devgov-v0.yml`** — the read-only DEV-GOV validation gate. It triggers only on `pull_request` with
  paths covering `governance/devgov/**`. All four recovery units touched exactly those paths, yet none
  went through a pull request, so this gate has effectively never run for them. It has **1 run in its
  entire history**.
- **`vertex_prompt_updater.yaml`** — **0 runs ever**.
- **`build-postgres-image.yml`** — 2 runs in its entire history, yet it publishes the Postgres image
  that the integration and E2E jobs depend on.
- **`release-prompt-optimizer.yml`** — its three most recent runs all failed; red since July.
- **`supply-chain.yml`** — runs on PRs but gates nothing, and its audit step's `continue-on-error`
  makes a green result meaningless as evidence.
- **`staging-e2e-proof.yml`** — the only workflow that actually drives the staging flows; never
  attaches to a PR automatically.

### Coverage holes found while classifying

- **No executed test evidence on main — and not just this run.** The last 15 CI runs on `main`
  (2026-08-09 → 2026-09-04) were checked job by job. Unit, Integration, Build and E2E have not
  produced evidence in any of them.
- **The format gate is scoped to a hand-picked glob** covering 771 tracked paths, so most of the
  repository is not format-checked at all. The 131 failures are real; the silence elsewhere is not
  evidence of cleanliness.
- **The two static gates that do execute are blind to the directories carrying the security findings.**
- **No local enforcement exists** — there is no `.husky` directory, and `.pre-commit-config.yaml` is
  Python-only. Nothing prevents the same drift recurring.
- **Branch protection requires no reviews at all** — only the single `DEV-GOV-V0 / trusted-execution`
  status context.

---

## Remaining defects (classified, deliberately not fixed in this pass)

- **131 unformatted files.** Genuine accumulated formatter neglect, not config drift — the
  `format:check` scripts have not changed since 2026-03-05, and the gate went green→red on
  2026-07-28. Deliberately not batched, because a repo-wide `prettier --write` would collide with open
  PRs.
- **53 first-party ESLint errors** across 18 files, including one real latent defect: a duplicate
  `case 'askGeneralAssistant'` in `server/geminiApi.express.ts`, where the first case wins and the
  later block is dead code behind a fail-closed guard.
- **87 typecheck errors (CI)**, of which 4 are TS2307 in `packages/mps-query-budget`. Those four are a
  genuine contract divergence, not a path defect: `mps-retrieval-governance` and `mps-retrieval-trace`
  exist, but `ArtifactReader.ts` and `RetrievalExecutionTraceArtifact.ts` do not. Resolving them
  requires a design decision.
- **7 dependency advisories** (6 high, 1 moderate, 0 critical). The audit gate is now correct and is
  expected to stay red while they exist.
- **No executed test evidence on main.** Unit, Integration, Build and E2E remain `skipped` because they
  declare `needs: [typecheck, lint, format, audit]`. Until those four gates pass, the test suite
  contributes nothing to the baseline.

---

## Awaiting disposition

| Item                            | State                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| PR #113 (V0 closeout + metrics) | Open; the documents exist, but that run produced no test evidence                        |
| PR #112                         | `NEEDS_RECONCILIATION` — 44 of its 46 files, including all code, remain unlanded         |
| PR #105                         | `NEEDS_RECONCILIATION`                                                                   |
| Dependency PRs                  | Deferred until the baseline is legible                                                   |
| DEV-GOV PR integration          | Not started. `devgov-v0-attest.yml` and `devgov-v0-gate.yml` remain manually dispatched. |

## Documentation not yet on main

- `DEV-GOV-V0-FOUNDATION-CLOSEOUT.md` and `DEV-GOV-V0-ACCEPTANCE-METRICS.md` — on PR #113, unlanded.
