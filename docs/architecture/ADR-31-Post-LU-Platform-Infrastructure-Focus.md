# ADR-31: Post-LU Platform Focus — Epoch II Platform Kernel

Status: Accepted  
Date: 2026-08-06  
Depends on: [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md)  
Roadmap: [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)

## Context

ADR-30 froze **LU Runtime v1** as the first production domain on ExecutionKernel.  
LU is no longer a special case to finish — it is the **reference client** of the normative spine:

```
UI → ExecutionKernel → Admission → Capability → Mimers CAS → Replay → Presentation
```

Continuing to “improve” the LU motor after freeze is a classic mistake. Scarce effort moves from LU features to **shared platform** so every future miljöprocess reuses the same core.

## Decision

### Epoch boundary

| Epoch | Name | Status |
|-------|------|--------|
| **I** | Frozen Core + LU Runtime | **Closed** (ADR-30) |
| **II** | **Platform Kernel** — Execution Platform v1 | **Active** |
| **III** | Knowledge Platform (Mimers, assessments library, evolution) | **Deferred** until II is done |

### Epoch II definition — Execution Platform v1

**Goal:** ExecutionKernel is the universal execution motor. Not LU work.

| Track | Deliverable |
|-------|-------------|
| **2.1 Execution Infrastructure** | ExecutionQueue, LeaseManager, RetryEngine, IdempotencyManager, Crash Recovery, Replay Scheduler |
| **2.2 Workflow Runtime** | Real WorkflowEngine: Workflow → Steps → Artifacts → Replay |
| **2.3 Capability Runtime** | Generic capabilities; no domain code in runtime |
| **2.4 Registry Runtime** | Capability / Workflow / Rule / Provider / Release registries as truth |
| **2.5 Mimers Integration** | Kernel only via ArtifactRepository → Resolver → CAS → Mimers |
| **2.6 Observability** | Replay logs, execution graph, lineage, deterministic tracing (non-mutating) |

**II result invariant:** An execution can resume after process crash without information loss; any miljöprocess can run on the same motor.

### Status snapshot

| Status | Area |
|--------|------|
| ✅ Done | Frozen Core through ADR-30; LU Runtime v1; Replay/Admission/CAS for LU |
| 🟡 Active | Epoch II Platform Kernel (start at 2.1 Execution Infrastructure) |
| 🔵 Later | Epoch III Knowledge Platform + Evolution + Self Optimization |

### Normative build order (Epoch II)

1. Execution Infrastructure (2.1)  
2. Workflow Runtime (2.2)  
3. Capability Runtime (2.3)  
4. Registry Runtime (2.4)  
5. Mimers Integration (2.5)  
6. Observability (2.6)  

### Discipline rules

1. **Do not reopen LU Runtime v1** without a new freeze major (ADR-30).  
2. **LU stays the reference client** — new domains copy the client pattern; they do not fork engines.  
3. **Prefer platform ADRs** — queue, workflow, registry, kernel ports.  
4. **No domain code in runtime** — domains register; kernel resolves.  
5. **Kernel never talks PostGIS/files directly** — only ArtifactRepository → CAS / Mimers.  
6. **Evolution / self-optimization stay in Epoch III** — admitted + replayable history only; never mutate Frozen Core.  

### Development strategy

| Before | After |
|--------|--------|
| “How do we make LU work?” | “How do all domains use the same motor?” |

Epoch II builds the **technical platform**.  
Epoch III builds **knowledge and intelligence** on that platform. Do not mix them.

## Consequences

- Sprint planning leads with **2.1 Execution Infrastructure**.  
- LU product work stays at client / UI / evidence providers.  
- Future assessments (C-anmälan, kontrollplan, …) are new rules + workflows — not new motors.  
- Full breakdown: [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md).  

## References

- [ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md)
- [ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md)
- [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)
- [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md)
- Packages (baseline): `mps-control-plane`, `mps-workflow`, `mps-capability`, `mps-capability-registry`, `mimers-brunn-core`
