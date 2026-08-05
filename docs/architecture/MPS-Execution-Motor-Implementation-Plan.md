# MPS Execution Motor — Implementation Plan

Full roadmap: **[MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)**.

Governing ADRs:

- [ADR-29](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md) — identity / Execution Model freeze  
- [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) — LU Runtime v1 / Kernel v1.0  
- [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md) — Epoch II **Execution Platform** focus  

## Epoch status

| Epoch | Goal | Status |
|-------|------|--------|
| I — Frozen + LU | Single spine; LU = reference client | ✅ Closed |
| II — **Execution Platform** | Universal platform (not “kernel-only”) | 🟡 Active |
| III — Knowledge Platform | IIIA foundation → IIIB assessments → IIIC evolution → IIID adaptive | 🔵 Later |
| IV — Ecosystem Platform | APIs, plugins, partners, multi-client | ⚪ Long-term |

## Epoch II — Active workstreams (build order)

| # | Track | Notes |
|---|--------|--------|
| 2.1 | Execution Infrastructure | Queue, Lease, Retry, Idempotency, Crash Recovery, Replay Scheduler |
| 2.2 | Execution Model | Manifest, Attempt, Outcome, Session, ReplayIdentity, TicketIdentity |
| 2.3 | Registry Runtime | Sole truth before capability/workflow go general |
| 2.4 | Capability Runtime | No domain imports in runtime |
| 2.5 | Workflow Runtime | Multi-step + workflow replay (needs registry) |
| 2.6 | Mimers Integration | ArtifactRepository → Resolver → CAS only |
| 2.7 | Projection Layer | `Execution → Artifacts → Projection → UI` |
| 2.8 | Runtime Observability | Non-mutating graph / lineage / tracing |

**Start here:** 2.1 — resume after crash without information loss.

## Locked invariants

- Execution Platform ≠ ExecutionKernel alone.  
- Admit before execute; no domain RuleEngines inside runtime.  
- Registry is the sole implementation truth.  
- Replay reads CAS via ArtifactRepository.  
- UI via Projection — never Execution → UI.  
- Evolution (IIIC) ≠ Adaptive self-optimization (IIID).  
- Do not reopen LU Runtime v1 for motor churn.

## Reference client (frozen — Epoch I)

- `packages/mps-lu/src/execution/LuExecutionKernelClient.ts`  
- `packages/mps-lu/src/runtime/LuRuntimeFreeze.ts`  
- Guard: `src/application/unit/LuCutoverSinglePath.test.ts`  

## Feature flags (current)

| Flag | Effect |
|------|--------|
| `LU_MPS_CAS=memory` | In-memory CAS (tests) |
| `MIMERS_ROOT` / `MIMERS_REQUIRED=1` | Mimers CAS root / fail-closed |
| `LU_MPS_TICKETS=prisma\|file` | Ticket queue backend |
| `VITE_ENABLE_LEGACY_UI=1` | UI rollback only |
