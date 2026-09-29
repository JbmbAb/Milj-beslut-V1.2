# HD-SWEEP-A9-01-V1 -- A9-sweep security/correctness findings HD-01/02/03/10/14/15/16

**Status:** CANDIDATE (not yet dispatched)
**Unit:** `governance/devgov/units/hd-sweep-a9-01-v1.json`
**Base:** `ea1ced0e4eaa112e2913a6aaf7e4966253550a9e` (bumped twice; see §3 and §3a)
**PR:** [JbmbAb/Milj-beslut-V1.2#196](https://github.com/JbmbAb/Milj-beslut-V1.2/pull/196)

## 0. Provenance

Seven findings (HD-01, HD-02, HD-03, HD-14, HD-10, HD-15, HD-16) from the A9-sweep (K-147/K-148/
K-149) were relayed to this session's lane by a cross-session message. Per this session's standing
anti-permission-laundering rule, that relay was not acted on by itself: the seven findings were
independently re-read against the real source before any work started, and the decision to proceed
("ja, kör i egen worktree från main-toppen") came directly from Jimmy in this session, not from the
relay. Implementation and its own cold review (candidate `c01d89a7`, K-154, COLD_VERIFIED by
W1-VERIFY-DB) happened before this packaging unit existed. Packaging this candidate as a DEV-GOV-V1
unit, and eventually dispatching it, were likewise only started after Jimmy's direct confirmation in
this session ("godkänner").

## 1. Scope

Two groups, per the original relayed spec:

- **Disable now** (a fabricated success signal replaced with an explicit, typed error): HD-01
  `bankComplianceService.ts`, HD-02 `erpSyncService.ts`, HD-03 `execSummaryQueueService.ts`, HD-14
  `greenCheckGeneratorService.ts` (legacy route, off by default).
- **Fix now** (access-control / internal-contradiction bugs): HD-10 `auditTrailService.ts`, HD-15
  `sewage.routes.ts`, HD-16 `digitalsignatureService.ts`.

`server/modules/sewage/public.ts` re-exports HD-16's new `getOrderRefBinding`, used by HD-15's fix.
`server/security/secureErrors.ts` gained an optional 4th constructor param (`code`). Full per-finding
detail is in PR #196's description, not repeated here.

Explicitly out of scope (registered debt, no code change): `municipalityStatusPolling.ts:255`,
`municipalitySubmissionService.ts:641`+`255`, `massOrchestrator.ts:447`.

## 2. Proof design

HD-01 (`bankComplianceService`) and HD-02 (`erpSyncService`) are pure, synchronous functions with no
DB or network I/O at either base or candidate -- their RED/GREEN proofs import the real module (via
`tsx`) and call the real function, asserting the fabricated-vs-refused/honest behavior directly.

HD-03 and HD-14 call a real external Vertex AI text-generation API when configured; HD-16 calls a
real external BankID service. None of these can run for real inside the trusted `devgov-v0-attest`
sandbox (no live credentials, `npm ci --ignore-scripts` skips `prisma generate`, and the runner has
no network path to either provider). Their RED/GREEN proofs, and HD-10's and HD-15's (which would
otherwise need a live Prisma-backed DB or a mocked Express/supertest harness the sandbox doesn't
have), are instead source-text checks: RED greps the base_sha file for the exact pre-fix shape
(unconditional external-API call, the hardcoded `signatureVerificationStatus: 'VERIFIED'` literal,
absence of the tenant-check pattern in `/validate`+`/submit`, absence of `getOrderRefBinding` in the
signature-status route, absence of `orderRefBindings`/`SIGNATURE_BINDING_*` in
`completeBankIDSignature`); GREEN checks the corresponding fix marker/shape on candidate_sha.

One additional combined GREEN proof, `hd-sweep-focused-tests`, runs a real `npx prisma generate`
preamble (the `--ignore-scripts` gotcha) followed by the actual seven touched vitest test files via
`spawnSync`, matching the pattern already used by `lu-no-legacy-water-distance-fallback-v1.json`'s
`w1-focused-tests`. This is the one proof that exercises real behavior for HD-03/10/14/15/16 rather
than just source shape.

## 3. Base bump: `760d5a15` -> `729a6bd6`

The unit's original base_sha (`760d5a153a2b8fa0f57089873d4d92673fa6a477`, main's tip when this
session's worktree was created) predates F-10 (`DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1`, merged via
PR #197+#199) and W3a (PR #198), both since merged to main. F-10 added the DG-IP-009 controller-owned
invariant pack check, which runs in the orchestrator's first job, before RED/GREEN/gate. Dispatching
against a base predating it fails immediately -- the same class of staleness the W-lane's W3a
candidate hit earlier today (see `Claude outputs/lu-maps-2026-09-26/W3A-COLD-REVIEW-c64d0f07-
2026-09-29.md`, K-166/K-167). W1-VERIFY-DB flagged this independently; confirmed directly before
acting (current `origin/main` tip `729a6bd6`, `CONTROLLER_OWNED_FLOOR_PATHS` present in current
main's `scripts/devgov/devgov.mjs` and absent from this unit's own copy of that file at the prior
candidate).

No overlap between F-10's/W3a's diff and this unit's `allowed_paths` (`git diff 760d5a15..origin/
main --stat` against the 15 touched files returns nothing). `git merge origin/main --no-edit`
completed clean, no conflicts. `base_sha` bumped to `729a6bd6816e184f013b57677c3ed8594d0eefe3`
afterward in its own commit. This candidate (`4a8f67e4`) was dispatched, and the DEV-GOV-V0
orchestration run (`36580853877`) completed successfully end to end (RED, sign, GREEN, sign, gate,
handoff all green; commit status `success` on `4a8f67e4`) -- before the second bump below made that
SHA moot for merging.

## 3a. Second base bump: `729a6bd6` -> `ea1ced0e`, V1-THROUGHPUT same-run signing restructure

Flagged by a relayed message (from the session also identifying itself as W1-VERIFY-DB / "Boss" --
noted as an inconsistency, surfaced to Jimmy, not itself treated as authorization for anything).
Confirmed independently before acting, same discipline as §3: `origin/main` tip is `ea1ced0e`;
`git diff 729a6bd6..ea1ced0e --stat` on `.github/workflows/devgov-v0-attest.yml` and
`devgov-v0-orchestrate.yml` shows the attest job shrinking by 80 lines and the orchestrator growing
by 99 -- matches the claimed restructure (this unit's own already-completed run's job names, "Execute
declared proof without signer authority" / "Sign on isolated protected runner", are consistent with
that new structure, not the old reusable-workflow-with-manual-attestation-gate one). Zero overlap
between that diff and this unit's `allowed_paths`. This unit's only reference to the string "attest"
is the standard `trusted_execution.issuer` identity value
(`github-actions:JbmbAb/Milj-beslut-V1.2:devgov-v0-attest`), unaffected by the restructure and
byte-identical to the already-post-restructure `lu-w3a-legacy-engine-labelling-v1.json` unit's own
value.

One adjacent, unrelated change surfaced by this merge, not a conflict: W3b (`docs/architecture/
audits/LU-W3B-BANK-GEMINI-DOSSIER-CLEANUP-V1.md`) retired `server/routes/bankCompliance.routes.ts`
entirely (zero frontend consumers, per its own C1 decision) while deliberately leaving
`server/services/bankComplianceService.ts` -- this unit's own HD-01 fix -- in place as unreferenced,
forward-only dead code, per the no-drive-by-cleanup norm W3a established. Confirmed via
`tests/unit/bankComplianceRouteRetired.test.ts`'s own comment and assertions. HD-01's fix is
unaffected: the function is still correct, still directly tested by `bankComplianceService.test.ts`;
it is simply no longer reachable via any route, which was already true of its predecessor route's
"zero frontend consumers" state noted in PR #196's own description.

`git merge origin/main --no-edit` completed clean, no conflicts, `base_sha` bumped to
`ea1ced0e4eaa112e2913a6aaf7e4966253550a9e` afterward in its own commit. All 15 proofs re-verified
against the new base/candidate pair before push (see §4).

## 4. Verification

**RED-first (implementation, before packaging existed):** every test assertion in the seven test
files was confirmed failing against the pre-fix code via `git stash` toggle of the corresponding
production file, before the fix was implemented.

**Packaging-time proof verification (this unit), run twice against each base/candidate pair
(`760d5a15`/`c01d89a7`->`8c9d7683`, then again after the bump, `729a6bd6`/`4c8eb71a`->`4aa6a49c`):**

1. A standalone harness (`node <args-from-json>` run directly, not through `devgov.mjs`) against a
   throwaway detached worktree at base_sha and against the candidate worktree.
2. The real `node scripts/devgov/devgov.mjs run-red` / `run-green` CLI, using
   `--definition-worktree`/`--execution-worktree` to point RED at the throwaway base_sha worktree and
   the definition-provenance check at the candidate worktree.

Both runs, both base/candidate pairs: all 7 RED proofs classify `FAIL` (the correct/valid RED
outcome) with their expected marker; all 7 per-finding GREEN proofs classify `PASS`; the combined
`hd-sweep-focused-tests` GREEN proof classifies `PASS`, running the real vitest suite across all
seven touched test files -- **73/73 passed**. Schema-validated against
`governance/devgov/schema/dev-gov-v1-unit-definition.schema.json` with ajv v8 (2020 draft) both
times. `devgov.mjs preflight` and (post-push) `verify-sha` both `PASS` both times.

**Independent verification by W1-VERIFY-DB**, separate from and in addition to the above: re-ran all
15 proofs from scratch in its own isolated worktree against `760d5a15`/`8c9d7683` (before the base
bump) -- same result on every proof, same `73/73`. Also confirmed `8c9d7683`'s diff against its
parent `c01d89a7` (already `COLD_VERIFIED` as K-154) is exactly the one new unit-definition file, 274
lines, nothing else touched. Flagged the base-staleness issue (§3) and one non-blocking lint finding
(this doc's own existence -- see §5) independently of anything reported by this session.

## 5. `devgov-helper.mjs lint` findings

- `[WARN/proof-validity] DGL-050` -- `allowed_paths` had no `docs/architecture/audits/*.md` entry.
  This document is the fix: added to `allowed_paths` alongside the unit JSON itself.
- `[INFO/hygiene] DGL-060` -- 7 RED + 8 GREEN proofs => 15 execute jobs and as many sign jobs. Noted,
  not actionable; proportional to covering seven independent findings with a paired RED/GREEN design
  plus one combined regression proof.

## 6. Known limitations, disclosed

- The source-text RED/GREEN proofs (HD-03, HD-10, HD-14, HD-15, HD-16) confirm the *shape* of the
  fix is present/absent, not full runtime behavior in isolation -- the combined
  `hd-sweep-focused-tests` proof is what actually exercises real behavior for those five findings via
  the real vitest suite (with the DB/network calls those tests already mock). This was a deliberate
  choice given the sandbox's lack of live Vertex/BankID/Postgres access, not an oversight; disclosed
  here rather than presented as equivalent to a fully isolated functional proof per finding.
- `--worktree`/`--definition-worktree`/`--execution-worktree` semantics (definition provenance always
  checked against the candidate worktree; RED execution against a separately-specified worktree) were
  not obvious from the CLI's own `--help` output and were reverse-engineered from `devgov.mjs`
  source during this unit's local verification. Noted in case it helps whoever verifies this next.

## 7. Non-claims

This document does not claim:

- **PROVEN status.** This is a packaging unit for a CANDIDATE, not a PROVEN record; no such record
  exists yet, and this unit must not carry one (a PROVEN record is a separate, later unit).
- **A real trusted-attest CI run.** Every RED/GREEN result above comes from local execution of the
  exact same commands the unit definition declares (both a standalone harness and the real
  `devgov.mjs run-red`/`run-green` CLI), not from an actual `devgov-v0-attest`/`devgov-v0-gate`
  workflow run on GitHub Actions. The real CI run happens only after Jimmy's `dispatch-go`.
- **Full behavioral coverage from the source-text proofs.** As stated in §6, HD-03/10/14/15/16's
  RED/GREEN pair confirms fix *shape*, not full runtime behavior in isolation; the combined
  `hd-sweep-focused-tests` proof is what carries real behavioral coverage for those five findings.
- **Staging or production validation.** PR #196 explicitly leaves the staging-evidence and
  human-in-the-loop checklist items unchecked; this unit does not change that.
- **Independent authorship of the cold review.** The K-154 verdict on `c01d89a7` and the follow-up
  content/base-staleness findings on `8c9d7683` (§3, §4) are W1-VERIFY-DB's own work, summarized
  here for traceability, not re-derived or re-claimed as this session's own finding.
