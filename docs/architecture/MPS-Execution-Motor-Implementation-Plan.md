# MPS Execution Motor — Implementation Plan

Canonical plan for **ExecutionKernel** as the production execution motor.

See also:

- [ADR-29](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md) — identity freeze  
- [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) — LU Runtime v1 / Kernel v1.0  
- [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md) — **Epoch II: shared infrastructure focus**

## Epoch status

| Epoch | Scope | Status |
|-------|--------|--------|
| I — Execution model | Frozen Core, LU cutover, ADR-30 freeze | **Closed** |
| II — Shared runtime | Queue, Workflow, Registry, Kernel generalization | **Active** |
| III — Evolution | Metrics → Fitness → Candidates → Replay → Promotion | **Deferred** |

## Locked approach

- **ExecutionKernel** is the client API (LU is the reference client; other domains follow).
- Package24 / ADR-29 identities frozen at **v1.0.0**.
- Order: ArtifactStore → **Admission** → Hash → CapabilityExecutor.
- CapabilityExecutor SHALL NOT know RuleEngine (ImplementationResolver → invoke).
- ReplayEngine reads CAS via ArtifactRepository; Replay is not part of CAS.
- Queue uses **ExecutionTicket**.
- Evolution: Manifest → Admission → Evolution only — product loop **off** until real history exists.
- **Do not reopen LU Runtime v1** for motor churn (ADR-30 / ADR-31).

## Epoch I — Done

| Phase | Deliverable | Status |
|-------|-------------|--------|
| −1…6 | Contract freeze → LU strangler → tickets → CAS → cutover | Done |
| 7 LU Cutover | Single path Report → Kernel → Artifacts → UI | Done (`dff5efa`) |
| 8 LU Runtime v1 Freeze | ADR-30 — Execution Kernel v1.0 | Done (`48bb5f5`) |

## Epoch II — Active priority

| Priority | Deliverable | Scope |
|----------|-------------|--------|
| 1 | **ExecutionQueue v1** | Leases, retry, recovery, deterministic tickets |
| 2 | **WorkflowEngine v1** | Multi-capability graph, deterministic order, workflow replay |
| 3 | **Capability Registry v1** | Versioned definitions, release-bound snapshots, runtime resolution |
| 4 | **ExecutionKernel generalization** | LU = client only; avlopp / C-anmälan / … same core |
| 5 | **Evolution** (Epoch III) | Only after real admitted + replayable artifacts |

## Feature flags

| Flag | Effect |
|------|--------|
| `LU_MPS_CAS=memory` | In-memory CAS (tests / explicit) |
| `MIMERS_ROOT` | Mimers CAS root (default fallback `.data/mimers`) |
| `MIMERS_REQUIRED=1` | Fail closed if Mimers cannot initialize |
| `LU_MPS_TICKETS=prisma` | Prisma ticket queue (default) |
| `LU_MPS_TICKETS=file` | File JSON queue fallback |
| `LU_DOC_PROVIDER=mock` | Opt-in MockDocumentProvider |
| `VITE_ENABLE_LEGACY_UI=1` | UI rollback to TechnicalDashboardHub only |

Removed: `LU_MPS_MOTOR` opt-out (cutover complete).

## Reference client (frozen)

- Kernel: `packages/mps-runtime/src/kernel/ExecutionKernel.ts`
- LU client: `packages/mps-lu/src/execution/LuExecutionKernelClient.ts`
- Freeze marks: `packages/mps-lu/src/runtime/LuRuntimeFreeze.ts`
- Report: `src/application/generate-localization-report.usecase.ts` → `runLuAssessmentViaKernel` only
- CAS: `createKernelArtifactRepository` → Mimers
- Tickets (baseline): `PrismaExecutionTicketQueue` + file fallback
- Guard: `src/application/unit/LuCutoverSinglePath.test.ts`

## Evolution gate (Epoch III)

Do **not** wire product evolution until:

1. Production runs routinely through ExecutionKernel.  
2. Artifacts land in Mimers CAS and are replay-verifiable.  
3. ExecutionQueue shows stable admit → complete under restart / lease recovery.  

Until then, keep `AdmittedOnlyEvolutionExecutor` out of the product path.
