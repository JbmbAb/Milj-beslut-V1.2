# MPS Execution Motor — Implementation Plan

Canonical plan for making **ExecutionKernel** the active, general execution motor.

See also: [ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md)

## Locked approach

- **ExecutionKernel** is the client API (LU / tillsyn / dispens are clients).
- Package24 identities frozen at **v1.0.0** before further shape changes.
- Order: ArtifactStore → **Admission** → Hash → CapabilityExecutor.
- CapabilityExecutor SHALL NOT know RuleEngine (ImplementationResolver → invoke).
- ReplayEngine reads CAS; is not part of CAS.
- Queue uses **ExecutionTicket**.
- Evolution: Manifest → Admission → Evolution only — **product loop stays off** until real runs + replayable artifacts exist.

## Phases

| Phase | Deliverable | Status in codebase |
|-------|-------------|-------------------|
| −1 Contract Freeze | Frozen identities + type-lock tests + ADR-29 | Done |
| 0 Kernel skeleton | `ExecutionKernel`, `RuntimeState`, LU client | Done |
| 1 Destub bottom | Admit hashes, ImplementationResolver, CasBackedArtifactRepository | Done |
| 2 LU MVP strangler | Motor path in localization usecase | Done |
| 3 Workflow | Workflow freeze fields + `LuSiteAssessmentRegistry` | Done |
| 4 Ticket queue | Prisma `ExecutionTicket` (+ file fallback) + AdmittedTicketWorker | Done |
| 5 Document providers | NullDocumentProvider default; UI adapter | Done |
| 6 Cutover | Motor **default ON**; findings from kernel; EXE/CAP/REPLAY non-vacuous | Done |
| Infra: Mimers CAS | Single store; index rebuild; `MIMERS_REQUIRED` fail-closed + tests | Done |
| Infra: Frozen Core hashes | Projection → SHA-256 → golden **exact match** (CI gate) | Done |
| Infra: Ticket queue | Prisma + file; lease timeout; dup/idempotent/crash tests | Done |
| Evolution product loop | `AdmittedOnlyEvolutionExecutor` in product path | **Deferred** |

## Feature flags

| Flag | Effect |
|------|--------|
| *(default)* | `LU_MPS_MOTOR` on — ExecutionKernel admit path |
| `LU_MPS_MOTOR=0` | Explicit opt-out (RuleEngine without admit) |
| `LU_MPS_CAS=memory` | In-memory CAS (tests / explicit) |
| `MIMERS_ROOT` | Mimers CAS root (default fallback `.data/mimers`) |
| `MIMERS_REQUIRED=1` | Fail closed if `MIMERS_ROOT` missing |
| `LU_MPS_TICKETS=prisma` | Prisma ticket queue (default) |
| `LU_MPS_TICKETS=file` | File JSON queue fallback |
| `LU_DOC_PROVIDER=mock` | Opt-in MockDocumentProvider |

## Key paths

- Freeze: `packages/mps-runtime/src/contracts/freeze/`
- Kernel: `packages/mps-runtime/src/kernel/ExecutionKernel.ts`
- LU client: `packages/mps-lu/src/execution/LuExecutionKernelClient.ts`
- CAS: `createKernelArtifactRepository` → Mimers `FileCASRepository` + id→hash index
- Tickets: `src/application/enqueue-lu-execution-ticket.ts` → `PrismaExecutionTicketQueue`
- Frozen Core: `packages/mps-governance/src/release/reference/FrozenCoreV1.ts`
- UI: `components/app/lu/LuWorkspace.tsx` shows `executionMotor` meta

## Evolution gate (explicit)

Do **not** wire product evolution until:

1. Production LU runs routinely through ExecutionKernel.
2. Artifacts land in Mimers CAS and are replay-verifiable.
3. Ticket queue shows stable admit → complete under restart.

Until then, keep `AdmittedOnlyEvolutionExecutor` out of the product path so evolution does not optimize a still-moving motor.
