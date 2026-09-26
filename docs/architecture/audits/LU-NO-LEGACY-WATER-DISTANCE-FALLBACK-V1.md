# LU-NO-LEGACY-WATER-DISTANCE-FALLBACK-V1 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN
**Frozen base:** `b6511b972ca48fb37c4ec996e43194246e58a1c3`
**Frozen implementation candidate:** `a56cc21f90c263570a115d3c70afc92eca651b62`
**Unit:** `LU-NO-LEGACY-WATER-DISTANCE-FALLBACK-V1`

## Purpose

`NO_LEGACY_WATER_DISTANCE_FALLBACK_MECHANICAL_V1`: removes a fabricated legacy 200 m
water-distance fallback from the LU compliance-rule pipeline, and adds a structural regression
guard so it cannot silently return. This is a **mechanical-only** fix — no new legal/risk
semantics, no new `RiskLevel` tier, no `permitProbability` cap. Adding those is explicitly out of
scope for this unit (see OD-04, deferred to a later, separately-authorized unit).

## Frozen claim

- An unknown/unmeasured distance to water reaches `evaluateComplianceRules` as `null`
  end-to-end, never as a fabricated number (previously: `200`, sitting just outside the < 100 m
  Strandskydd threshold, silently read as "verified clear").
- `Number.isFinite(distanceToWater)` gates the Strandskydd check, so `null`, `NaN`, `Infinity`,
  and `-Infinity` are all correctly treated as "not close to water", none of them coerced into a
  false positive (the pre-fix code's `distanceToWater < 100` coerced a bare `null` to `0`).
- A structural text-pattern guard (`NoAlternateLuDecisionPath.test.ts`) scans the full production
  source surface (well over a thousand `.ts`/`.tsx` files under `src`, `server`, `packages`,
  `components`) for reintroduction of a fabricated numeric-literal fallback, in call-site
  (`??`/`||`, including their `??=`/`||=` compound-assignment spellings), default-parameter, or
  ternary form — for signed/unsigned decimal, exponent, hex, binary, and octal literals, with or
  without ES2021 numeric separators, and (CALLSITE/DEFAULT only) one level of parenthesis
  wrapping.
- The guard's own HONEST LIMIT section names seven specific, verified things it does **not**
  catch (dataflow/alias indirection; BigInt; unbounded parenthesis nesting; a ternary where
  neither branch is null/undefined; TERNARY-position parenthesis wrapping; a line-broken
  standalone null-check ternary; a coalesce condition containing its own parenthesised
  sub-expression). This is a text-pattern scanner, not a parser — no broader claim is made.

## Implementation lineage

This unit's implementation and hardening spans the following commits, all on
`worktree-w1-no-legacy-water-distance-fallback-mechanical`, from protected base
`9b3605c2f008983c93f89ef441165b35b37d6703` (pre–Step 5) through reconciliation onto
`b6511b972ca48fb37c4ec996e43194246e58a1c3` (post–Step 5 / DEVGOV-INVARIANT-PACKS-V1):

1. `7bb6cfef` — remove the 200 m fallback; `distanceToWater: number | null = null`;
   `Number.isFinite` guard on the Strandskydd check.
2. `bc502665` — restore the pre-existing strict-mode warning (logically unchanged from main);
   broaden the guard from 3 hardcoded files to a full production-surface sweep.
3. `98c5ab9c` — close 3 syntactic guard bypasses found by cold review (suffixed field name,
   ternary nested inside `??`, standalone null-check ternary with the fallback in either branch).
4. `66326c62` — independently re-author the separate verifier branch's findings: generalize the
   guard from literal `200` to any bare numeric literal; fix 3 vacuous mock-assertion tests in
   `localizationReportService.test.ts` (asserting on a value the test's own mock made constant).
5. `13938684` — reconcile onto current protected main `b6511b97` (Step 5 finalized) via merge,
   not rebase, preserving the prior owner-tip history unrewritten. Verified: zero file overlap
   between Step 5's 21 commits and the 6 W1 files.
6. `21018872` — close a guard bypass via the `??=`/`||=` compound-assignment operators (same
   fabrication as `x = x ?? 200`, different spelling, previously unmatched).
7. `e390218c` — close 5 further bypasses: signed literals (`-1`, `+200`), exponent notation
   (`1e3`), hexadecimal (`0xC8`), and single-parenthesis wrapping (`(200)`), applied consistently
   across CALLSITE/DEFAULT/TERNARY via a new shared `NUM_SOURCE` pattern (removing the
   copy-paste-drift risk that had caused each prior gap).
8. `93547f5f` — close 3 more bypasses: numeric separators (`2_00`), binary (`0b11001000`), and
   octal (`0o310`) literals, including separators nested inside hex/binary/octal digit runs.
9. `bae172ba` — correct a fixture-coverage overclaim in the guard's own comments (representative
   per-position coverage was described as exhaustive; corrected to state what is actually true).
10. `a56cc21f` — freeze: restructure HONEST LIMIT into an explicit, numbered closing statement;
    correct a residual "ANY numeric literal" overclaim against the guard's own admitted BigInt
    exception; remove a hardcoded "1702 files" count (a stale-prone claim) in favor of the
    runtime-verified vacuity check; correct an overclaiming test-failure message.

11. `fde8398d` — packaging: adds no further behavior change. Documents three additional
    limitations found by a further independent cold-review pass and empirically confirmed
    against this exact frozen candidate (TERNARY never unwraps parentheses; a line-broken
    standalone null-check ternary; a coalesce condition containing its own parenthesised
    sub-expression) — documentation only, the regex is unchanged and none of these three was
    fixed. Adds this Dev-Gov unit definition and this audit document, both first drafts.
12. This commit — corrects an overclaim found by a further independent cold review of the
    exact `fde8398d` candidate: the unit definition's `w1-targeted-format` GREEN check declared
    `expected_classification: "PASS"` for `prettier --check` on the six W1 files, but that check
    actually exits 1 on this candidate — 3 of the 6 files (both production usecase files and the
    guard test file) are not Prettier-conformant, and **the same 3 files are equally
    non-conformant on base `b6511b97`**: pre-existing formatting debt, not something introduced
    by W1. The claim traced back to a one-time PASS run against an earlier, narrower 3-file
    draft of this unit that did not include these 3 files; when the unit broadened to 6 files,
    the PASS claim was carried forward without re-running the check. Decision (delegated,
    reasoned as not overridden by the owner's active correction of a prior wording draft):
    do not reformat the files to make the probe pass — doing so would change bytes in a
    mechanical unit outside its stated purpose, force a full re-verification, and pull main's
    pre-existing 127-file formatting debt into W1's scope. Removed the `w1-targeted-format`
    GREEN entry entirely instead (now 4 GREEN checks, not 5); corrected this document and the
    PR description accordingly; added the three genuinely-unrealistic literal spellings this
    guard also does not match (`.5`, `-(200)`, `200.` immediately before `:`) as a documentation-
    only HONEST LIMIT addition, no regex change.

## Local verification

- `NoAlternateLuDecisionPath.test.ts`, `complianceRuleEngine.test.ts`,
  `localizationReportService.test.ts`: **75/75 PASS** on the frozen candidate.
- RED (unfixed base `b6511b97`, production files only, guard/test files from the candidate):
  **8/75 FAIL**, the same fixed set across every round this was re-run — the guard's own
  detections plus the direct-engine `-Infinity`/null-passthrough proofs.
- `tsc --noEmit`: byte-identical to a same-repo baseline run on `b6511b97` alone — **87
  `error TS`** occurrences (161 raw output lines; each error spans on average ~1.85 lines of
  output — an earlier PR description conflated "161 output lines" with "161 errors", corrected
  here), none introduced, none in the six W1 files.
- Downstream-consumer regression: `bankComplianceService.test.ts` and
  `geminiBiodiversityService.test.ts` (both import/mock `complianceRuleEngine`'s exports) —
  **10/10 PASS**.
- `prettier --check` on the six W1 files exits **1** on this candidate — 3 of the 6 (both
  production usecase files and the guard test file) are not Prettier-conformant. **The same 3
  files are equally non-conformant on base `b6511b97`** (confirmed by running the check against
  `origin/main`'s copies of the same files): pre-existing formatting debt, not introduced by
  W1. Formatting is explicitly **not part of this unit's GREEN evidence** (see commit 12 above)
  — it is not required, and this candidate makes no claim about it either way beyond this note.
- Zero false positives for the guard's regexes across the full production source surface.

## RED

Two probes, both required to FAIL (detect the violation) at `base_sha`:

1. `legacy-200-fallback-text-present` — greps the three production files for the known fabricated
   `?? 200` / `= 200` shapes. A positive control (the pattern must actually be present at base)
   guards against a silently-empty check.
2. `null-distance-fabricates-strandskydd` — imports the real `evaluateComplianceRules` and calls
   it with an explicit `null` distance. At base, `distanceToWater < 100` with no
   `Number.isFinite` guard coerces `null` to `0`, fabricating a Strandskydd finding — a distinct,
   real defect from the 200 m fallback itself, fixed by the same commit. A positive control
   requires this fabrication to actually occur at base.

Both were run manually against the unfixed base (production files from `origin/main` overlaid
into the candidate's own worktree, then restored — no other worktree touched, nothing committed
there) and confirmed to fail exactly as designed before being written into the unit definition.

## GREEN

Required at `candidate_sha`: both RED probes inverted (now PASS), the three W1 test files
(75/75), and the two downstream-consumer regression files (10/10) — **four GREEN checks, not
five.** An earlier draft of this unit also required targeted Prettier on the six W1 files; that
entry was removed (see commit 12 above) once it was found to fail on this candidate for reasons
pre-existing on base `b6511b97` and unrelated to W1's own change. All four checks were run
manually against this exact candidate and confirmed passing before being written into the unit
definition.

## Non-claims

This unit does not:

- add any new legal/risk semantics, `RiskLevel` tier, or `permitProbability` cap (OD-04,
  deferred);
- change the REQ-8 prose in `generate-localization-report.usecase.ts` or
  `localizationReportService.test.ts` that touches OD-03 — left untouched, deferred to a
  separately-authorized W2 unit;
- claim the guard is a dataflow/semantic analysis, or that it catches every ECMAScript
  numeric-literal spelling (see HONEST LIMIT in the guard's own docstring for the seven named
  exceptions);
- dispatch any Dev-Gov trusted-execution workflow. No dispatch has occurred for this unit;
- merge or push to `main`. Push of the packaging commit and updating PR #180's head is explicitly
  authorized per-SHA by the owner; merge requires separate, later, explicit sign-off.

## Finalization

This record remains CANDIDATE until the exact packaged candidate SHA receives a real trusted-
execution run (`DEV-GOV-V0` / `devgov-v0-attest`), is merged with a merge commit pinned to that
SHA, merge-tree equality is verified, and a separate PROVEN record is admitted. No such run has
been requested or dispatched as of this document.
