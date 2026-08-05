# ADR-31: Post-LU Focus — Epoch II Execution Platform

Status: Accepted  
Date: 2026-08-06  
Revised: 2026-08-06 (naming + build order + Epoch III/IV split)  
Depends on: [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md)  
Roadmap: [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)

## Context

ADR-30 froze **LU Runtime v1** as the first production domain on ExecutionKernel.  
LU is the **reference client**, not a special-case motor.

Calling Epoch II “Platform Kernel” understates scope: the epoch builds Queue, Registry, Capability Runtime, Workflow, Projection, Observability, and the Execution Model — with `ExecutionKernel` as *one* component.

## Decision

### Naming

| Prefer | Avoid |
|--------|--------|
| **Epoch II — Execution Platform** | “Platform Kernel” as epoch name |
| `ExecutionKernel` as component | Equating kernel with the whole platform |

### Epoch boundary

| Epoch | Name | Status |
|-------|------|--------|
| **I** | Frozen Core + LU Runtime | **Closed** (ADR-30) |
| **II** | **Execution Platform** v1 | **Active** |
| **III** | Knowledge Platform (IIIA→IIID) | **Deferred** until II is done |
| **IV** | Ecosystem Platform | **Long-term** |

### Epoch II — Execution Platform v1

**Goal:** a general execution platform for any miljöprocess. Not LU work.

| # | Track |
|---|--------|
| 2.1 | Execution Infrastructure (Queue, Lease, Retry, Idempotency, Crash Recovery, Replay Scheduler) |
| 2.2 | Execution Model (Manifest, Attempt, Outcome, Session, ReplayIdentity, TicketIdentity) |
| 2.3 | Registry Runtime (Capability / Workflow / Rule / Provider / Release) |
| 2.4 | Capability Runtime (no domain code in runtime) |
| 2.5 | Workflow Runtime (multi-step graph + workflow replay) |
| 2.6 | Mimers Integration (ArtifactRepository → Resolver → CAS only) |
| 2.7 | Projection Layer (`Execution → Artifacts → Projection → UI`) |
| 2.8 | Runtime Observability (non-mutating) |

### Normative build order

```
Infrastructure → Execution Model → Registry → Capability → Workflow → Mimers → Projection → Observability
```

**Why Registry before Workflow:** workflows cannot be general while hard-coded bindings remain; registry must be the sole truth first.

**II result invariant:** executions resume after crash without information loss; any miljöprocess can run on the same platform.

### Epoch III split (normative)

| Sub-epoch | Name | Focus |
|-----------|------|--------|
| **IIIA** | Knowledge Foundation | Harvester, spatial/docs intelligence, evidence, knowledge graph |
| **IIIB** | Assessment Platform | LU + avlopp + C-anmälan + … as assessments on the same motor |
| **IIIC** | Evolution | Candidates via Replay → Admission → Promotion (needs **real** execution volume) |
| **IIID** | Adaptive Platform | Self-optimization under drift — **not** the same as Evolution |

| Evolution (IIIC) | Adaptive (IIID) |
|------------------|-----------------|
| Create better candidates | Choose better runtime strategies |
| Offline evaluate → promote | Retrieval / workflow / cache / search tuning |

### Epoch IV — Ecosystem Platform

External integrations, APIs, plugin/capability ecosystem, partners, additional clients — only after I–III keep motor + knowledge focused.

### Discipline rules

1. **Do not reopen LU Runtime v1** without a new freeze major (ADR-30).  
2. **LU stays the reference client.**  
3. **Prefer Execution Platform ADRs** over LU-only motor forks.  
4. **No domain code in runtime** — register via Registry.  
5. **Kernel never talks PostGIS/files directly.**  
6. **UI goes through Projection** — not Execution → UI.  
7. **Evolution ≠ Adaptive** — keep IIIC and IIID separate.  
8. **Neither may mutate Frozen Core.**  

### Development strategy

| Before | After |
|--------|--------|
| “How do we make LU work?” | “How do all domains use the same Execution Platform?” |

## Consequences

- Planning starts at **2.1 Execution Infrastructure**, then **2.2 Execution Model**, then **2.3 Registry**.  
- Full breakdown: [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md).  

## References

- [ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md)
- [ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md)
- [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)
- [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md)
