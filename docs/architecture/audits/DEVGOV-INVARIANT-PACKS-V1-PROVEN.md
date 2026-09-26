# DEVGOV-INVARIANT-PACKS-V1 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #178
**Gated candidate:** `65ae1487eb7327bc85f80655bacbded84bd09df7`
**Merge commit:** `7ec4b1b262e30fe3ff18ecba6d11133c98cb7384`
**Merge tree:** `30f2f10686df370d06b56cb6da3b7a8e6ef74152`
**Candidate tree:** `30f2f10686df370d06b56cb6da3b7a8e6ef74152`

This record is introduced by its own DEV-GOV unit, `DEVGOV-INVARIANT-PACKS-V1-PROVEN-DOC-V1`.
The implementation unit was proven on the exact candidate SHA before promotion. Finalization is bound by exact tree equality between that gated candidate and the merge commit; the implementation unit is not re-used to prove the merge SHA because its remote branch intentionally remains pinned to the candidate branch.

## Anchors
- Protected base before promotion: `c822854574c2eb0182a5fdf470b39135b1348e68`
- Gated candidate: `65ae1487eb7327bc85f80655bacbded84bd09df7`
- Promotion merge: `7ec4b1b262e30fe3ff18ecba6d11133c98cb7384`
- Promotion PR: #178
- Candidate and merge trees are byte-identical; `git diff 65ae1487 7ec4b1b2` is empty.

## Trusted execution evidence
- Protected orchestration run: `36230319826`
- Canonical trusted evidence gate: `36230861086`
- Gate verdict: PASS
- `proof_status: PROVEN`
- Proof cardinality: 6 executions (1 RED + 5 GREEN)
- Trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- OIDC audience: `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:65ae1487eb7327bc85f80655bacbded84bd09df7`
- Required candidate commit status: `DEV-GOV-V0 / trusted-execution = success`

RED:
- `controller-owned-invariant-packs-v1-present`

GREEN:
- `controller-owned-invariant-packs-v1-present`
- `controller-owned-invariant-packs-v1-live`
- `controller-owned-invariant-packs-v1-focused-tests`
- `controller-owned-invariant-packs-v1-full-devgov-suite`
- `controller-owned-invariant-packs-v1-targeted-format`

## Merge topology
PR #178 was merged with a merge commit. The gated candidate and merge commit have identical trees:

```text
tree(65ae1487eb7327bc85f80655bacbded84bd09df7)
==
tree(7ec4b1b262e30fe3ff18ecba6d11133c98cb7384)
==
30f2f10686df370d06b56cb6da3b7a8e6ef74152
```

Therefore protected main contains the exact implementation tree that passed the trusted gate.

## Post-merge negative control
A later attempt to re-run the implementation unit directly against merge SHA `7ec4b1b2...` produced:
- orchestrator `36231285735`: failure
- canonical gate `36231606577`: `DENIED_GOVERNANCE / SHA_VERIFICATION_DENIED`
- invariant packs: PASS
- reason: the implementation manifest verifies remote branch `governance/devgov-invariant-packs-v1-r3`, whose remote head is gated candidate `65ae1487...`, not the merge commit.

This failed-closed result confirms the exact-SHA remote check cannot be bypassed. Finalization follows the existing proven-doc precedent: candidate trusted proof + promotion tree equality + separately gated PROVEN record.

## Proven claims
1. Controller-owned invariant-pack registry and execution are present and fail closed.
2. Protected gate/orchestrator paths are covered by the registered controller-owned pack.
3. Focused Dev-Gov regression tests and the full Dev-Gov suite passed in isolated trusted execution.
4. Targeted formatting passed.
5. The exact gated implementation tree is the tree merged to protected main.

## Final disposition
`DEVGOV-INVARIANT-PACKS-V1 = PROVEN`
