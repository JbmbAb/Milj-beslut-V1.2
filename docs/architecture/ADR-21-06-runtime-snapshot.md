# ADR-21-06: Runtime Snapshot

## Status
Accepted (Paket 21 Prerequisites)

## Context
If a runtime executes a plan while continuously querying live databases, registries, or policies, the execution is tied to the exact millisecond it was run. It becomes impossible to deterministically replay the execution because the underlying live state may have drifted.

## Decision
All executions MUST happen against an immutable `RuntimeSnapshot`.

### Normative Rules

1. **A `RuntimeSnapshot` SHALL be constructed prior to execution, consisting of exactly:**
   - `PlanArtifact`
   - `ScheduleArtifact`
   - `RegistrySnapshot`
   - `PolicySnapshot`
   - `CapabilitySnapshot`
   - `ConfigurationSnapshot`
2. **Runtime SHALL execute only against the `RuntimeSnapshot`.**
3. **Runtime SHALL NOT query live registries, external mutable state, or unversioned configurations during execution.**

## Consequences
- Every execution is fully hermetic and replayable. Given the same `RuntimeSnapshot`, the exact same result is guaranteed to be produced at any point in the future.
- Eliminates TOCTOU (Time-of-check to time-of-use) bugs between planning and execution.
