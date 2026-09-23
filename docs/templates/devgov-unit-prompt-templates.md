# DEV-GOV unit prompt templates (producer, cold-audit verifier, packaging)

**Status:** helper. **Not an authority.** These templates make Claude/Codex work on a DEV-GOV unit
reproducible and cut re-work. They distil what LU-CANONICAL-RUNTIME-HARDENING-R1 taught. If anything here
disagrees with the protected controller (`scripts/devgov/**`), the workflows (`.github/**`), branch
protection, or a frozen owner decision, those win and this file is wrong.

Order of work for a unit: producer brief -> implementation -> cold audit -> packaging -> `lint` and
`preflight` -> push + trusted dispatch -> merge with a merge commit -> tree check -> separate PROVEN record.

## 1. Facts that cost R1 a dispatch or a review round (read before writing proofs)

- **Exit codes decide RED.** The controller classifies any non-zero exit as `FAIL`. A crash, a missing
  module or a syntax error is therefore a *valid RED* unless you separate it: exit `0` = property holds,
  exit `1` = substantive violation, exit `2` = harness fault, and set `blocked_exit_codes: [2]`. Wrap the
  whole program so an unexpected exception exits `2`, and run a control that must pass on every tree.
- **RED runs at `base_sha` from the unit definition alone.** No file that exists only on the candidate, no
  `git` inside the proof command, no writes inside the checkout (the controller rejects a dirty tree).
- **The trusted attest workflow installs with `npm ci --ignore-scripts`.** The repo's `postinstall`
  (`prisma generate`) never runs, so anything that loads `server/db/prisma.ts` (for example the
  `@miljobeslut/mps-lu` package root) fails at import. Provision it inside the command, or do not import it.
- **The controller spawns without a shell.** `npx` cannot be started on Windows (ENOENT ->
  `BLOCKED_ENVIRONMENT`). Prefer `node` wrappers when you want a local dry run.
- **`process.exit()` skips `finally`.** Clean temporary directories before exiting, or the violation path
  (which is the RED path) leaks them.
- **`*.json` is gitignored.** A new unit definition needs `git add -f <file>`; `.gitignore` is not edited.
- **A commit cannot contain its own SHA.** Write "the commit that introduces this file" in the record.
- **Approvals.** Trusted runs wait on the protected `devgov-attestation` environment; only the configured
  reviewer can approve, up to three times (RED signing, GREEN signing, the gate run). The producer cannot.
- **`main` is protected.** Required check `DEV-GOV-V0 / trusted-execution`, branch up to date. Merge with a
  merge commit only, pinned with `--match-head-commit <candidate SHA>`, then verify parents and
  `tree(merge) == tree(candidate)` before any PROVEN record.
- **PR template boxes attest real validation.** Tick only what was done. Use the N/A box plus a non-empty
  "Validated scope" for documentation/governance-only PRs.
- **Shell traps.** Never put backticks in a double-quoted shell command (it is executed). In Git-Bash,
  `/tmp` is not the directory node sees as `C:\tmp`; keep temp files in the session scratchpad.

## 2. Producer brief (fill in, then hand to the implementer)

```text
Repository: <owner/repo>
Base SHA: <40-hex of current protected main>     (verify it against git before starting)
Unit: <UNIT-NAME>

Frozen claim -- prove ONLY the following:
1. <property, stated so it can be falsified on the base tree>
2. ...

Nonclaims -- this unit does NOT: <list; do not widen scope to any of them>.

Design constraints: <what to keep, what not to touch, what not to rewrite>.

Scope discipline. Before editing, output: exact base SHA; proposed changed files; why each is required;
whether any path raises the proof class. Do not edit: .github/**, scripts/devgov/**, Dev-Gov schemas,
authority contracts, grants, CAS implementation, <others>. If the claim needs any of them: STOP and report
the dependency instead of widening the unit.

RED requirements. Semantic, on this exact base, without candidate-only files and without git history.
Name what each RED falsifies on base and why it fails for that reason (not "file not found").
GREEN requirements. Runtime tests for every claim; existing regressions retained; unexecutable or
environment-failing suites are labelled, never counted as PASS.

Completion report. Candidate SHA; exact changed paths; RED command + semantic reason it fails on base;
GREEN commands + results; explicit nonclaims; newly discovered gaps; confirmation of what was NOT touched.
```

## 3. Cold-audit brief (independent verifier -- never the implementer)

```text
You are the independent verifier for <UNIT-NAME>. Do not implement, fix or repackage.
Reproduce from git, not from the implementer's report: the base SHA, the candidate SHA, the changed paths.

Attack, and report each as PASS / FAIL / NOT-EXECUTED (never fold un-run cases into "no regression"):
- Does each RED fail on base for the semantic reason claimed? Would a crash, a missing file or a missing
  module also make it "fail"? (exit-code contract, blocked_exit_codes)
- Can each GREEN go red? Mutate the property and show it does. Is anything vacuously green?
- Is scope exactly the claim? Any change outside the allowed set, or a widened non-claim?
- Does the proof depend on ambient state (env vars, an installed Prisma client, network, the caller's
  MIMERS_ROOT-like resources) that the trusted runner will not have?
- Baseline: compare per-test status base vs candidate on the affected packages; list pre-existing failures
  separately and never as PASS.

Verdict (one of): APPROVED_FOR_DEV_GOV_CANDIDATE | PASS_WITH_CORRECTIONS (list them) |
FAIL_REOPEN_IMPLEMENTATION (list blockers). Do not amend the audited SHA.
```

## 4. Packaging brief (Dev-Gov packaging only)

```text
Continue from the cold-audited candidate <SHA> (frozen base <BASE>). Package ONLY:
  governance/devgov/units/<unit>.json  and  docs/architecture/audits/<unit>.md
Change nothing else (no product code, tests, scripts, workflows, controller, CAS, SecurityRuntime).
allowed_paths = the exact implementation delta + the two packaging files; forbidden_paths must include
.github/**, scripts/devgov/** and governance/devgov/schema/**.
RED = inline programs following section 1; GREEN = the candidate's tests + the same programs.
The record is CANDIDATE, not PROVEN, and names: frozen base, audited SHA, that the packaging delta is only
the two files, the claims, the non-claims, the cold-audit outcome, and the finalization rule.
Before pushing run:  node scripts/dev-helpers/devgov-helper.mjs preflight <definition> --base-worktree <path> --execute
Report: candidate SHA, parent, changed paths, RED/GREEN ids and commands, allowed_paths, working-tree
status. Do not push or dispatch until told.
```

## 5. Helper commands

```text
node scripts/dev-helpers/devgov-helper.mjs lint      <definition.json> [--at <sha>] [--ignore ID,ID] [--json]
node scripts/dev-helpers/devgov-helper.mjs preflight <definition.json> [--candidate <sha>] [--no-remote]
                                                     [--execute --base-worktree <path>] [--ignore ID,ID] [--json]
```

Findings carry a severity and a kind: **gate** (the protected pipeline would reject or block the run),
**proof-validity** (the run would pass but a RED/GREEN would prove less than it claims) and **hygiene**.
Exit `0` = no ERROR, `1` = at least one ERROR, `2` = the helper itself failed. A clean result proves
nothing; a finding can be a false positive (`--ignore RULE_ID` after reading the hint).
`--execute` re-uses the controller's own command runner; it needs a clean checkout of `base_sha` for RED.

## 6. What the helpers do not do (still manual)

Reading trusted-run logs and checking observed classification and `execution_sha`; the post-merge tree
equivalence check; building a faithful `npm ci --ignore-scripts` replica; mutation-testing a proof program;
the independent cold audit; attributing non-required PR check failures to the unit; comparing test status
and typecheck error sets between base and candidate.
