# HM-1 LU closure evidence pack

| Field | Value |
|---|---|
| Program gate | `HM-1` |
| Status | `READY_FOR_FINAL_HM1_CLOSURE_REVIEW` |
| Date | 2026-08-13 |
| Proof registry | `HM1-PROOF-REGISTRY-2026-08-13.json` |
| Executable lane | `proof:hm1` / `node scripts/hm1/run-proof-lane.mjs` |
| CI workflow | `.github/workflows/ci.yml` |

## Admitted scope

```text
EXISTENCE_WITHIN_DISTANCE_V1   ADMITTED_FOR_HM1_V1
FEATURE_GEOMETRY               NOT_ADMITTED_FOR_HM1_V1
S5 / R5 / R6                   DORMANT_UNTIL_FEATURE_GEOMETRY_ADMISSION
```

`P4A-LU-02` is proven only for the admitted existence-result semantics. This packet makes no
claim that feature geometry or `sv-canonical-1` geometry canonicalization is implemented.

## Technical closure basis

| Unit | Status | Executable proof |
|---|---|---|
| HM1-A authority reconciliation | `OWNER-FROZEN / CLOSED` | Gate contract + program authority |
| HM1-B governed document/fact runtime | `CLOSED / PROVEN` | `HM1BRealGovernedDocumentChain.test.ts` |
| HM1-C governed assessment persistence | `CLOSED / PROVEN` | `HM1CGovernedAssessmentPersistence.test.ts` |
| P4A-LU provider/runtime/identity/viewer | `CLOSED / PROVEN` | P4A proof files in the registry |
| Replay isolation | `CLOSED / PROVEN` | `F9ReplayContract.test.ts` + `VerticalProof.test.ts` |
| Proof-registry integrity | `PASS` | `HM1DProofRegistryIntegrity.test.ts` |

## Superseded proofs

`LUMagicMoment.test.ts` is preserved unchanged as `LUMagicMoment.test.ts.historical`. Its stale
fixtures and ad hoc assessment construction are replaced by the real-entrypoint, governed
document/fact, governed persistence, and vertical proofs named in the registry.

`LuEnforcementReplay.test.ts` is preserved unchanged as
`LuEnforcementReplay.test.ts.historical`. Its replay isolation invariant is replaced by
`F9ReplayContract.test.ts`; its caller-supplied body/hash spoof invariant is replaced by
`HM1CGovernedAssessmentPersistence.test.ts`, which requires zero writes on mismatch.

Historical files are evidence of the superseded state. They are tracked, content-hash-pinned
after CRLF/LF normalization, excluded
from Vitest discovery, and do not count as active required proofs.

## HM1-D execution record

Executed 2026-08-13 14:26 Europe/Stockholm after the complete HM1 release set was staged.

```text
proof:hm1                    20 files / 116 tests PASS
declared it()-block count    116 / 116 CROSS-VALIDATED
broader mps-lu regression    27 files / 124 tests PASS
clean staged snapshot        tree 15adcec332e7edb22a3305898dcd8ad4582c66ab / 116 tests PASS
proof registry JSON          PASS
authority map JSONC          PASS (jsonc-parser 3.3.1)
active stale proof refs      NONE
git diff --cached --check    PASS
```

The two historical proof files are excluded from test discovery and mapped to executable,
tracked replacement proofs. The runner rejects any required proof that is present only as an
untracked worktree file, and CI invokes the same runner command recorded in the registry.

## Stop rule

HM1-D adds no LU product behavior. After a clean lane run, count cross-validation, JSON/JSONC
validation, and `git diff --check`, this packet moves to `READY_FOR_FINAL_HM1_CLOSURE_REVIEW`.
Only the owner may then declare `HM-1 HIGH_MATURITY`.
