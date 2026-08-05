# ADR-29: Runtime Contract Freeze & ExecutionKernel

Status: Accepted  
Date: 2026-08-05

## Context

MPS Frozen Core had dual manifest models, stub hashes, and LU invoking `LURuleEngine` outside admission. Before further implementation, execution identities and the central motor surface must be frozen.

## Decision

1. **Runtime Contract Freeze (v1.0.0)** locks:
   - ExecutionAttempt / ExecutionOutcome / ExecutionManifest identities
   - AdmissionResult
   - CapabilityExecutionArtifact
   - WorkflowExecutionArtifact (`execution_refs`, `execution_order`, `workflow_hash`, `workflow_definition_hash`)
   - ReplayArtifact
   - ExecutionTicket
   - RuntimeState fields

2. **ExecutionKernel** is the only client-facing motor API. Domain packages (LU, future tillsyn/dispens) are clients. Frozen Core SHALL NOT import domain packages.

3. **Admit before execute.** CapabilityExecutor SHALL NOT know RuleEngines; it uses ImplementationResolver → invoke().

4. **ReplayEngine** reads CAS via ArtifactRepository; Replay is not part of CAS.

5. **Evolution SHALL execute admitted manifests only** (`Manifest → Admission → Evolution`).

## Consequences

- Identity-breaking changes require a new freeze major and golden test update.
- `PipelineRuntime` stage pipeline remains a post-outcome lifecycle detail, not the primary client API.
- Feature flag `LU_MPS_MOTOR=1` enables LU strangler onto ExecutionKernel.

## References

- [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md)
- Package24 ADRs 24-25 / 24-26
- LU Architecture Charter (ADR-27)
