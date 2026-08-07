import { describe, it, expect, vi } from "vitest";
import { MimersIntegration } from "../../../mps-runtime/src/mimers/index.js";
import { PostgisSpatialProvider } from "../src/providers/PostgisSpatialProvider";
import { SpatialQueryRequest } from "../src/services/SpatialQueryContract";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { LUPropertyContextArtifact } from "../src/artifacts/LUPropertyContextArtifact";
import { DefaultReplayEngine } from "../../../mps-runtime/src/replay/DefaultReplayEngine";
import { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";

describe("LU Enforcement: End-to-End Replay and CAS Verification", () => {
  it("executes the full LU chain and verifies replayability", async () => {
    // 1. Setup integration and repository
    const mimers = await MimersIntegration.create();
    const repo = mimers.artifactRepository;

    // 2. Setup mock property context
    const mockProperty: LUPropertyContextArtifact = {
      artifact_id: "prop-e2e-123",
      artifact_type: "LU_PROPERTY_CONTEXT",
      content_hash: { algorithm: "sha256", value: "hash-prop" },
      references: [],
      payload: {
        property_ref: "TEST 1:1",
        official_name: "Test E2E",
        geometry_ref: { artifact_id: "geom", artifact_type: "CANONICAL_GEOMETRY" },
        municipality: "Stockholm",
        coordinates: [6612345, 591234], // N, E
      }
    };
    
    // Save property to CAS
    await repo.put({
      artifact_id: mockProperty.artifact_id,
      content_hash: mockProperty.content_hash,
      body: mockProperty
    });

    const mockLoader = async (ref: any) => repo.get(ref.artifact_id).then(r => r?.body);

    const mockQueryFn = vi.fn().mockImplementation(async (sql: string) => {
      // water has findings, ebh is negative
      if (sql.includes("env.sgu_well_actual")) return [{ "?column?": 1 }];
      return []; 
    });

    // 3. Instantiate provider with actual CAS repo
    const provider = new PostgisSpatialProvider(mockQueryFn, mockLoader, repo);

    const request: SpatialQueryRequest = {
      property_ref: { artifact_id: "prop-e2e-123", artifact_type: "LU_PROPERTY_CONTEXT" },
      buffer_distance_meters: 600,
      layers: [
        { name: "water", version_hash: "v1.2.3" },
        { name: "ebh", version_hash: "v1.0.0" }
      ]
    };

    // 4. Generate Spatial Evidence
    const evidence = await provider.query(request);
    
    expect(evidence).toHaveLength(2);
    const waterEvidence = evidence.find(e => e.payload.layer_ref.layer_id === "water")!;
    const ebhEvidence = evidence.find(e => e.payload.layer_ref.layer_id === "ebh")!;
    
    // Verify it was actually saved to CAS by the provider
    const waterFromCas = await repo.get(waterEvidence.artifact_id);
    expect(waterFromCas?.body).toEqual(waterEvidence);
    
    const ebhFromCas = await repo.get(ebhEvidence.artifact_id);
    expect(ebhFromCas?.body.payload.geometry).toBeNull(); // Negative evidence in CAS

    // 5. Run LU Assessment (Decision & Review emulation via Kernel)
    const runResult = await runLuAssessmentViaKernel({
      site_id: "site-e2e-123",
      deterministic_seed: "seed:e2e",
      evidence,
    });

    expect(runResult.admitted).toBe(true);
    expect(runResult.session).toBeDefined();
    expect(runResult.findings.length).toBeGreaterThan(0); // Should find 'water' rule match
    
    const sessionId = runResult.session!.session_id;

    // 6. Verify Replay
    const replayEngine = new DefaultReplayEngine(repo);
    const replayResult = await replayEngine.replay(sessionId);
    
    expect(replayResult.success).toBe(true);
    expect(replayResult.matches_original).toBe(true);
    
    if (replayResult.success) {
      expect(replayResult.replayed_outcome.content_hash.value).toBe(runResult.attestation?.content_hash.value);
    }

    // 7. Verify Tamper Resistance (Negative test)
    // Tamper with the evidence in CAS
    const tamperedEvidence: SpatialEvidenceArtifact = JSON.parse(JSON.stringify(waterEvidence));
    tamperedEvidence.payload.query_context.parameters.search_distance_meters = 1000; // Change buffer
    
    // Bypass repository content hash checks for the purpose of this test to force bad data in
    await repo.put({
      artifact_id: waterEvidence.artifact_id,
      content_hash: waterEvidence.content_hash, // Keep original hash to spoof identity
      body: tamperedEvidence
    });

    // Replay should now fail because the content hash of the re-run won't match, 
    // or the signature won't match, or the kernel will detect the spoofed evidence.
    
    const failedReplayResult = await replayEngine.replay(sessionId);
    expect(failedReplayResult.success).toBe(false);
  });
});
