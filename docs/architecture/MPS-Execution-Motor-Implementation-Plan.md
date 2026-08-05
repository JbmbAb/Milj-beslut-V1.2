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

| # | Track |
|---|--------|
| 2.1 | Execution Infrastructure |
| 2.2 | Execution Contracts & Model |
| 2.3 | Registry Runtime |
| 2.4 | Mimers Integration |
| 2.5 | Capability Runtime |
| 2.6 | Workflow Runtime |
| 2.7 | Projection Layer |
| 2.8 | Runtime Observability |
| 2.9 | Execution Platform Security |

**Start:** 2.1 — crash-resume without information loss.

## Key invariants (quick ref)

- Projection ≠ source of truth; reproducible from immutable artifacts  
- Evolution never against production state  
- Adaptive SHALL NOT modify Frozen Core / registry releases / capability or rule definitions / artifact identity  
- Kernel → ArtifactRepository → Resolver → CAS only  

## Reference client

- `packages/mps-lu` — reference Assessment Capability  
- Guard: `src/application/unit/LuCutoverSinglePath.test.ts`  
