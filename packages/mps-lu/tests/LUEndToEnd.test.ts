import { describe, it, expect, beforeAll } from "vitest";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";
import { LokeIngestor, InMemoryQuarantineStorage } from "../src/loke/LokeIngestor";
import { DocumentEvidenceMaterializer } from "../src/loke/QuarantinePromoter";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import {
  buildVerifiedPriorDecisionFact,
  withFactRef,
} from "./fixtures/verifiedDocumentFact";
import type { VerifiedDocumentFactArtifact } from "../../mps-data-governance/src/DocumentFactArtifact";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

describe("First Verified Capability: LU End-to-End Fusion", () => {
  let casRepo: any;
  let documentEvidence: DocumentEvidenceArtifact;
  let verifiedFact: VerifiedDocumentFactArtifact;
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
    // A1 ENFORCEMENT (2026-08-11): the materializer no longer takes a repository and no
    // longer persists. The kernel below receives the artifact by value, which it already did.
    const promoter = new DocumentEvidenceMaterializer(quarantine);

    const rawDoc = await ingestor.ingestFile(filePath, "Länsstyrelsen", "Policy-v1");
    documentEvidence = await promoter.materialize(rawDoc.artifact_id, "prop-fusion", "doc-fusion", "BESLUT");

    // E2E FIXTURE RECONCILIATION 2026-08-13: Tier 3 classifies and verifies the fact, and the
    // evidence references it. This step did not exist when the fixture was written — the rule
    // was reached through the document text instead, which the frozen model now forbids.
    verifiedFact = buildVerifiedPriorDecisionFact("fusion");
    documentEvidence = withFactRef(documentEvidence, verifiedFact);

    // 3. Generate Spatial Evidence (PostGIS -> CAS)
    spatialEvidence = {
      artifact_id: "spatial-fusion-1",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "dummy_hash_for_test" },
      references: [{ artifact_id: "prop-fusion", artifact_type: "PROPERTY" }],
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-fusion", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: "prop-fusion", artifact_type: "PROPERTY" },
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
      verified_document_facts: [verifiedFact],
      repo: casRepo,
    });

    expect(kernelResult.admitted).toBe(true);

    // We expect both the water rule and the document decision rule to hit
    expect(kernelResult.findings).toHaveLength(2);

    const ruleIds = kernelResult.findings.map(f => f.rule_id);
    expect(ruleIds).toContain("LU-WATER-001");
    // Reached through the verified Tier 3 fact referenced by the evidence — NOT because the
    // text contains "Risk" or "avslag". The previous criterion asserted the forbidden path.
    expect(ruleIds).toContain("LU-DOC-BESLUT-001");

    const docFinding = kernelResult.findings.find(f => f.rule_id === "LU-DOC-BESLUT-001")!;
    expect(
      docFinding.evidence_refs.map(r => r.artifact_id),
      "The finding must bind back to the verified fact, or the fusion outcome cannot be traced " +
        "to the legal basis it rests on.",
    ).toContain(verifiedFact.artifact_id);

    // We can also verify the final execution outcome exists in CAS
    expect(kernelResult.outcome_id).toBeDefined();
    const outcomeArtifact = await casRepo.resolve({ artifact_id: kernelResult.outcome_id, artifact_type: "execution_outcome" });
    expect(outcomeArtifact).toBeDefined();
  });
});
