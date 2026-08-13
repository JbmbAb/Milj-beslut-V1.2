import { describe, it, expect, beforeAll } from "vitest";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";
import { LokeIngestor, InMemoryQuarantineStorage } from "../src/loke/LokeIngestor";
import { DocumentEvidenceMaterializer } from "../src/loke/QuarantinePromoter";
import { ViewerKernel } from "../src/viewer/ViewerKernel";
import {
  buildAdmittedViewerCapability,
  VIEWER_IDENTITY,
  VIEWER_RELEASE_HASH,
} from "./fixtures/admittedViewerCapability";
import type { ViewerCapabilityArtifact } from "../../mps-compliance/src/artifacts/ViewerCapabilityArtifact";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import {
  buildVerifiedPriorDecisionFact,
  withFactRef,
} from "./fixtures/verifiedDocumentFact";
import type { VerifiedDocumentFactArtifact } from "../../mps-data-governance/src/DocumentFactArtifact";
import { DefaultReplayEngine } from "../../mps-runtime/src/replay/DefaultReplayEngine";
import { ExecutionKernel } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

describe("The Vertical Proof: Full E2E Governance + CAS + QGIS + Replay", () => {
  let casRepo: any;
  let viewer: ViewerKernel;
  let viewerCapability: ViewerCapabilityArtifact;
  let documentEvidence: DocumentEvidenceArtifact;
  let verifiedFact: VerifiedDocumentFactArtifact;
  let spatialEvidence: SpatialEvidenceArtifact;
  let assessmentManifestId: string;
  let kernelState: import("../../mps-runtime/src/kernel/RuntimeState").RuntimeState;

  beforeAll(async () => {
    // 1. Core Architecture
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;
    
    // F8 2026-08-13: was a hand-built `as any` capability with no viewer_identity_ref,
    // granted_by, policy_ref or validity window — a root of trust invented by the test.
    // It now comes through the real admission gate.
    viewerCapability = buildAdmittedViewerCapability("vertical");
    viewer = new ViewerKernel(casRepo, viewerCapability);

    // 2. Source -> Loke -> Quarantine -> CAS (Human Approval)
    const archivePath = join(process.cwd(), "tests", "fixtures", "EndToEnd", "VerticalProof");
    const filePath = join(archivePath, "original", "beslut.txt");
    await mkdir(join(archivePath, "original"), { recursive: true });
    await writeFile(filePath, "Avslag: Risk för översvämning på grund av närhet till vatten", "utf8");

    const quarantine = new InMemoryQuarantineStorage();
    const ingestor = new LokeIngestor(quarantine);
    // A1 ENFORCEMENT (2026-08-11): the materializer no longer takes a repository and no
    // longer persists. The kernel below receives the artifact by value, which it already did.
    const promoter = new DocumentEvidenceMaterializer(quarantine);

    const rawDoc = await ingestor.ingestFile(filePath, "Länsstyrelsen", "Policy-v2");
    documentEvidence = await promoter.materialize(rawDoc.artifact_id, "prop-vertical", "doc-vertical", "BESLUT");

    // E2E FIXTURE RECONCILIATION 2026-08-13 — see LUEndToEnd.test.ts. Tier 3 verification is
    // now part of the vertical chain; the rule is no longer reachable from document text.
    verifiedFact = buildVerifiedPriorDecisionFact("vertical");
    documentEvidence = withFactRef(documentEvidence, verifiedFact);

    // 3. PostGIS Engine -> CAS (Canonical Spatial Truth)
    spatialEvidence = {
      artifact_id: "spatial-vertical-1",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "spatial-hash-vertical" },
      references: [{ artifact_id: "prop-vertical", artifact_type: "PROPERTY" }],
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-vertical", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: "prop-vertical", artifact_type: "PROPERTY" },
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
          retrieved_at: new Date().toISOString(),
        },
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
      verified_document_facts: [verifiedFact],
      repo: casRepo,
    });

    expect(kernelResult.admitted).toBe(true);
    // LU-WATER-001 (spatial) and LU-DOC-BESLUT-001 (verified Tier 3 fact, not document text).
    expect(kernelResult.findings).toHaveLength(2);
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
    expect(feature.geometry).toBeNull();
    expect(feature.properties.result_semantics_kind).toBe("EXISTENCE_WITHIN_DISTANCE");
    expect(feature.properties.exists).toBe(true);
    expect(feature.properties.distance_meters).toBe(100);
    expect(feature.properties.layer_id).toBe("water");
    expect(feature.properties.layer_version_hash).toBe(
      spatialEvidence.payload.layer_ref.version_hash,
    );
    expect(feature.properties.cas_artifact_id).toBe(spatialEvidence.artifact_id);
    expect(feature.properties.governance_status).toBe("VERIFIED_OBSERVATION");
    expect(feature.properties.viewer_capability_id).toBe(viewerCapability.artifact_id);
    expect(feature.properties.viewer_release_hash).toBe(VIEWER_RELEASE_HASH);
    expect(
      feature.properties.viewer_identity_ref,
      "F8: the exported observation must name WHO held the capability. Without it the export " +
        "is attributable to a capability but to no observer.",
    ).toBe(VIEWER_IDENTITY.artifact_id);
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
