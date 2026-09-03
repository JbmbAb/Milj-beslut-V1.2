# ADR-MPS-HARVEST-GOVERNED-INGESTION-ORCHESTRATOR: Harvest Orchestration & Import Gate Boundary

| Field | Value |
| --- | --- |
| **Status** | **ACTIVE** — documents current code; not a "Frozen constitution" claim |
| **Date** | 2026-08-30 |
| **Owner** | `mps-data-governance` |
| **Purpose** | Close the documentation gap identified in the 2026-08-30 document-authority audit: `HarvestOrchestrator` had real, load-bearing, partially-tested code but no governing ADR |

**Provenance note:** This document is written from current source only —
`HarvestOrchestrator.ts`, `HarvestExecutionStateMachine.ts`, `HarvestOrchestratorTypes.ts`,
`HarvestOrchestratorContracts.ts`, `ImportGate.ts`, `DatasetApprovalArtifact.ts`, and
`architecture-authority-map.jsonc`, as they exist on this date. It deliberately does
**not** reuse the state names or shape from the historical, never-committed
`ADR-24-17` design draft (see `ADR-24-20-Constitution.md` §"Relationship to Existing
ADRs" for that draft's disposition) — current state names differ materially and any
resemblance in intent is coincidental, not lineage.

---

## 1. Architectural role

`HarvestOrchestrator` is a **stateful coordinator**, not an authority. It sequences
a harvested dataset through acquisition, verification, human governance review,
compliance checking, an import decision gate, spatial projection, and LU
initialization — persisting a checkpoint at every legal transition so a run can be
resumed or observed without being re-executed.

It owns **sequencing**. It does not own **truth**. Truth about whether a dataset may
enter canonical storage is decided by `ImportGate`, which itself only evaluates
evidence already produced by other components — the orchestrator never overrides,
retries around, or bypasses that decision.

## 2. State-machine responsibility

State is owned by `HarvestExecutionStateMachine`, a pure, side-effect-free class
(`HarvestExecutionStateMachine.ts`) with no IO and no artifact logic. Its 15
declared states are exactly:

```
CREATED, HARVESTING, HARVESTED, VERIFYING, QUARANTINED,
VERIFIED, AWAITING_APPROVAL, APPROVED, ARCHIVED,
COMPLIANCE_CHECK, BLOCKED, IMPORT_GATE, ALLOW_IMPORT,
POSTGIS_PROJECTION, READY_FOR_LU
```

Terminal states (from which no further transition is legal):
`QUARANTINED`, `ARCHIVED`, `BLOCKED`, `READY_FOR_LU`.

### Legal transitions (as coded, not as designed historically)

```
CREATED            → HARVESTING
HARVESTING         → HARVESTED
HARVESTED          → VERIFYING
VERIFYING          → VERIFIED | QUARANTINED
VERIFIED           → AWAITING_APPROVAL
AWAITING_APPROVAL  → APPROVED | ARCHIVED
APPROVED           → COMPLIANCE_CHECK
COMPLIANCE_CHECK   → BLOCKED | IMPORT_GATE
IMPORT_GATE        → ALLOW_IMPORT | BLOCKED
ALLOW_IMPORT       → POSTGIS_PROJECTION
POSTGIS_PROJECTION → READY_FOR_LU
```

`ARCHIVED` is a declared legal target of `AWAITING_APPROVAL` in the state machine,
but no method on `HarvestOrchestrator` itself writes it — nothing in the current
orchestrator produces an `ARCHIVED` transition. If something reaches this state, it
does so through a caller/component outside this file. This ADR does not claim
otherwise.

Every `saveCheckpoint()` call validates the transition via
`HarvestExecutionStateMachine.assertTransition()` before persisting. An illegal
transition does not merely throw — it quarantines the run first (`quarantine()`,
tagged `ORCH-007` in source), because raising the error alone would leave a
checkpoint claiming a state the run is not actually in, and the next invocation
would resume from that lie. The quarantine write deliberately bypasses the state
machine (the transition it is making is the very one that was just rejected) and
preserves prior lineage rather than discarding it.

## 3. Approval boundary (human governance)

The orchestrator stops, unconditionally, at `AWAITING_APPROVAL`. It does not poll,
block, or wait in-process for a human decision — `execute()` returns immediately
with `state: "AWAITING_APPROVAL"` and the evidence gathered so far
(`manifest_ref`, `verification_ref`). The `GovernanceReviewAwaiter` contract exists
in `HarvestOrchestratorContracts.ts` (a `pollApproval` method) but is **not** wired
into `HarvestOrchestrator`'s constructor — the orchestrator has no dependency on it.

Resumption is a separate, explicit call: `resumeWithApproval(execution_id,
approval_ref)`. It refuses to run from any state other than `AWAITING_APPROVAL`,
and it writes the `approval_ref` into the checkpoint as an opaque
`ArtifactReference` — the orchestrator never inspects, constructs, or validates the
`DatasetApprovalArtifact` itself. That validation is `ImportGate`'s job (§4).

## 4. ImportGate boundary

`ImportGate.evaluate()` is the actual decision authority for whether harvested
content may proceed toward canonical storage. Its checks, in order, per current
source:

1. **Approval presence** — no `approval_artifact` → `BLOCK_IMPORT` /
   `IMPORT_GATE_MISSING_APPROVAL`.
2. **Reference match** — `approval_artifact.approved_ref` must match the
   `manifest_ref` under evaluation (`assertContentReferenceMatches`) → otherwise
   `IMPORT_GATE_APPROVAL_MANIFEST_MISMATCH`. This prevents an approval minted for
   one dataset being replayed against a different one.
3. **Compliance** — any failed compliance control → `BLOCK_IMPORT` with the
   specific failing control IDs.
4. **Decision** — `approval_artifact.decision !== "APPROVED"` →
   `IMPORT_GATE_DECISION_REJECTED`.
5. **Actor role** — `approval_artifact.actor_ref?.role !== "GOVERNANCE_REVIEWER"` →
   `IMPORT_GATE_UNAUTHORIZED_APPROVER_ROLE`. This is checked defensively
   (optional chaining, not a throw), because an approval artifact may originate
   from an untyped store read and a missing role must be treated as *absent
   authorization*, never as "assume it's fine."

Only if all five hold does `evaluate()` return `ALLOW_IMPORT`. Every outcome —
allow or block — is written as a signed `ImportGateEvidenceArtifact` via
`createSignedArtifactIdentity`, so a `BLOCK_IMPORT` is exactly as auditable as an
`ALLOW_IMPORT`.

`DatasetApprovalArtifact` itself (`DatasetApprovalArtifact.ts`) is documented in
source as implementing **Mimers Brunn v2.0.1 §7** — it is `CanonicalArtifact`-typed,
immutable, and carries `approved_ref`, `decision`, `actor_ref`, `decision_at`,
`reason`. Its shape is governed by Mimers Brunn v2.0.1, not by this ADR; this ADR
only documents how `ImportGate` consumes it.

**Known historical defect, now fixed (informational, not a current gap):** source
comments in `ImportGate.ts` record that the canonical serializer was previously
constructed inline as `JSON.stringify(obj, Object.keys(obj).sort())`, which does
not sort keys — the second `JSON.stringify` argument is a replacer allowlist, so
every nested object collapsed to its top-level keys and two different manifests
could produce the same signed hash. The serializer is now injected from the shared
canonicalization boundary rather than constructed locally.

## 5. Quarantine vs. canonical CAS authority

**This is the most important boundary in this document.** Per
`architecture-authority-map.jsonc` as of this ADR's date:

| Entry | `module_role` | `proof_status` | File |
| --- | --- | --- | --- |
| `mps-data-governance-import-gate` | **`ISOLATED_GATE_NOT_LIVE_ROUTE`** | `PROVEN` | `packages/mps-data-governance/src/ImportGate.ts` |
| `quarantine-promotion-live` | `CANONICAL_AUTHORITY` | `PROVEN` | `packages/mimers-brunn-core/src/governance/DatasetApproval.ts` |

`ImportGate` (this orchestrator's gate) is tested and proven **as an isolated
component**. It is explicitly registered as **not the live route** into canonical
storage. The actual, live, `CANONICAL_AUTHORITY`-classified quarantine-to-CAS
promotion path is a **different file in a different package**
(`mimers-brunn-core/src/governance/DatasetApproval.ts`), governed by its own
authority-map entry and its own test suite
(`quarantinePromotionAttestation.test.ts`, `approval.test.ts`, `tv-l1-e2e.test.ts`,
`governanceRoutes.test.ts`).

This ADR does not claim `HarvestOrchestrator` or `ImportGate` are the platform's
live promotion authority. They are a tested, isolated decision gate that a caller
may wire into a live route — as of this ADR's date, the authority map records that
no such wiring has been proven.

## 6. Runtime checkpoint non-authority

`HarvestExecutionCheckpoint` (`HarvestOrchestratorTypes.ts`) is explicitly typed and
commented as **not a canonical artifact**: no `content_hash`, `artifact_id`, or
signature field. Its `updated_at` timestamp is commented "SHALL NOT participate in
hashing, signing, artifact identity, or replay equality." The checkpoint exists
solely so `execute()` can resume a run without re-running already-completed stages;
it carries no governance weight of its own. Everything the checkpoint stores
(`manifest_ref`, `verification_ref`, `approval_ref`, `gate_evidence_ref`,
`projection_ref`, `lu_ref`) is a reference to an artifact minted elsewhere — the
checkpoint never mints identity.

## 7. Terminal / proof semantics

- `QUARANTINED` and `BLOCKED` are failure-terminal: verification failure or
  compliance/import-gate rejection, respectively.
- `READY_FOR_LU` is success-terminal: an `LU Execution Artifact` (`lu_ref`) has been
  produced from a `PostGIS projection` (`projection_ref`).
- Calling `execute()` again against any terminal state returns that state's result
  from the stored checkpoint and does not re-invoke any executor —
  `HarvestExecutionStateMachine.isTerminal()` is checked before the state `switch`.

**Proof status of this orchestrator, as of this ADR:** `HarvestOrchestrator.ts`
itself has **no entry** in `architecture-authority-map.jsonc` — it is not
registered as `PROVEN`, `UNPROVEN`, or `KNOWN_BROKEN`. Test files exist on disk
(`HarvestOrchestrator.test.ts`, `HarvestOrchestratorIntegrationFailure.test.ts`,
`HarvestOrchestratorReplayArtifact.test.ts`, `Orch007QuarantinePersistence.test.ts`,
`ExecutionManifestBuilder.test.ts`) but their execution is not currently tracked by
a registry entry the way `ImportGate.ts` is. Per this repository's own proof rule
("PROVEN is a RESULT, not a document label" — `architecture-authority-map.jsonc`),
this ADR does **not** claim `HarvestOrchestrator` is `PROVEN`. It documents what
the code does; proof status is a separate, registry-tracked claim this document
does not make on the orchestrator's behalf.

## 8. Replay expectations

The orchestrator's own replay guarantee is narrow and explicit: **re-invoking
`execute()` against a stored checkpoint does not re-run completed stages** — it
resumes from the checkpoint's `state` and returns immediately for terminal states.
This is operational resume, not the platform's cryptographic replay guarantee
(`ExecutionManifest` / `ReplayEngine` under `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`
§1, Package 21). This orchestrator does not itself implement or claim that
constitutional replay-determinism invariant — it only guarantees idempotent
resumption of its own state machine.

## 9. What `HarvestOrchestrator` explicitly SHALL NOT own

- **SHALL NOT** decide import authorization — that is `ImportGate`'s decision
  alone (§4).
- **SHALL NOT** construct, validate, or interpret `DatasetApprovalArtifact` content
  — it passes `approval_ref` through opaquely.
- **SHALL NOT** write to canonical CAS storage directly — canonical promotion is
  `mimers-brunn-core/src/governance/DatasetApproval.ts`'s authority, not this
  package's (§5).
- **SHALL NOT** treat `HarvestExecutionCheckpoint` as an artifact, evidence, or
  identity source (§6).
- **SHALL NOT** poll or block for human approval in-process — approval is an
  external, asynchronous event delivered via `resumeWithApproval()` (§3).
- **SHALL NOT** claim platform-level replay determinism (§8) — that invariant
  belongs to Package 21 / `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`.
- **SHALL NOT** be read as an implementation of the historical, never-committed
  `ADR-24-17` draft — see the provenance note above.

## 10. Relationship to other authorities

- **Architectural constitution:** `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` (identity,
  hashing, lineage — this ADR does not redefine any of those).
- **Data governance policy:** `mimers-brunn-v2.0.1.md` (governs
  `DatasetApprovalArtifact`'s shape, §7).
- **Live canonical promotion authority:** `mimers-brunn-core/src/governance/DatasetApproval.ts`
  (§5) — not this package.
- **Operational proof registry:** `architecture-authority-map.jsonc` (§5, §7) — the
  source of truth for whether any of the above is actually `PROVEN`, not this
  document's prose.

This ADR does not supersede, weaken, or duplicate any of the above; it exists only
because `HarvestOrchestrator` had no governing document at all before this date.
