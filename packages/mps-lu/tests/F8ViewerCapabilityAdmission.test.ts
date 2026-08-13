import { describe, it, expect, beforeAll } from "vitest";

import { ViewerKernel } from "../src/viewer/ViewerKernel";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import { admitViewerCapability } from "../../mps-governance-runtime/src/ViewerCapabilityAdmission";
import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import type { ViewerCapabilityArtifact } from "../../mps-compliance/src/artifacts/ViewerCapabilityArtifact";
import {
  buildAdmittedViewerCapability,
  VIEWER_IDENTITY,
  VIEWER_RELEASE_HASH,
} from "./fixtures/admittedViewerCapability";

/**
 * ✅ F8 — VIEWER CAPABILITY ADMISSION GREEN PROOF.
 *
 *   Invariant under test:
 *     A viewer capability SHALL come from the governance admission path, and the observation it
 *     produces SHALL name the identity that held it.
 *
 *   Root cause this closes: the viewer fixtures hand-built
 *   `{ artifact_id, artifact_type, release_hash } as any` and handed it straight to
 *   `ViewerKernel`. That object had no `viewer_identity_ref`, no `granted_by`, no `policy_ref`
 *   and no validity window — the test made itself the root of trust, which is exactly what
 *   VIEW-22-I2 exists to prevent. `ViewerKernel` was already enforcing the provenance check;
 *   nothing in production had to change.
 *
 *   Scope: capability admission and identity binding only. No replay, no F4, no rule semantics.
 */
describe("F8 — viewer capability admission (GREEN PROOF)", () => {
  let casRepo: ArtifactRepositoryPort;
  const EVIDENCE_ID = "spatial-f8-1";

  beforeAll(async () => {
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;

    const evidence = {
      artifact_id: EVIDENCE_ID,
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "spatial-hash-f8" },
      references: [{ artifact_id: "prop-f8", artifact_type: "PROPERTY" }],
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-f8", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: "prop-f8", artifact_type: "PROPERTY" },
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
        source_metadata: {
          provider: "SGU",
          dataset: "water",
          dataset_version: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          retrieved_at: "2026-08-13T08:00:00.000Z",
        },
        query_context: {
          query_id: "q-f8",
          query_type: "SPATIAL_DWITHIN",
          parameters: {
            property_ref: { artifact_id: "prop-f8", artifact_type: "PROPERTY" },
            search_distance_meters: 100,
          },
        },
      },
    } as unknown as SpatialEvidenceArtifact;

    await casRepo.put({
      artifact_id: evidence.artifact_id,
      content_hash: evidence.content_hash,
      body: evidence,
    });
  });

  // ---------------------------------------------------------------- POSITIVE

  it("an admitted capability carries full provenance", () => {
    const cap = buildAdmittedViewerCapability("f8-positive");

    expect(cap.viewer_identity_ref.artifact_id).toBe(VIEWER_IDENTITY.artifact_id);
    expect(cap.granted_by.artifact_id).toBeTruthy();
    expect(
      cap.policy_ref.artifact_id,
      "F8: a capability without a policy behind it is a root of trust, not a grant.",
    ).toBeTruthy();
    expect(cap.release_hash.value).toBe(VIEWER_RELEASE_HASH);
  });

  it("the exported observation names the identity that held the capability", async () => {
    const cap = buildAdmittedViewerCapability("f8-export");
    const geojson = await new ViewerKernel(casRepo, cap).exportAsGeoJSON([EVIDENCE_ID]);

    const props = geojson.features[0].properties;
    expect(props.governance_status).toBe("VERIFIED_OBSERVATION");
    expect(props.viewer_capability_id).toBe(cap.artifact_id);
    expect(props.viewer_release_hash).toBe(VIEWER_RELEASE_HASH);
    expect(
      props.viewer_identity_ref,
      "F8: an export attributable to a capability but to no observer cannot answer 'who looked'.",
    ).toBe(VIEWER_IDENTITY.artifact_id);
  });

  // ---------------------------------------------------------------- NEGATIVE

  it("the hand-built capability the fixtures used to pass is REJECTED by admission", () => {
    // Verbatim reconstruction of the object VerticalProof and QgisIntegration used to build.
    const legacyMock = {
      artifact_id: "viewer-cap-mock",
      artifact_type: "viewer_capability",
      release_hash: { algorithm: "sha256", value: "mock-release-hash" },
    } as unknown as ViewerCapabilityArtifact;

    const result = admitViewerCapability(legacyMock, {
      expected_release_hash: VIEWER_RELEASE_HASH,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.reason,
        "F8: this is the exact object the suite trusted for the whole of F8's lifetime.",
      ).toContain("viewer_identity_ref");
    }
  });

  it("ViewerKernel refuses a capability without viewer_identity_ref", async () => {
    const noIdentity = {
      artifact_id: "viewer-cap-no-identity",
      artifact_type: "viewer_capability",
      release_hash: { algorithm: "sha256", value: VIEWER_RELEASE_HASH },
    } as unknown as ViewerCapabilityArtifact;

    await expect(
      new ViewerKernel(casRepo, noIdentity).exportAsGeoJSON([EVIDENCE_ID]),
      "F8: the kernel must fail closed even if a caller bypasses admission. Admission is the " +
        "gate; the kernel is the backstop.",
    ).rejects.toThrow(/viewer_identity_ref/);
  });

  it("an expired capability is rejected — the window is enforced, not decorative", () => {
    const cap = buildAdmittedViewerCapability("f8-window");

    const result = admitViewerCapability(cap, {
      expected_release_hash: VIEWER_RELEASE_HASH,
      now: new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("expired");
  });

  it("a capability bound to a different release is rejected — release isolation holds", () => {
    const cap = buildAdmittedViewerCapability("f8-release");

    const result = admitViewerCapability(cap, {
      expected_release_hash: "c".repeat(64),
      now: new Date("2026-08-13T12:00:00.000Z"),
    });

    expect(
      result.ok,
      "F8: a capability issued against one release must not admit observation of another.",
    ).toBe(false);
  });
});
