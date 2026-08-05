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
| Infra: Mimers CAS | Single store; index rebuild; `MIMERS_REQUIRED` fail-closed + tests | Done |
| Infra: Frozen Core hashes | Projection → SHA-256 → golden **exact match** (CI gate) | Done |
| Infra: Ticket queue | Prisma + file; lease timeout; dup/idempotent/crash tests | Done |
| **7 LU Cutover** | **Single path:** Report → Kernel → Artifacts → UI (no RuleEngine bypass) | **Done** |
| Evolution product loop | Metrics → Fitness → Candidates → Replay → Promotion | **Deferred** |

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

## Key paths

- Freeze: `packages/mps-runtime/src/contracts/freeze/`
- Kernel: `packages/mps-runtime/src/kernel/ExecutionKernel.ts`
- LU client: `packages/mps-lu/src/execution/LuExecutionKernelClient.ts`
- Report: `src/application/generate-localization-report.usecase.ts` → `runLuAssessmentViaKernel` only
- CAS: `createKernelArtifactRepository` → Mimers `FileCASRepository` + id→hash index
- Tickets: `src/application/enqueue-lu-execution-ticket.ts` → `PrismaExecutionTicketQueue`
- UI: `components/app/lu/LuWorkspace.tsx`

## Next focus (not more packages)

1. ~~Replace last legacy LU execution path~~ **Done**
2. Gather real production runs + replayable Mimers artifacts
3. Then activate evolution: Execution Metrics → Fitness → Candidates → Replay → Promotion

## Evolution gate (explicit)

Do **not** wire product evolution until:

1. Production LU runs routinely through ExecutionKernel.
2. Artifacts land in Mimers CAS and are replay-verifiable.
3. Ticket queue shows stable admit → complete under restart.

Until then, keep `AdmittedOnlyEvolutionExecutor` out of the product path.
