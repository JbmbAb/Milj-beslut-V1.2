# MPS Execution Motor — Implementation Plan

See the full multi-epoch plan: **[MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)**.

Governing ADRs:

- [ADR-29](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md) — identity freeze  
- [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) — LU Runtime v1 / Kernel v1.0  
- [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md) — Epoch II Platform Kernel focus  

## Epoch status

| Epoch | Goal | Status |
|-------|------|--------|
| I — Frozen + LU | Single spine; LU = reference client | ✅ Closed |
| II — Platform Kernel | **Execution Platform v1** (universal motor) | 🟡 Active |
| III — Knowledge Platform | Mimers expansion, assessments library, evolution | 🔵 Later |

## Epoch II — Active workstreams

| # | Track | First concrete target |
|---|--------|------------------------|
| 2.1 | Execution Infrastructure | ExecutionQueue + LeaseManager + Retry + Idempotency + Crash Recovery + Replay Scheduler |
| 2.2 | Workflow Runtime | Deterministic multi-step WorkflowEngine + workflow replay |
| 2.3 | Capability Runtime | Domain-agnostic invoke path (no domain imports in runtime) |
| 2.4 | Registry Runtime | Capability / Workflow / Rule / Provider / Release as truth |
| 2.5 | Mimers Integration | Kernel → ArtifactRepository → Resolver → CAS only |
| 2.6 | Observability | Graph / lineage / replay logs / tracing (non-mutating) |

**Start here:** 2.1 — result: executions resume after crash without information loss.

## Locked invariants (all epochs)

- ExecutionKernel is the only client-facing motor API.  
- Admit before execute; CapabilityExecutor does not know RuleEngines.  
- Replay reads CAS via ArtifactRepository.  
- Mimers CAS is the sole artifact store for kernel writes.  
- Evolution: admitted + replayable only; never direct production mutation; never self-edit Frozen Core.  
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
