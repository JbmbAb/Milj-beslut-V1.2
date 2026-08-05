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
- Evolution: Manifest → Admission → Evolution only.

## Phases

| Phase | Deliverable | Status in codebase |
|-------|-------------|-------------------|
| −1 Contract Freeze | Frozen identities + type-lock tests + ADR-29 | Done |
| 0 Kernel skeleton | `ExecutionKernel`, `RuntimeState`, LU client flag | Done |
| 1 Destub bottom | Admit hashes, ImplementationResolver, CasBackedArtifactRepository | Done |
| 2 LU MVP strangler | `LU_MPS_MOTOR=1` path in localization usecase | Done |
| 3 Workflow | Workflow freeze fields + `LuSiteAssessmentRegistry` snapshot | Done |
| 4 Ticket queue | In-memory + `FileDurableExecutionTicketQueue` + `AdmittedTicketWorker` | Done (Prisma deferred) |
| 5 Document providers | `NullDocumentProvider` default; UI `ExecutionResultPresentationAdapter` | Done |
| 6 Cutover + evolution | `AdmittedOnlyEvolutionExecutor`; EXE-25-I5/I7 non-vacuous | Partial (legacy dual-path until parity) |

## Feature flags

| Flag | Effect |
|------|--------|
| `LU_MPS_MOTOR=1` | Localization report uses ExecutionKernel admit path |
| `LU_DOC_PROVIDER=mock` | Opt-in MockDocumentProvider; default is Null |

## Key paths

- Freeze: `packages/mps-runtime/src/contracts/freeze/`
- Kernel: `packages/mps-runtime/src/kernel/ExecutionKernel.ts`
- LU client: `packages/mps-lu/src/execution/LuExecutionKernelClient.ts`
- Tickets: `packages/mps-control-plane/src/ExecutionTicketQueue.ts`, `FileDurableExecutionTicketQueue.ts`
- Worker: `packages/mps-control-plane/src/AdmittedTicketWorker.ts`
- CAS port: `packages/mps-runtime/src/repository/CasBackedArtifactRepository.ts`
- LU registry: `packages/mps-lu/src/registry/LuSiteAssessmentRegistry.ts`
- Evolution: `packages/mps-evolution/src/AdmittedOnlyEvolutionExecutor.ts`

## Architecture

```text
Domain client (LU)
        ↓
  ExecutionKernel
        ↓
  ArtifactRepository → CAS
  ReplayEngine (reads CAS)
```

## Next hardening (post-MVP)

1. Swap `MemoryByteStorageBackend` for Mimers file CAS in production composition root.
2. Persist ExecutionTicket via Prisma / Cloud Tasks (requires migration approval).
3. Remove legacy RuleEngine path when parity proven under `LU_MPS_MOTOR=1`.
4. Complete remaining CAP/REPLAY/SIG validators (EXE-25-I5/I7 done).
5. Align FrozenCoreV1 mock hashes carefully with FROZEN_CORE_I7 without breaking Package24.
