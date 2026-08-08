import { describe, it, expect, beforeAll } from "vitest";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";
import { LokeIngestor, InMemoryQuarantineStorage } from "../src/loke/LokeIngestor";
import { QuarantinePromoter } from "../src/loke/QuarantinePromoter";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

describe("First Verified Capability: LU End-to-End Fusion", () => {
  let casRepo: any;
  let documentEvidence: DocumentEvidenceArtifact;
  let spatialEvidence: SpatialEvidenceArtifact;

  beforeAll(async () => {
    // 1. Setup CAS
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;

    // 2. Generate Document Evidence (L1 -> CAS)
    const archivePath = join(process.cwd(), "tests", "fixtures", "EndToEnd", "Case_Fusion");
    const filePath = join(archivePath, "original", "beslut.txt");
    await mkdir(join(archivePath, "original"), { recursive: true });
    await writeFile(filePath, "Avslag: Risk för spridning av EBH till vattentäkt", "utf8");

    const quarantine = new InMemoryQuarantineStorage();
    const ingestor = new LokeIngestor(quarantine);
    const promoter = new QuarantinePromoter(quarantine, casRepo);

    const rawDoc = await ingestor.ingestFile(filePath, "Länsstyrelsen", "Policy-v1");
    documentEvidence = await promoter.promote(rawDoc.artifact_id, "prop-fusion", "doc-fusion", "BESLUT");

    // 3. Generate Spatial Evidence (PostGIS -> CAS)
    spatialEvidence = {
      artifact_id: "spatial-fusion-1",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "dummy_hash_for_test" },
      references: [{ artifact_id: "prop-fusion", artifact_type: "PROPERTY" }],
      payload: {
        geometry: { type: "Polygon", coordinates: [] },
        srid: 3006,
        operation: { algorithm: "ST_DWithin", engine: "PostGIS", engine_fingerprint: {} },
        layer_ref: { layer_id: "water", layer_version: "v1" },
        source_metadata: { provider: "Naturvårdsverket", dataset: "water", dataset_version: "v1", retrieved_at: new Date().toISOString() },
        query_context: { query_id: "q1", query_type: "SPATIAL_DWITHIN", parameters: { property_ref: { artifact_id: "prop-fusion", artifact_type: "PROPERTY" }, search_distance_meters: 100 } }
      }
    };

    // Fysisk invariant: Skriv till CAS
    await casRepo.put({
      artifact_id: spatialEvidence.artifact_id,
      content_hash: spatialEvidence.content_hash,
      body: spatialEvidence
    });
  });

  it("should fuse Document and Spatial evidence into a final Assessment outcome", async () => {
    // Execute LU kernel with BOTH types of evidence
    const kernelResult = await runLuAssessmentViaKernel({
      site_id: "fusion-site",
      deterministic_seed: "seed:fusion",
      evidence: [spatialEvidence],
      document_evidence: [documentEvidence],
      repo: casRepo,
    });

    expect(kernelResult.admitted).toBe(true);
    
    // We expect both the water rule and the document decision rule to hit
    expect(kernelResult.findings).toHaveLength(2);
    
    const ruleIds = kernelResult.findings.map(f => f.rule_id);
    expect(ruleIds).toContain("LU-WATER-001");
    expect(ruleIds).toContain("LU-DOC-BESLUT-001"); // Because "Risk" or "avslag" was in the text

    // We can also verify the final execution outcome exists in CAS
    expect(kernelResult.outcome_id).toBeDefined();
    const outcomeArtifact = await casRepo.resolve({ artifact_id: kernelResult.outcome_id, artifact_type: "execution_outcome" });
    expect(outcomeArtifact).toBeDefined();
  });
});
