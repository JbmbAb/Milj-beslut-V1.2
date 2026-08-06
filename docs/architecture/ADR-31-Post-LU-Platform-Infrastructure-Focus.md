# ADR-31: Post-LU Focus — Epoch II Execution Platform

Status: Accepted  
Date: 2026-08-06  
Revised: 2026-08-06 (domain-agnostic principle, Mimers-before-capability, security, III/IV splits)  
Depends on: [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md)  
Roadmap: [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md) (**planning-frozen**)

## Context

ADR-30 froze **LU Runtime v1** as the reference Assessment Capability on ExecutionKernel.  
Epoch II builds the full **Execution Platform** (not merely the kernel component).

## Decision

### Overarching principle (normative for Epochs II–IV)

```
Execution Platform SHALL remain domain-agnostic.

All domain functionality SHALL be implemented as
capabilities, workflows, rules and projections.

The Execution Platform SHALL NOT contain domain-specific logic.
```

### Naming

| Prefer | Avoid |
|--------|--------|
| **Epoch II — Execution Platform** | “Platform Kernel” as epoch name |
| `ExecutionKernel` as component | Equating kernel with the whole platform |
| LU as **reference Assessment Capability** | “LU is just the first assessment” without capability framing |

### Epoch boundary

| Epoch | Name | Status |
|-------|------|--------|
| **I** | Frozen Core + LU Runtime | **Closed** |
| **II** | **Execution Platform** v1 | **Qualified (Fas 9)** · Architecture Freeze in effect |
| **III** | Knowledge Platform (IIIA→IIID) | **Ready** — Knowledge Foundation first; remote tag push deferred |
| **IV** | Ecosystem Platform | **Long-term** |

LU is a **client** / reference Assessment Capability — not the product. Platform stack: Frozen Core → Execution Platform → Assessment Platform → Knowledge Platform.

### Epoch II tracks (build order)

```
Infrastructure → Contracts & Model → Registry → Mimers
  → Capability → Workflow → Projection → Observability → Security
```

| # | Track |
|---|--------|
| 2.1 | Execution Infrastructure |
| 2.2 | Execution Contracts & Model (identities + Execution/Admission/Retry policies) |
| 2.3 | Registry Runtime |
| 2.4 | Mimers Integration (real ArtifactRepository before capability/workflow) |
| 2.5 | Capability Runtime |
| 2.6 | Workflow Runtime |
| 2.7 | Projection Layer |
| 2.8 | Runtime Observability |
| 2.9 | Execution Platform Security (`Identity → Admission → Authorization → Invoke → Signing`) |

### Critical invariants

| Area | Invariant |
|------|-----------|
| Projection | SHALL NEVER become a source of truth; SHALL be reproducible from immutable artifacts |
| Evolution | SHALL NEVER execute against production state (`Replay → Candidate → Evaluation → Admission → Promotion`) |
| Adaptive | MAY optimize retrieval/cache/ordering/ranking; SHALL NOT modify Frozen Core, Registry Releases, Capability/Rule definitions, or Artifact Identity |
| Platform | SHALL NOT contain domain-specific logic |

### Epoch III / IV (summary)

- **IIIA** Knowledge Foundation (+ **Knowledge Index** between Graph and Search)  
- **IIIB** Assessment Platform (LU = reference Assessment Capability)  
- **IIIC** Evolution · **IIID** Adaptive (distinct)  
- **IV** Ecosystem (APIs, plugins, partners)  

Full text: [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md).

## Consequences

- Planning starts at **2.1**, then **2.2 Contracts & Model**, **2.3 Registry**, **2.4 Mimers** before Capability/Workflow.  
- Roadmap document is planning-frozen; changes require ADR revision.  

## References

- [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)
- [ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md)
- [ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md)
- [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md)
