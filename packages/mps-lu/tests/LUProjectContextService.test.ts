import { describe, it, expect, vi } from "vitest";
import { LUProjectContextService, LUProjectContextCreateRequest, FrozenCoreSubmitter } from "../src/services/LUProjectContextService";
import { LUProjectContextArtifact } from "../src/artifacts/LUProjectContextArtifact";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

describe("LUProjectContextService", () => {
  it("should create, hash deterministically, and submit a LUProjectContextArtifact", async () => {
    // Mock FrozenCoreSubmitter
    const mockSubmitter: FrozenCoreSubmitter = {
      put: vi.fn().mockResolvedValue(true)
    };

    const service = new LUProjectContextService(mockSubmitter);

    const propertyRef: ArtifactReference = {
      artifact_id: "prop_123",
      artifact_type: "LU_PROPERTY_CONTEXT"
    };

    const request: LUProjectContextCreateRequest = {
      project_name: "Test Project",
      description: "A description of the test project",
      planned_activity: "Miljöfarlig verksamhet",
      activity_category: "A",
      property_refs: [propertyRef],
      created_by: "Test Konsult"
    };

    const releaseHash = "release_hash_v1_constitution";

    // Create the project context
    const artifact = await service.createProjectContext(request, releaseHash);

    // Assertions on the generated artifact structure
    expect(artifact.artifact_id).toContain("art_ctx_");
    expect(artifact.artifact_type).toBe("LU_PROJECT_CONTEXT");
    expect(artifact.references).toHaveLength(2);
    expect(artifact.references[0]).toEqual({
      artifact_id: releaseHash,
      artifact_type: "RELEASE_HASH"
    });
    expect(artifact.references[1]).toEqual(propertyRef);

    // Assertions on payload
    expect(artifact.payload.project_name).toBe("Test Project");
    expect(artifact.payload.description).toBe("A description of the test project");
    expect(artifact.payload.planned_activity).toBe("Miljöfarlig verksamhet");
    expect(artifact.payload.activity_category).toBe("A");
    expect(artifact.payload.property_refs).toEqual([propertyRef]);
    expect(artifact.payload.created_by).toBe("Test Konsult");

    // Assertion on hashing
    expect(artifact.content_hash.algorithm).toBe("sha256");
    expect(artifact.content_hash.value).toHaveLength(64); // Valid sha256 hex digest length

    // Assert that the submitter was called with the artifact
    expect(mockSubmitter.put).toHaveBeenCalledWith(artifact);
  });

  it("should produce identical hashes for identical payloads regardless of object property ordering", async () => {
    const mockSubmitter: FrozenCoreSubmitter = {
      put: vi.fn().mockResolvedValue(true)
    };

    const service = new LUProjectContextService(mockSubmitter);

    const propertyRef: ArtifactReference = {
      artifact_id: "prop_456",
      artifact_type: "LU_PROPERTY_CONTEXT"
    };

    // Construct requests with different property orderings
    const request1: LUProjectContextCreateRequest = {
      project_name: "Identical Project",
      description: "Description",
      property_refs: [propertyRef],
      created_by: "Konsult B"
    };

    const request2: LUProjectContextCreateRequest = {
      description: "Description",
      project_name: "Identical Project",
      property_refs: [propertyRef],
      created_by: "Konsult B"
    };

    const releaseHash = "release_hash_v2";

    const artifact1 = await service.createProjectContext(request1, releaseHash);
    const artifact2 = await service.createProjectContext(request2, releaseHash);

    // The random artifact_id will differ, but the content_hash MUST be identical because the payloads are identical
    expect(artifact1.content_hash.value).toBe(artifact2.content_hash.value);
  });
});
