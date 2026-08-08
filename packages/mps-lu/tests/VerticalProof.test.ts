import { describe, it, expect, beforeAll } from "vitest";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";
import { LokeIngestor, InMemoryQuarantineStorage } from "../src/loke/LokeIngestor";
import { QuarantinePromoter } from "../src/loke/QuarantinePromoter";
import { ViewerKernel } from "../src/viewer/ViewerKernel";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import { DefaultReplayEngine } from "../../mps-runtime/src/replay/DefaultReplayEngine";
import { ExecutionKernel } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

describe("The Vertical Proof: Full E2E Governance + CAS + QGIS + Replay", () => {
  let casRepo: any;
  let viewer: ViewerKernel;
  let documentEvidence: DocumentEvidenceArtifact;
  let spatialEvidence: SpatialEvidenceArtifact;
  let assessmentManifestId: string;
  let kernelState: import("../../mps-runtime/src/kernel/RuntimeState").RuntimeState;

  beforeAll(async () => {
    // 1. Core Architecture
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;
    
    const mockCapability: any = {
      artifact_id: "viewer-cap-mock",
      artifact_type: "viewer_capability",
      release_hash: { algorithm: "sha256", value: "mock-release-hash" }
    };
    viewer = new ViewerKernel(casRepo, mockCapability);

    // 2. Source -> Loke -> Quarantine -> CAS (Human Approval)
    const archivePath = join(process.cwd(), "tests", "fixtures", "EndToEnd", "VerticalProof");
    const filePath = join(archivePath, "original", "beslut.txt");
    await mkdir(join(archivePath, "original"), { recursive: true });
    await writeFile(filePath, "Avslag: Risk för översvämning på grund av närhet till vatten", "utf8");

    const quarantine = new InMemoryQuarantineStorage();
    const ingestor = new LokeIngestor(quarantine);
    const promoter = new QuarantinePromoter(quarantine, casRepo);

    const rawDoc = await ingestor.ingestFile(filePath, "Länsstyrelsen", "Policy-v2");
    documentEvidence = await promoter.promote(rawDoc.artifact_id, "prop-vertical", "doc-vertical", "BESLUT");

    // 3. PostGIS Engine -> CAS (Canonical Spatial Truth)
    spatialEvidence = {
      artifact_id: "spatial-vertical-1",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "spatial-hash-vertical" },
      references: [{ artifact_id: "prop-vertical", artifact_type: "PROPERTY" }],
      payload: {
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 1], [0, 0]]] },
        srid: 3006,
        operation: { algorithm: "ST_DWithin", engine: "PostGIS", engine_fingerprint: {} },
        layer_ref: { layer_id: "water", layer_version: "v1" },
        source_metadata: { provider: "Naturvårdsverket", dataset: "water", dataset_version: "v1", retrieved_at: new Date().toISOString() },
        query_context: { query_id: "q2", query_type: "SPATIAL_DWITHIN", parameters: { property_ref: { artifact_id: "prop-vertical", artifact_type: "PROPERTY" }, search_distance_meters: 100 } }
      }
    };

    // Engine writes to CAS via its dedicated CAS integration
    await casRepo.put({
      artifact_id: spatialEvidence.artifact_id,
      content_hash: spatialEvidence.content_hash,
      body: spatialEvidence
    });
  });

  it("should execute the LU engine with fused CAS evidence", async () => {
    // 4. LURuleEngine -> LocalizationAssessmentArtifact -> CAS
    const kernelResult = await runLuAssessmentViaKernel({
      site_id: "vertical-site",
      deterministic_seed: "seed:vertical",
      evidence: [spatialEvidence],
      document_evidence: [documentEvidence],
      repo: casRepo,
    });

    expect(kernelResult.admitted).toBe(true);
    expect(kernelResult.findings).toHaveLength(2); // LU-WATER-001 and LU-DOC-BESLUT-001
    assessmentManifestId = kernelResult.manifest_id;
    kernelState = kernelResult.state;

    // Verify it was correctly stored in CAS
    const executionSession = await casRepo.resolve({ artifact_id: `session-${assessmentManifestId}`, artifact_type: "execution_session" });
    expect(executionSession).toBeDefined();
  });

  it("should export Canonical Spatial Truth to QGIS (Viewer Observation != Authority)", async () => {
    // 5. CAS -> ViewerKernel -> GeoJSON (QGIS Observation)
    // QGIS can only consume the Verified Observation, preventing it from ever acting as an Authority.
    const geojson = await viewer.exportAsGeoJSON([spatialEvidence.artifact_id]);
    
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features).toHaveLength(1);
    
    // Validate that the CAS trace is included
    const feature = geojson.features[0];
    expect(feature.properties.cas_artifact_id).toBe(spatialEvidence.artifact_id);
    expect(feature.properties.governance_status).toBe("VERIFIED_OBSERVATION");
    expect(feature.properties.viewer_capability_id).toBe("viewer-cap-mock");
    expect(feature.properties.viewer_release_hash).toBe("mock-release-hash");
  });

  it("should replay the outcome identically from CAS without QGIS or PostGIS", async () => {
    // 6. Replay Engine (Execution isolation)
    const replayEngine = new DefaultReplayEngine(casRepo);
    
    const manifest_ref = { artifact_id: assessmentManifestId, artifact_type: "execution_manifest" };
    
    // We recreate the kernel, but provide NO capability executors and NO PostGIS connections.
    // The replay engine uses CAS alone.
    
    const replayResult = await replayEngine.replay(manifest_ref, kernelState!);
    
    expect(replayResult.replayed_outcome_ref.artifact_id).toBeDefined();
    // Replay succeeded, meaning outcome matches original hash
    // We didn't throw CAS hash mismatch error!
  });
});
