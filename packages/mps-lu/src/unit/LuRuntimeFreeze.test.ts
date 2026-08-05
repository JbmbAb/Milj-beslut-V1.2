import { describe, it, expect } from "vitest";
import {
  EXECUTION_KERNEL_RELEASE_VERSION,
  LU_RUNTIME_FREEZE_VERSION,
  LU_RUNTIME_FREEZE_MILESTONE,
  LU_RUNTIME_V1_INVARIANTS,
} from "../runtime/LuRuntimeFreeze.js";
import { EXECUTION_CONTRACT_FREEZE_VERSION } from "../../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";

describe("LU Runtime v1 Freeze (ADR-30)", () => {
  it("exposes Execution Kernel v1.0 release mark", () => {
    expect(EXECUTION_KERNEL_RELEASE_VERSION).toBe("1.0.0");
    expect(LU_RUNTIME_FREEZE_VERSION).toBe("lu-runtime-v1");
    expect(LU_RUNTIME_FREEZE_MILESTONE).toBe(
      "Execution Kernel v1.0 – LU Cutover Complete",
    );
  });

  it("aligns with ADR-29 identity freeze major", () => {
    expect(EXECUTION_CONTRACT_FREEZE_VERSION).toBe("1.0.0");
    expect(EXECUTION_KERNEL_RELEASE_VERSION).toBe(EXECUTION_CONTRACT_FREEZE_VERSION);
  });

  it("locks the six normative invariants", () => {
    expect([...LU_RUNTIME_V1_INVARIANTS]).toEqual([
      "single_execution_path",
      "admission_mandatory",
      "capability_invocation_mandatory",
      "artifact_persistence_mandatory",
      "replay_determinism",
      "cas_sole_artifact_source",
    ]);
  });
});
