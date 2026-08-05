import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    expect(result.findings.length).toBe(result.finding_ids.length);
    expect(result.manifest_id).toContain("lu-manifest-");
  });

  it("cutover: no LU_MPS_MOTOR opt-out and no RuleEngine bypass export", () => {
    const clientSrc = readFileSync(
      path.join(__dirname, "../src/execution/LuExecutionKernelClient.ts"),
      "utf8",
    );
    expect(clientSrc).not.toContain("isLuMpsMotorEnabled");
    expect(clientSrc).not.toContain("LU_MPS_MOTOR");
    expect(clientSrc).toContain("runLuAssessmentViaKernel");
  });
});
