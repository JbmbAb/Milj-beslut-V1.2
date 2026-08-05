# MPS Execution Motor — Implementation Plan

Full roadmap (planning-frozen): **[MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)**.

Governing ADRs:

- [ADR-29](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md) — Execution Contracts & Model freeze  
- [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) — LU reference Assessment Capability  
- [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md) — Epoch II Execution Platform  

## Principle

Execution Platform SHALL remain domain-agnostic. Domain logic = capabilities, workflows, rules, projections only.

## Epoch status

| Epoch | Goal | Status |
|-------|------|--------|
| I | Frozen + LU reference Assessment Capability | ✅ Closed |
| II | **Execution Platform** v1 | 🟡 Active |
| III | IIIA→IIID Knowledge Platform | 🔵 Later |
| IV | Ecosystem Platform | ⚪ Long-term |

## Epoch II build order

| # | Track | Status |
|---|--------|--------|
| 2.1 | Execution Infrastructure | ✅ Done — `ExecutionInfrastructure` facade |
| 2.2 | Execution Contracts & Model | ✅ Done — `mps-runtime/contracts/model` |
| 2.3 | Registry Runtime | ✅ Done — `mps-runtime/registry` |
| 2.4 | Mimers Integration | ✅ Done — `mps-runtime/mimers` |
| 2.5 | Capability Runtime | ✅ Done — `mps-runtime/capability` |
| 2.6 | Workflow Runtime | ✅ Done — `mps-runtime/workflow` |
| 2.7 | Projection Layer | ✅ Done — `mps-runtime/projection` |
| 2.8 | Runtime Observability | Next |
| 2.9 | Execution Platform Security | Pending |

**Next:** 2.8 Runtime Observability — replay logs / graph / lineage as side channel; never mutates artifact identity.

## Key invariants (quick ref)

- Projection ≠ source of truth; reproducible from immutable artifacts  
- Evolution never against production state  
- Adaptive SHALL NOT modify Frozen Core / registry releases / capability or rule definitions / artifact identity  
- Kernel → ArtifactRepository → Resolver → CAS only  

## Reference client

- `packages/mps-lu` — reference Assessment Capability  
- Guard: `src/application/unit/LuCutoverSinglePath.test.ts`  
