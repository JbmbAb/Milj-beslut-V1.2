import { afterEach, describe, expect, it } from "vitest";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";

/**
 * RC8-K — canonical production LU must not self-admit through the bootstrap bypass.
 *
 * runLuAssessmentViaKernel is the only production LU assessment path
 * (src/application/generate-localization-report.usecase.ts). Before this fix it hardcoded
 * `bootstrapAdmit: true` unconditionally, so every caller -- production included -- always
 * admitted regardless of whether any real governed admission context existed. This RED proof
 * asserts the canonical default is deny, and that bootstrap admission requires an explicit
 * capability opt-in rather than being reachable from ordinary execution.
 */

const evidence = [
  {
    artifact_id: "ev-water-boundary",
    artifact_type: "SPATIAL_EVIDENCE",
    payload: {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: {
          subject_ref: { artifact_id: "prop-boundary", artifact_type: "PROPERTY" },
          srid: 3006,
          distance_meters: 100,
        },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: "prop-boundary", artifact_type: "PROPERTY" },
      source_metadata: {
        provider: "SGU",
        dataset: "water",
        dataset_version: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
        retrieved_at: "2026-08-13T08:00:00.000Z",
      },
      geometry: null,
      srid: 3006,
      operation: {
        algorithm: "spatial.dwithin_existence",
        engine: "PostGIS",
        engine_fingerprint: SPATIAL_STACK_V1,
      },
      layer_ref: {
        layer_id: "water",
        version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
        layer_version: "v1",
      },
      query_context: {
        query_id: "q-boundary",
        query_type: "SPATIAL_DWITHIN",
        parameters: { search_distance_meters: 100 },
      },
    },
  },
] as unknown as SpatialEvidenceArtifact[];

describe("RC8-K LU admission boundary — production path", () => {
  afterEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  it("RED 1 — default (no opt-in) denies admission with a real reason, not a silent bypass", async () => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;

    const result = await runLuAssessmentViaKernel({
      site_id: "site-boundary-deny",
      deterministic_seed: "seed:site-boundary-deny",
      evidence,
    });

    expect(result.admitted).toBe(false);
    // PROD-LU-ADMISSION-02D: the real (non-bootstrap) path always builds a genuine
    // FrozenCoreVerificationContext now, so denial comes from RuntimeAdmissionKernel actually
    // looking for -- and not finding -- an authority-issued identity, not from a context that
    // was never built at all. Same fail-closed outcome, more precise reason.
    expect(result.reason_codes.join(" ")).toMatch(/Invalid or missing Execution Identity/);
    expect(result.assessment).toBeNull();
  });

  it("RED 2 — explicit MPS_LU_BOOTSTRAP_ADMIT=1 opt-in still allows bootstrap admission", async () => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";

    const result = await runLuAssessmentViaKernel({
      site_id: "site-boundary-allow",
      deterministic_seed: "seed:site-boundary-allow",
      evidence,
    });

    expect(result.admitted).toBe(true);
    expect(result.reason_codes).toContain("BOOTSTRAP_ADMIT");
  });
});
