/**
 * LU Runtime v1 Freeze / Execution Kernel v1.0 — LU Cutover Complete.
 *
 * Normative model (ADR-30):
 *   Report → ExecutionKernel → Admission → Capability → Mimers CAS → Replay → UI
 *
 * Bumping these constants requires an ADR revision and cutover regression updates.
 */
export const EXECUTION_KERNEL_RELEASE_VERSION = "1.0.0" as const;

/** Domain freeze label: first production domain on ExecutionKernel. */
export const LU_RUNTIME_FREEZE_VERSION = "lu-runtime-v1" as const;

export const LU_RUNTIME_FREEZE_MILESTONE =
  "Execution Kernel v1.0 – LU Cutover Complete" as const;

/** Frozen invariants — documentation + type-lock surface for tests. */
export const LU_RUNTIME_V1_INVARIANTS = [
  "single_execution_path",
  "admission_mandatory",
  "capability_invocation_mandatory",
  "artifact_persistence_mandatory",
  "replay_determinism",
  "cas_sole_artifact_source",
] as const;

export type LuRuntimeV1Invariant = (typeof LU_RUNTIME_V1_INVARIANTS)[number];
