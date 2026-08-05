# ADR-30: LU Runtime v1 Freeze — Execution Kernel v1.0 (Cutover Complete)

Status: Accepted  
Date: 2026-08-05  
Milestone: **Execution Kernel v1.0 – LU Cutover Complete**

## Context

ADR-29 froze execution *identities* and named ExecutionKernel as the motor API.  
Commit `dff5efa` completed the LU product cutover: Localization Report no longer has a parallel RuleEngine path.

That changes the platform’s execution model from dual paths (legacy RuleEngine ∥ MPS) to a single normative spine. This ADR freezes that **runtime behavior** for LU v1 so the motor is not reopened casually for LU feature work.

## Decision

### Version mark

| Marker | Value |
|--------|-------|
| Execution Kernel release | `1.0.0` |
| LU Runtime freeze | `lu-runtime-v1` |
| Code constant | `LU_RUNTIME_FREEZE_VERSION` / `EXECUTION_KERNEL_RELEASE_VERSION` in `@miljobeslut/mps-lu` |

Identity schema freeze remains ADR-29 / `EXECUTION_CONTRACT_FREEZE_VERSION = "1.0.0"`.

### Normative LU execution model (frozen)

```
UI (LuWorkspace / Localization Report)
        ↓
ExecutionKernel
        ↓
Admission          (mandatory — cannot be bypassed)
        ↓
Capability Resolution
        ↓
Capability Invoke  (sole path to LURuleEngine)
        ↓
Artifact Store     (Mimers CAS — sole artifact source)
        ↓
Replay             (part of the production spine, not a side track)
        ↓
Presentation
```

### Frozen invariants (SHALL)

1. **Single execution path** — LU assessment product code SHALL call `runLuAssessmentViaKernel` (or equivalent kernel client). No second path that evaluates rules outside the kernel.
2. **Admission mandatory** — Capability invoke SHALL NOT run unless Admission returns `admitted`.
3. **Capability invocation mandatory** — `LURuleEngine` (and any future LU rule impl) SHALL run only as a capability invoke handler. Direct `new LURuleEngine().evaluate(...)` in product paths is forbidden.
4. **Artifact persistence mandatory** — Admitted attempts, outcomes, capability executions, and related artifacts SHALL be written through `createKernelArtifactRepository` → Mimers CAS.
5. **Replay determinism** — Replay SHALL read CAS via ArtifactRepository; identical admitted inputs SHALL yield equivalent replay proofs (see kernel / e2e determinism tests).
6. **CAS as sole artifact source** — Product LU SHALL NOT write a parallel store (e.g. legacy `.data/mps-cas`). Tests may use in-memory CAS via `LU_MPS_CAS=memory`.

### Explicitly out of freeze (may evolve without LU major)

- Durable ticket queue hardening (leases, recovery) behind `ExecutionTicketQueue`
- WorkflowEngine generalization
- Capability Registry growth for new domains
- UI chrome (`MimerProductShell`) presentation details
- Evolution product loop (still **deferred** until real production history exists)

### Change control

Breaking any frozen invariant requires:

1. A new ADR (or ADR-30 revision with new freeze label, e.g. `lu-runtime-v2`)
2. Update of freeze constants and golden / cutover regression tests
3. Explicit human approval (Human in the loop)

## Consequences

- LU is **frozen as the first production domain** on ExecutionKernel — prefer not to reopen the motor for LU-only experiments.
- Next platform focus SHOULD shift to shared infrastructure: ExecutionQueue, WorkflowEngine, Kernel generalization, Capability Registry — then Evolution.
- New domains (avlopp, C-anmälan, kontrollplan, …) SHOULD reuse the same spine without inventing a second architecture.
- Guard tests (`LuCutoverSinglePath`, Mimers CAS, Frozen Core golden, ExecutionKernel replay) remain the CI proof of this freeze.

## Achieved goals (as of this ADR)

| Goal | Status |
|------|--------|
| Single LU execution path | Achieved |
| Admission cannot be bypassed | Achieved |
| Capability is the only path to RuleEngine | Achieved |
| Replay on the production spine | Achieved |
| Artifacts as shared source of truth (Mimers CAS) | Achieved |

## References

- Commit: `dff5efa` — `feat(runtime): complete LU ExecutionKernel cutover`
- [ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md)
- [ADR-27-LU-Architecture-Charter.md](./ADR-27-LU-Architecture-Charter.md)
- [LU-Flow.md](./LU-Flow.md)
- [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md)
- Code: `packages/mps-lu/src/runtime/LuRuntimeFreeze.ts`
- Guard: `src/application/unit/LuCutoverSinglePath.test.ts`
