# ADR-21-01: Retry Identity

## Status
Accepted (Paket 21 Prerequisites)

## Context
In order to enforce determinism and idempotency, the exact nature of an execution identity must be strictly separated from a plan identity. Previous iterations left ambiguity around whether retrying an execution creates a new plan or modifies existing references.

## Decision
Plan identity is strictly immutable. A retry of a plan SHALL NOT construct a new \PlanArtifact\.

### Normative Rules

1. **Retry SHALL NOT construct a new PlanArtifact.**
2. **Retry SHALL reuse the original PlanArtifact.**
3. **Retry SHALL construct a new ExecutionAttempt referencing the original PlanArtifact.**
4. **Plan identity SHALL remain immutable across retries.**
5. **ExecutionAttempt identity SHALL be unique per execution attempt.**

## Consequences
- Idempotency is preserved structurally.
- A single \PlanArtifact\ can have multiple ExecutionAttempt records, providing a clear audit log of all failures and retries.
