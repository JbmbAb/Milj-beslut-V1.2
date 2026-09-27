# LU-NO-LEGACY-WATER-DISTANCE-FALLBACK-V1 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #180
**Gated candidate:** `fc2bf12f61d117894059c70563f406096428c1b6`
**Merge commit:** `59823b7ce4b009b517a94837e743e36999f6037c`
**Merge tree:** `f497b111bc2578bc327a5add821ed059642fe2b4`
**Candidate tree:** `f497b111bc2578bc327a5add821ed059642fe2b4`

This record is introduced by its own DEV-GOV unit,
`LU-NO-LEGACY-WATER-DISTANCE-FALLBACK-V1-PROVEN-DOC-V1`. The unit's final state takes effect when
this record is itself merged through that gate. It does not edit, and does not replace, the
candidate record `LU-NO-LEGACY-WATER-DISTANCE-FALLBACK-V1.md`.

## Anchors

- Base before this merge (`main`): `6b10f5cf729c5fb814582e30f5e0be81ced6b19c` (the merged ADR-28A
  docs-only decision batch, PR #181)
- Gated candidate: `fc2bf12f61d117894059c70563f406096428c1b6`

The candidate record's own lineage (`LU-NO-LEGACY-WATER-DISTANCE-FALLBACK-V1.md`) documents the
full 14-item implementation and hardening history in detail, from `7bb6cfef` (remove the
fabricated 200 m fallback) through four independent cold-review hardening rounds, the Dev-Gov
packaging commits, the K-15 Prisma-generate fix proven on the real trusted runner at `c192d8f8`,
and the K-18 merge (not rebase, per this unit's own `no_force` remote policy) that brought the
branch up to date with `main` after ADR-28A — producing the final gated candidate `fc2bf12f`. The
delta between the gated candidate and the pre-merge base is exactly the eight files declared in
the unit's `allowed_paths`: the three production/test source files, the guard test file, and this
unit's own two governance files (unit JSON + audit doc) plus the two governance files ADR-28A
itself had already added to `main`.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36283036831`
- Canonical trusted evidence gate: `36283498781`
- Gate verdict: `PASS`, `proof_status: PROVEN`, 6 proof ids (2 RED + 4 GREEN)
- Gate trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience bound to the exact candidate SHA:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:fc2bf12f61d117894059c70563f406096428c1b6`
- Repository workflow `devgov-v0-gate.yml@refs/heads/main`; environment `devgov-attestation`;
  GitHub-hosted runner
- Required commit status on the candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA; packs=v1:PASS:5be20e1bff4d9fe67471804192c80c1f1072da92f31f5481c34b2c6bb84ea8c3`

### Trusted RED (executed at `6b10f5cf…`, observed `FAIL`, exit 1)

- `legacy-200-fallback-text-present` — the fabricated `?? 200` / `= 200` shapes are present in the
  three production files at this base; a positive control guards against a silently-empty check.
- `null-distance-fabricates-strandskydd` — calling `evaluateComplianceRules` with an explicit
  `null` distance at this base fabricates a Strandskydd finding, via the pre-fix
  `distanceToWater < 100` coercing `null` to `0` (JS default parameters do not substitute for an
  explicitly-passed `null`, only for `undefined`) — a distinct defect from the 200 m fallback
  itself, fixed by the same implementation commits.

### Trusted GREEN (executed at the candidate, observed `PASS`, exit 0)

- `legacy-200-fallback-text-absent` (the fabricated fallback text is gone from all three
  production files)
- `null-distance-does-not-fabricate-strandskydd` (the same explicit-`null` call no longer
  fabricates Strandskydd)
- `w1-focused-tests` (`tests/unit/complianceRuleEngine.test.ts`,
  `tests/unit/services/localizationReportService.test.ts`,
  `src/application/unit/NoAlternateLuDecisionPath.test.ts`, 75/75 — with the `npx prisma generate`
  preamble added under delegated decision K-15 after the first dispatch attempt on `e411d7e7`
  failed on this exact runner for lack of a generated Prisma client; independently confirmed
  fixed here on `c192d8f8` and reproduced again unchanged on this rebuilt/merged candidate)
- `w1-downstream-consumer-regression` (`tests/unit/bankComplianceService.test.ts`,
  `tests/unit/geminiBiodiversityService.test.ts`, both consumers of `complianceRuleEngine`'s
  exports, 10/10)

## Merge topology and tree verification

The candidate was merged with a merge commit only, through PR #180, pinned to the exact candidate
head SHA. Squash and rebase were not used for this merge. (An earlier local attempt to bring the
branch up to date via `git rebase` was caught and corrected — per this unit's own
`remote.push_policy: no_force` — before anything was ever pushed; see the candidate record's
lineage item 14 for that history. It has no bearing on this merge, which was an ordinary
fast-forward push of a merge commit.)

Merge commit parents:

1. `6b10f5cf729c5fb814582e30f5e0be81ced6b19c`
2. `fc2bf12f61d117894059c70563f406096428c1b6`

Immediately after the merge:

```text
tree(59823b7ce4b009b517a94837e743e36999f6037c)
==
tree(fc2bf12f61d117894059c70563f406096428c1b6)
==
f497b111bc2578bc327a5add821ed059642fe2b4
```

Therefore the integration result is identical to the gated candidate tree. A diff between the
merge commit and the candidate is empty.

## Proven claims

LU-NO-LEGACY-WATER-DISTANCE-FALLBACK-V1 proves only the following, as stated in the candidate
record:

1. An unknown/unmeasured distance to water reaches `evaluateComplianceRules` as `null`
   end-to-end, never as a fabricated number (the removed legacy default was `200`, sitting just
   outside the < 100 m Strandskydd threshold, which silently read as "verified clear").
2. `Number.isFinite(distanceToWater)` gates the Strandskydd check, so `null`, `NaN`, and
   `Infinity`/`-Infinity` are all correctly treated as "not close to water" — none of them
   coerced into a false positive (the pre-fix code's bare `distanceToWater < 100` coerced `null`
   to `0`).
3. A structural text-pattern guard (`NoAlternateLuDecisionPath.test.ts`) scans the full
   production source surface for reintroduction of a fabricated numeric-literal fallback, in
   call-site (`??`/`||`, including `??=`/`||=`), default-parameter, or ternary form, for
   signed/unsigned decimal, exponent, hex, binary, and octal literals with or without ES2021
   numeric separators, and (CALLSITE/DEFAULT only) one level of parenthesis wrapping.
4. The guard's own HONEST LIMIT section names seven specific, independently-verified things it
   does **not** catch, plus a documented set of unrealistic literal spellings it also does not
   match — it is a text-pattern scanner, not a parser, and is frozen at this coverage level; no
   broader claim is made.

## Non-claims

This unit does **not**:

- add any new legal/risk semantics, `RiskLevel` tier, or `permitProbability` cap (OD-04,
  deferred to a later, separately-authorized unit);
- change the REQ-8 prose in `generate-localization-report.usecase.ts` or
  `localizationReportService.test.ts` that touches OD-03 — left untouched, deferred to W2;
- claim the guard is a dataflow/semantic analysis, or that it catches every ECMAScript
  numeric-literal spelling — see the candidate record's HONEST LIMIT for the named exceptions
  (dataflow/alias indirection, BigInt, unbounded parenthesis nesting, a ternary where neither
  branch is null/undefined, TERNARY-position parenthesis wrapping, a line-broken standalone
  null-check ternary, a coalesce condition containing its own parenthesised sub-expression, and
  the separately-noted unrealistic literal spellings);
- **claim staging validation.** Per delegated decision K-11: no staging environment runs `main`
  today, so no staging run was performed or could have been performed for this unit. The evidence
  this PROVEN record rests on is Dev-Gov trusted RED/GREEN execution (above), local 75/75 test
  confirmation, and `tsc --noEmit` identity to baseline (87 pre-existing errors, none introduced,
  none in this unit's files) — not staging evidence. Real staging validation for the
  Lokaliseringsutredning flow is tracked separately under D-P5/K-6, against a future release SHA
  that includes this unit, once a staging environment exists to run it in (MAP-5 / K-6, open).
- change `scripts/devgov/**`, `.github/workflows/**`, `governance/devgov/schema/**`, the signer,
  or the trust policy.

### Non-required PR checks at merge time

Branch protection on `main` requires only `DEV-GOV-V0 / trusted-execution`, which passed. Five
non-required checks were red on PR #180 at merge time, per delegated decision K-12: `Typecheck`
(87 errors, unchanged baseline), `Lint`, `Format check` (3 of this unit's 6 source/test files are
not Prettier-conformant, and the same 3 files are equally non-conformant on the pre-merge base —
pre-existing debt, not introduced here, and deliberately not fixed per K-13 to avoid pulling
`main`'s unrelated 127-file formatting debt into this mechanical unit), `Security audit` (a
pre-existing transitive dependency finding, unrelated to this unit), and `Require staging proof
in PR` (waived by K-11, see Non-claims above — no box was checked, since checking N/A would have
been false).

## Final disposition

`LU-NO-LEGACY-WATER-DISTANCE-FALLBACK-V1 = PROVEN`

Further LU work may rely on the null-passthrough water-distance contract and the structural
fallback guard as proven, mechanical protections — not as a broader dataflow guarantee, and not
as cover for the still-open REQ-8/OD-03 prose or the OD-04 semantics question, both explicitly
deferred to a separate W2 unit.
