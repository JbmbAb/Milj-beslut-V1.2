import { describe, expect, it } from "vitest";

import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { ViewerKernel } from "../src/viewer/ViewerKernel";
import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { buildAdmittedViewerCapability } from "./fixtures/admittedViewerCapability";

const VERSION_HASH = "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc";

function existenceEvidence(
  id: string,
  exists: boolean,
  overrides: Record<string, unknown> = {},
): SpatialEvidenceArtifact {
  const artifact = {
    artifact_id: id,
    artifact_type: "SPATIAL_EVIDENCE",
    content_hash: { algorithm: "sha256", value: `hash-${id}` },
    references: [{ artifact_id: "prop-viewer-s6", artifact_type: "PROPERTY" }],
    payload: {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: {
          subject_ref: { artifact_id: "prop-viewer-s6", artifact_type: "PROPERTY" },
          srid: 3006,
          distance_meters: 500,
        },
        result: {
          exists,
          match_count_observed: exists ? 1 : 0,
          max_features_per_layer: 50,
        },
      },
      property_ref: { artifact_id: "prop-viewer-s6", artifact_type: "PROPERTY" },
      geometry: null,
      srid: 3006,
      operation: {
        algorithm: "spatial.dwithin_existence",
        engine: "PostGIS",
        engine_fingerprint: SPATIAL_STACK_V1,
      },
      layer_ref: {
        layer_id: "water",
        version_hash: VERSION_HASH,
        layer_version: "v1",
      },
      source_metadata: {
        provider: "SGU",
        dataset: "water",
        dataset_version: VERSION_HASH,
        retrieved_at: "2026-08-13T08:00:00.000Z",
      },
      query_context: {
        query_id: `query-${id}`,
        query_type: "SPATIAL_DWITHIN",
        parameters: { search_distance_meters: 500 },
      },
    },
    ...overrides,
  };
  return artifact as unknown as SpatialEvidenceArtifact;
}

async function viewerFor(artifact: SpatialEvidenceArtifact): Promise<ViewerKernel> {
  const repo = new InMemoryArtifactRepository();
  await repo.put({
    artifact_id: artifact.artifact_id,
    content_hash: artifact.content_hash,
    body: artifact,
  });
  return new ViewerKernel(repo, buildAdmittedViewerCapability(`viewer-s6-${artifact.artifact_id}`));
}

describe("P4A-LU-VIEWER-S6 — existential evidence presentation", () => {
  it("projects an existence hit as a traceable non-geometric GeoJSON observation", async () => {
    const artifact = existenceEvidence("existence-hit", true);
    const output = await (await viewerFor(artifact)).exportAsGeoJSON([artifact.artifact_id]);

    expect(output.features).toHaveLength(1);
    expect(output.features[0].geometry).toBeNull();
    expect(output.features[0].properties).toMatchObject({
      cas_artifact_id: artifact.artifact_id,
      governance_status: "VERIFIED_OBSERVATION",
      result_semantics_kind: "EXISTENCE_WITHIN_DISTANCE",
      exists: true,
      distance_meters: 500,
      match_count_observed: 1,
      max_features_per_layer: 50,
      layer_id: "water",
      layer_version_hash: VERSION_HASH,
      presentation_mode: "NON_GEOMETRIC_SPATIAL_OBSERVATION",
    });
    expect(output.features[0].properties.viewer_identity_ref).toBeTruthy();
  });

  it("preserves a no-hit result instead of silently dropping the evidence", async () => {
    const artifact = existenceEvidence("existence-no-hit", false);
    const output = await (await viewerFor(artifact)).exportAsGeoJSON([artifact.artifact_id]);

    expect(output.features).toHaveLength(1);
    expect(output.features[0].geometry).toBeNull();
    expect(output.features[0].properties.exists).toBe(false);
    expect(output.features[0].properties.match_count_observed).toBe(0);
  });

  it("rejects fabricated geometry on EXISTENCE_WITHIN_DISTANCE", async () => {
    const base = existenceEvidence("fabricated-geometry", true);
    const artifact = {
      ...base,
      payload: {
        ...base.payload,
        geometry: {
          type: "Polygon",
          coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
        },
      },
    } as unknown as SpatialEvidenceArtifact;

    await expect(
      (await viewerFor(artifact)).exportAsGeoJSON([artifact.artifact_id]),
    ).rejects.toThrow(/REJECT_SPATIAL_SEMANTICS/);
  });

  it("rejects evidence without declared result semantics", async () => {
    const base = existenceEvidence("missing-semantics", true);
    const { result_semantics: _removed, ...payload } = base.payload;
    const artifact = { ...base, payload } as unknown as SpatialEvidenceArtifact;

    await expect(
      (await viewerFor(artifact)).exportAsGeoJSON([artifact.artifact_id]),
    ).rejects.toThrow(/REJECT_VIEWER_SPATIAL_SEMANTICS/);
  });

  it("rejects FEATURE_GEOMETRY while that semantics remains reserved and unadmitted", async () => {
    const base = existenceEvidence("reserved-feature-geometry", true);
    const artifact = {
      ...base,
      payload: {
        ...base.payload,
        result_semantics: { ...base.payload.result_semantics, kind: "FEATURE_GEOMETRY" },
      },
    } as unknown as SpatialEvidenceArtifact;

    await expect(
      (await viewerFor(artifact)).exportAsGeoJSON([artifact.artifact_id]),
    ).rejects.toThrow(/REJECT_VIEWER_SPATIAL_SEMANTICS/);
  });

  it("has no source or database dependency beyond the CAS repository", () => {
    expect(ViewerKernel.length).toBe(2);
    const repo = {} as ArtifactRepositoryPort;
    const viewer = new ViewerKernel(repo, buildAdmittedViewerCapability("viewer-s6-surface"));
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(viewer))).toEqual([
      "constructor",
      "exportAsGeoJSON",
    ]);
  });
});
