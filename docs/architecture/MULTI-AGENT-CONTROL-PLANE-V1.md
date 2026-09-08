# Multi-Agent Control Plane V1

Status: CONTRACT CANDIDATE

## Purpose

Remove the human operator as a message bus between implementation agents, independent verifiers, DEV-GOV proof execution, and promotion while preserving the existing separation of authority.

The control plane is not an agent and does not make semantic implementation decisions. It owns state transitions, routing, leases, canonical candidate identity, and immutable handoffs.

## Frozen role separation

The following roles are distinct authorities:

- IMPLEMENTER: may create or modify a candidate inside the assigned unit scope.
- VERIFIER: read-only against the candidate; may report PASS/FAIL/BLOCKED, never modify the candidate.
- CONTROLLER: owns unit state and routing; may not synthesize verifier PASS or implementation evidence.
- SIGNER: signs trusted execution records only in the protected signing boundary.
- GATE: evaluates trusted proof and repository state; may publish gate result only.
- PROMOTER: may fast-forward the protected branch to the exact proven candidate SHA only after a trusted gate result.

No role result is authoritative outside its own boundary. An agent saying `PROMOTED`, for example, does not promote anything.

## Canonical unit identity

Every unit is identified by:

- `unit_id`
- `unit_definition_hash`
- `base_sha`
- `candidate_sha` once created
- `branch`
- `scope`
- `proof_contract_hash` when DEV-GOV applies
- `controller_contract_version`

A unit has exactly one canonical candidate lineage at a time. A replacement candidate must explicitly supersede the prior candidate; it must never silently substitute a SHA.

## State machine

Primary states:

1. `PLANNED`
2. `IMPLEMENTING`
3. `IMPLEMENTATION_READY`
4. `VERIFYING`
5. `VERIFY_FAILED`
6. `READY_FOR_DEV_GOV`
7. `PROVING_RED`
8. `PROVING_GREEN`
9. `GATING`
10. `GATE_FAILED`
11. `GATE_PASSED`
12. `PROMOTING`
13. `PROMOTION_FAILED`
14. `PROMOTED`
15. `CLOSED`

Blocking/terminal side states:

- `BLOCKED_ENVIRONMENT`
- `BLOCKED_DESIGN`
- `BLOCKED_DEPENDENCY`
- `CANCELLED`
- `SUPERSEDED`

Only the controller may transition canonical unit state.

## Transition invariants

- `IMPLEMENTATION_READY -> VERIFYING` requires a concrete candidate SHA and clean handoff.
- `VERIFYING -> READY_FOR_DEV_GOV` requires an independent verifier PASS for the exact candidate SHA.
- `VERIFYING -> VERIFY_FAILED` requires one or more findings bound to the exact candidate SHA.
- `VERIFY_FAILED -> IMPLEMENTING` is allowed for semantic or mechanical correction.
- A mechanical-only correction may request narrow delta verification. A semantic correction reopens full verification.
- `READY_FOR_DEV_GOV -> PROVING_RED -> PROVING_GREEN -> GATING` preserves RED-before-GREEN ordering.
- `GATE_PASSED -> PROMOTING` requires the canonical trusted gate result for the exact candidate SHA.
- `PROMOTING -> PROMOTED` requires the protected branch to resolve to the exact candidate SHA after a non-force fast-forward.
- `PROMOTED -> CLOSED` requires final post-promotion identity verification and closure artifact.
- Any environment failure must transition to `BLOCKED_ENVIRONMENT`; product semantics must not be changed merely to make an unavailable environment pass.
- Any trust/authority ambiguity fails closed.

## Routing policy

- semantic defect -> same unit, implementation reopened, full re-verification
- mechanical defect -> same unit, focused correction, narrow delta verification allowed
- environment defect -> `BLOCKED_ENVIRONMENT`, no product/test weakening
- authority/trust defect -> dedicated governance lane, current unit blocked
- verifier PASS -> DEV-GOV if the unit requires trusted proof; otherwise normal landing policy
- gate failure -> never route directly to promotion

## Exclusive leases

A mutable role assignment is protected by a lease on:

`unit_id + role + scope`

At most one active IMPLEMENTER lease may exist for a canonical unit lineage. VERIFIER must be a distinct run identity and must not hold an IMPLEMENTER lease for the same candidate.

A lease contains:

- `lease_id`
- `unit_id`
- `role`
- `holder`
- `scope`
- `candidate_sha` when applicable
- `issued_at`
- `expires_at`
- `heartbeat_at`
- `status`

Expired leases may be reclaimed by the controller. Reclaiming a lease does not authorize changing the canonical candidate SHA; any replacement candidate must be an explicit supersession.

## Immutable handoff

Every agent run returns a machine-readable append-only handoff containing:

- run identity and role
- input unit state
- observed base/candidate SHA
- result classification
- findings
- output artifacts
- requested next action, if any
- timestamps

The `requested_next_action` is advisory. The controller alone decides the next canonical state.

## Result classifications

Canonical run result values:

- `PASS`
- `FAIL`
- `BLOCKED_ENVIRONMENT`
- `BLOCKED_DESIGN`
- `BLOCKED_DEPENDENCY`
- `DENIED_GOVERNANCE`
- `CANCELLED`

## Retry semantics

Retries must be idempotent with respect to canonical state.

- Re-running a verifier against the same exact SHA must not create a new candidate.
- Re-running proof execution must produce distinct run identities but remain bound to the same proof contract and candidate SHA.
- A stale result for a superseded candidate may be stored but must never advance the active lineage.
- Duplicate delivery of the same handoff must not advance state twice.

## Concurrency invariants

The controller must reject:

- two simultaneous IMPLEMENTER leases for the same active unit lineage
- verifier result bound to a different candidate SHA than the canonical candidate
- promotion attempt after candidate supersession
- gate result for a stale proof contract
- transition from a state other than one explicitly allowed by the transition table

## Human intervention boundary

The operator should only be required for:

- policy/authority decisions not encoded in the current contract
- protected environment approvals where the platform requires a human reviewer
- live trust-policy/ruleset cutovers
- unresolved design conflicts

Normal implementation, verification routing, RED/GREEN dispatch, gate execution, retry handling, and post-result routing should be controller-owned.

## V1 completion criterion

V1 is complete only when one real unit can traverse, without manual message passing:

`PLANNED -> IMPLEMENTING -> IMPLEMENTATION_READY -> VERIFYING -> READY_FOR_DEV_GOV -> PROVING_RED -> PROVING_GREEN -> GATING -> GATE_PASSED -> PROMOTING -> PROMOTED -> CLOSED`

with an append-only audit trail proving every transition and exact SHA binding.
