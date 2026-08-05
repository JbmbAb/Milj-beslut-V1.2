import { describe, it, expect } from "vitest";
import {
  runLuAssessmentViaKernel,
  isLuMpsMotorEnabled,
} from "../src/execution/LuExecutionKernelClient";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";

describe("LuExecutionKernelClient", () => {
  it("admits and returns finding ids via ExecutionKernel", async () => {
    const evidence = [
      {
        artifact_id: "ev-water-1",
        artifact_type: "SPATIAL_EVIDENCE",
        payload: {
          source_metadata: { dataset: "water" },
        },
      },
    ] as unknown as SpatialEvidenceArtifact[];

    const result = await runLuAssessmentViaKernel({
      site_id: "site-a",
      deterministic_seed: "seed:site-a",
      evidence,
    });

    expect(result.admitted).toBe(true);
    expect(result.attempt_id).toContain("attempt-");
    expect(result.finding_ids.length).toBeGreaterThan(0);
  });

  it("reads LU_MPS_MOTOR flag", () => {
    expect(isLuMpsMotorEnabled({ LU_MPS_MOTOR: "1" })).toBe(true);
    expect(isLuMpsMotorEnabled({ LU_MPS_MOTOR: "0" })).toBe(false);
  });
});
