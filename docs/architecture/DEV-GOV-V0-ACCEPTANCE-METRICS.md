# DEV-GOV-V0 Acceptance & Metrics Contract

Status: BASELINE ESTABLISHED, ADVERSARIAL COVERAGE INCOMPLETE
Date: 2026-09-04
Scope: How DEV-GOV is measured, now and going forward. Not a record of what
happened (see `DEV-GOV-V0-FOUNDATION-CLOSEOUT.md`) and not an architectural
decision record (see the DEV-GOV ADR, once written).

## 1. Scorecard

| Area                   | Metric                                                                        | Target                         | V0 baseline                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity integrity     | % of runs where base/candidate/controller SHA bind exactly                    | 100%                           | **PROVEN** — every recorded run in the closeout carries an independently re-verified exact SHA triple; no substitution observed                                                                                                                                                                                                                                  |
| Causal proof           | RED yields the expected negative outcome, GREEN the expected positive outcome | 100%                           | **PROVEN** — confirmed for `236ccdf6` (runs `33847098588`/`33849417986`) and `0b3eb541` (runs `33860984340`/`33860992231`), both re-derived from raw execution records, not trusted summaries                                                                                                                                                                    |
| Attestation integrity  | All accepted proofs are signed and verifiable                                 | 100%                           | **PROVEN** for the runs exercised — signed artifacts confirmed present (`devgov-attestation-RED/GREEN-...`) after the signer-key defect (§2.3 of closeout) was resolved                                                                                                                                                                                          |
| Gate correctness       | Evidence gate accepts the right candidate, denies wrong/substituted evidence  | 100% (accept path only tested) | **PARTIALLY PROVEN** — accept path proven twice; **reject path never adversarially tested** in this bootstrap                                                                                                                                                                                                                                                    |
| Promotion integrity    | Promoted SHA == PROVEN SHA, no substitution/squash/recreate                   | 100%                           | **PROVEN** — 4 promotions, all pure fast-forwards, all independently SHA-diffed pre/post; one near-miss (`236ccdf6`) correctly caught and frozen rather than force-promoted                                                                                                                                                                                      |
| Replay/reproducibility | Same evidence + controller + policy → same verdict                            | 100%                           | **NOT TESTED** — no run was replayed against the same evidence a second time in this bootstrap                                                                                                                                                                                                                                                                   |
| Fail-closed            | Missing/wrong evidence, signer, SHA, or policy → DENY                         | 100%                           | **PARTIALLY PROVEN** — observed fail-closed behavior only for the specific failures that occurred naturally (symlink attacks rejected exit 4; isolation failures exited 1, not silently ignored; signer decode failure returned `BLOCKED_ENVIRONMENT`, not a false PASS). No deliberate adversarial injection was performed against the gate/attest path itself. |
| False acceptance       | Defective/forged candidate accepted                                           | 0                              | **NOT MEASURED** — no forged candidate was submitted in this bootstrap; 0/0, not 0/N                                                                                                                                                                                                                                                                             |
| False rejection        | Correct candidate blocked by a DEV-GOV defect                                 | near 0                         | 2 observed (v1 symlink-guard tautology; silent isolation failure) — both root-caused and closed, not open                                                                                                                                                                                                                                                        |
| Operator burden        | Manual interventions/approvals per promotion                                  | should decrease                | 4 promotions, each requiring: 1 explicit narrow owner authorization + 1 branch-protection PATCH/restore cycle + (for candidates with RED/GREEN/gate) 1–3 reviewer approvals (`JImMMbt`, `devgov-attestation` environment). No automation of the promotion ceremony itself exists yet — see §3.                                                                   |
| Lead time              | candidate → PROVEN → PROMOTED                                                 | should decrease                | Not tracked with timestamps precise enough to report a number; qualitatively, RED/GREEN/attest/gate cycles ran in minutes once dispatched, but wall-clock time was dominated by reviewer-approval latency and one anomalously slow isolation step (~7.5 min vs. typical 40–90s, cause not diagnosed — see §4)                                                    |
| Recovery               | Time/steps from blocked run to correctly classified cause                     | should decrease                | 3 real incidents in this bootstrap, each root-caused via a single purpose-built diagnostic candidate (d975e7ef → eab97f9d → c656ec6f) — recovery path exists and worked, but required 3 separate promotion cycles rather than one                                                                                                                                |

## 2. The central question

> Can the system distinguish an actually valid change from a
> convincing-looking but invalid change?

**Not yet adversarially answered.** Every candidate promoted in this
bootstrap was, in fact, valid — the "attacks" that occurred (symlink
substitution, silent isolation failure, signer key format) were real defects
discovered incidentally, not deliberately injected to test the gate's
rejection behavior. This is the single largest gap in the V0 baseline.

### Adversarial case coverage (target: EXPECTED=DENY, ACTUAL=DENY, for each)

| Case                             | Tested in V0?                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong candidate SHA              | No                                                                                                                                                                           |
| Wrong controller SHA             | No                                                                                                                                                                           |
| Stale RED                        | No                                                                                                                                                                           |
| Stale GREEN                      | No                                                                                                                                                                           |
| GREEN from another candidate     | No                                                                                                                                                                           |
| Forged execution record          | No                                                                                                                                                                           |
| Valid signature but wrong issuer | No                                                                                                                                                                           |
| Missing attestation              | No                                                                                                                                                                           |
| Wrong proof type                 | No                                                                                                                                                                           |
| Base/candidate lineage mismatch  | Partially — `236ccdf6`'s stale lineage was caught, but that was an _organic_ mismatch discovered during planning, not a deliberate adversarial submission to the gate itself |
| Status posted on wrong SHA       | No                                                                                                                                                                           |
| Promotion substitution           | No — no attempt was made to fast-forward to a SHA other than the intended one                                                                                                |
| Tampered manifest/probe          | No                                                                                                                                                                           |

**Security/evidence pass rate: not yet computable** — denominator is 0
adversarial cases attempted against the live gate. The symlink-substitution
testing in the closeout (§2.1) exercised the execution-root guard directly,
not the DEV-GOV gate/attestation pipeline as a whole; it should not be
counted toward this table.

## 3. Practical-usability figures observed in V0

- Manual interventions per candidate: 1 narrow owner authorization text block per promotion (4 total).
- Reviewer approvals: at least 1 per RED/GREEN/gate cycle that reached the `attest` job (`devgov-attestation` environment, `prevent_self_review: true`, single named reviewer).
- Retries: 0 — every dispatched run in this bootstrap ran to completion on the first attempt (failures were genuine defects, not flaky retries).
- Branch-protection manual changes: 4 (one per promotion) — required-check removal + restore, no automation.
- Unclassified failures: 0 — every failure encountered was root-caused to a specific line/command before the bootstrap closed.

## 4. Open items for V1

1. Build and run the adversarial case table in §2 against the live gate; report a real pass rate.
2. Diagnose the one anomalously slow isolation-bootstrap run (~7.5 min `useradd`/`npm ci` sequence vs. typical 40–90s) — not classified as a defect since it completed successfully, but unexplained.
3. Test replay: re-submit identical RED+GREEN run IDs to `devgov-v0-gate.yml` a second time and confirm identical verdict, no double-signing side effects.
4. Consider whether the promotion ceremony (branch-protection PATCH/restore cycle) can be scripted as a single reviewed action instead of a manually-narrated multi-step procedure, to reduce operator burden without weakening the owner-authorization requirement.
5. Decide whether `required_status_checks.checks[0].app_id` binding (see closeout §3) should be explicitly asserted/tested as part of the pre-flight check in future promotions, now that it is a permanent property of the restored state.

## 5. Overall effectiveness formula (as defined by the owner)

```text
DEV-GOV Effectiveness =
  Trust correctness × Reproducibility × Promotion integrity × Operational usability
```

Trust correctness, Reproducibility, and Promotion integrity must each be
100% or the system has a governance problem, not a usability problem.

- **Trust correctness:** PROVEN on the accept path; **UNPROVEN on the reject path** (§2). Cannot yet claim 100%.
- **Reproducibility:** NOT TESTED (§1, replay row). Cannot yet claim 100%.
- **Promotion integrity:** PROVEN — 4/4 promotions exact, 1/1 near-miss correctly caught. 100% on the cases observed.

**Conclusion: V0 has a proven, working accept path and a proven promotion
mechanism, but effectiveness cannot yet be claimed at 100% because the
reject path and replay determinism are untested, not because either is known
to be broken.** This is the honest baseline; V1 work should close §4 before
any claim of full DEV-GOV effectiveness is made.
