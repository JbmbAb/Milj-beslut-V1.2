import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalPemSigningKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient.js";
import { issueExecutionIdentity } from "../src/execution/LuExecutionIdentityIssuer.js";
import { createLuRegistryRuntime } from "../src/registry/createLuRegistryRuntime.js";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../src/registry/LuSiteAssessmentRegistry.js";
import { LU_EXECUTION_PRINCIPAL_ID } from "../src/execution/LuExecutionKernelClient.js";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository.js";
import {
  __resetLuExecutionAuthoritySigningProviderForTests,
} from "../../../server/security/luExecutionAuthoritySigningKey.js";
import { __resetLuExecutionAuthorityVerifierForTests } from "../src/execution/LuExecutionAuthorityVerifier.js";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact.js";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint.js";

/**
 * PROD-LU-ADMISSION-02D — production composition: LuExecutionKernelClient as a pure consumer.
 *
 * Proves both directions of the invariant:
 *   authority-issued identity exists / explicitly provisioned -> LU consumes it, admits
 *   no authority-issued identity                              -> GOVERNANCE_DENIED
 *
 * Critically, issuance happens via a SEPARATE call to issueExecutionIdentity (a different
 * module, holding the signing capability) BEFORE runLuAssessmentViaKernel runs -- never inside
 * it. That is the difference between a real prerequisite and PROD-LU-ADMISSION-01C's rejected
 * self-sign-then-verify shortcut.
 */

const evidence = [
  {
    artifact_id: "ev-water-02d",
    artifact_type: "SPATIAL_EVIDENCE",
    payload: {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: {
          subject_ref: { artifact_id: "prop-02d", artifact_type: "PROPERTY" },
          srid: 3006,
          distance_meters: 100,
        },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: "prop-02d", artifact_type: "PROPERTY" },
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
        query_id: "q-02d",
        query_type: "SPATIAL_DWITHIN",
        parameters: { search_distance_meters: 100 },
      },
    },
  },
] as unknown as SpatialEvidenceArtifact[];

describe("PROD-LU-ADMISSION-02D — production composition", () => {
  const ENV_VARS = [
    "LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID",
    "LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM",
    "LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM",
    "LU_EXECUTION_AUTHORITY_ROOT_KEY_ID",
    "LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM",
    "MPS_LU_BOOTSTRAP_ADMIT",
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of ENV_VARS) originalEnv[name] = process.env[name];
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
    delete process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM;
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  afterEach(() => {
    for (const name of ENV_VARS) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  it("no authority-issued identity -> GOVERNANCE_DENIED (fail-closed, no self-issuance)", async () => {
    const repo = new InMemoryArtifactRepository();

    const result = await runLuAssessmentViaKernel({
      site_id: "site-02d-deny",
      deterministic_seed: "seed:site-02d-deny",
      evidence,
      artifact_repository: repo,
    });

    expect(result.admitted).toBe(false);
    expect(result.reason_codes.join(" ")).toMatch(/Invalid or missing Execution Identity/);
    expect(result.assessment).toBeNull();
  });

  it("authority-issued identity, explicitly provisioned ahead of the run -> ADMITTED", async () => {
    const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate(
      "ed25519:lu-execution-authority-v1",
    );
    process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = "ed25519:lu-execution-authority-v1";
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = publicKey;

    const repo = new InMemoryArtifactRepository();
    const registry = createLuRegistryRuntime();
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;

    // Explicit, separate provisioning step -- not something runLuAssessmentViaKernel triggers.
    await issueExecutionIdentity({
      site_id: "site-02d-allow",
      deterministic_seed: "seed:site-02d-allow",
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: "execution_identity" },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    const result = await runLuAssessmentViaKernel({
      site_id: "site-02d-allow",
      deterministic_seed: "seed:site-02d-allow",
      evidence,
      artifact_repository: repo,
      registry,
    });

    expect(result.admitted).toBe(true);
    expect(result.reason_codes).not.toContain("BOOTSTRAP_ADMIT");
    expect(result.reason_codes).toContain("SECURITY_ADMIT");
  });

  it("authority-issued identity for a DIFFERENT site is not reused -> GOVERNANCE_DENIED", async () => {
    const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate(
      "ed25519:lu-execution-authority-v1",
    );
    process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = "ed25519:lu-execution-authority-v1";
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = publicKey;

    const repo = new InMemoryArtifactRepository();
    const registry = createLuRegistryRuntime();
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;

    await issueExecutionIdentity({
      site_id: "site-02d-provisioned-elsewhere",
      deterministic_seed: "seed:site-02d-provisioned-elsewhere",
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: "execution_identity" },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    const result = await runLuAssessmentViaKernel({
      site_id: "site-02d-unprovisioned",
      deterministic_seed: "seed:site-02d-unprovisioned",
      evidence,
      artifact_repository: repo,
      registry,
    });

    expect(result.admitted).toBe(false);
    expect(result.assessment).toBeNull();
  });
});
