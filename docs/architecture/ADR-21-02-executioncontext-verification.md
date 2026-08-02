# ADR-21-02: ExecutionContext Verification

## Status
Accepted (Paket 21 Prerequisites)

## Context
There has been an open question regarding how to prevent execution against inconsistent state or mismatched artifacts. Without an explicit verification step at the time of context construction, a worker could begin an execution based on contradictory states, leading to unpredictable behavior.

## Decision
The `ExecutionContextFactory` is solely responsible for guaranteeing the consistency of the execution context before any execution starts.

### Normative Rules

1. **ExecutionContextFactory SHALL reject any execution whose referenced artifacts are not mutually consistent.**
2. **ExecutionContextFactory SHALL explicitly verify the cross-references and consistency across the following artifacts:**
   - `PlanArtifact`
   - `ScheduleArtifact`
   - `ControlArtifact`
   - `Registry Snapshot`
   - `Capability Snapshot`
   - `Policy Snapshot`

## Consequences
- A large class of runtime errors is prevented statically at the factory boundary.
- The runtime itself does not need to handle mismatched artifact errors; it can assume absolute consistency if a context was successfully constructed.
