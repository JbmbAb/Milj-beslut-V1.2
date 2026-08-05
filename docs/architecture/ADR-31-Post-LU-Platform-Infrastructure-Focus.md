# ADR-31: Post-LU Platform Focus — Shared Runtime Infrastructure

Status: Accepted  
Date: 2026-08-06  
Depends on: [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md)

## Context

ADR-30 froze **LU Runtime v1** as the first production domain on ExecutionKernel.  
LU is no longer a special case to finish — it is the **reference implementation** of the normative spine:

```
UI → ExecutionKernel → Admission → Capability → Mimers CAS → Replay → Presentation
```

Continuing to “improve” the LU motor after freeze is a classic mistake. The scarce resource should move from *domain features on LU* to *shared platform* so avlopp, C-anmälan, kontrollplan, and future modules reuse the same core.

## Decision

### Epoch boundary

| Epoch | Scope | Status |
|-------|--------|--------|
| **I — Execution model** | Frozen Core, identities (ADR-29), LU cutover + runtime freeze (ADR-30) | **Closed** |
| **II — Shared runtime** | ExecutionQueue, WorkflowEngine, Capability Registry, Kernel generalization | **Active** |
| **III — Evolution** | Metrics → Fitness → Candidates → Replay → Promotion | **Deferred** |

ADR-30 marks the end of Epoch I. New ADRs SHALL preferentially address Epoch II infrastructure, not LU-specific execution shortcuts.

### Status snapshot (normative reading)

| Status | Area | Assessment |
|--------|------|------------|
| ✅ Done | Frozen Core (through ADR-30) | Architecture defined and locked |
| ✅ Done | LU Runtime v1 | First domain on normative path |
| ✅ Done | Replay / Admission / CAS for LU | Production path for LU |
| 🟡 Next | ExecutionQueue | Shared durable runtime |
| 🟡 Next | WorkflowEngine | Required before multi-step domain migration |
| 🟡 Next | Capability Registry | Makes the motor truly general |
| 🔵 Later | Evolution | Build on real admitted, replayable history |

### Priority order (Epoch II)

1. **ExecutionQueue v1** — leases, retry, recovery, deterministic tickets  
2. **WorkflowEngine v1** — multiple capabilities in one execution graph; deterministic order; full-workflow replay  
3. **Capability Registry v1** — versioned capability definitions; release-bound snapshots; runtime resolution  
4. **ExecutionKernel generalization** — LU remains a *client*; other domains use the same core  
5. **Evolution** — only after sufficient real execution artifacts; admitted-only; replayable-only  

### Discipline rules

1. **Do not reopen LU Runtime v1** for motor experiments without a new freeze major (see ADR-30 change control).  
2. **LU stays the reference client** — new domains copy LU’s client pattern (`runXViaKernel`), they do not fork a second engine.  
3. **Prefer platform ADRs** — queue, workflow, registry, kernel ports — over LU-only ADRs.  
4. **Evolution remains gated** — no product loop until production history exists (ADR-29 / ADR-30).  

### Development strategy shift

| Before | After |
|--------|--------|
| “How do we make LU work?” | “How do all domains use the same motor?” |

## Consequences

- Roadmaps and sprint planning SHOULD lead with ExecutionQueue → Workflow → Registry → generalization.  
- LU feature work that does not require a freeze break stays at the *client / UI / evidence provider* layer, not inside ExecutionKernel.  
- Technical debt decreases as modules migrate onto one spine instead of accumulating parallel engines.  

## References

- [ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md)
- [ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md)
- [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md)
- Existing stubs: `packages/mps-control-plane` (tickets), `packages/mps-workflow`, `packages/mps-capability` / registry packages
