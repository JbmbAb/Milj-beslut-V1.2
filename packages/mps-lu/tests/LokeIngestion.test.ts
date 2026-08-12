import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { LokeIngestor, InMemoryQuarantineStorage } from "../src/loke/LokeIngestor";
import { DocumentEvidenceMaterializer } from "../src/loke/QuarantinePromoter";
import { MimersIntegration } from "../../mps-runtime/src/mimers";

describe("L1 Document Ingestion (TV-L1)", () => {
  const archivePath = join(process.cwd(), "tests", "fixtures", "National_Archive", "VISS", "2024", "Karlstad", "Case_123");
  const filePath = join(archivePath, "original", "beslut_grundvatten.txt");

  beforeAll(async () => {
    await mkdir(join(archivePath, "original"), { recursive: true });
    await writeFile(filePath, "Beslut rörande grundvattenuttag i Karlstad...", "utf8");
  });

  it("should enforce the L1 chain: Source -> Loke -> Quarantine -> CAS", async () => {
    // 1. Setup
    const quarantine = new InMemoryQuarantineStorage();
    const mimers = await MimersIntegration.create();
    const cas = mimers.artifactRepository;
    const ingestor = new LokeIngestor(quarantine);
    const promoter = new DocumentEvidenceMaterializer(quarantine);

    // 2. Loke observes and ingests (Source -> Quarantine)
    const rawArtifact = await ingestor.ingestFile(filePath, "VISS", "MimersBrunn-v2.0.1");
    
    expect(rawArtifact.artifact_type).toBe("RAW_SOURCE_ARTIFACT");
    expect(rawArtifact.payload.authority).toBe("VISS");
    expect(rawArtifact.payload.policy).toBe("MimersBrunn-v2.0.1");

    // 3. Verify it is in Quarantine, NOT CAS
    const inQuarantine = await quarantine.get(rawArtifact.artifact_id);
    expect(inQuarantine).toBeDefined();

    await expect(
      cas.resolve({ artifact_id: rawArtifact.artifact_id, artifact_type: "RAW_SOURCE_ARTIFACT" })
    ).rejects.toThrow(); // Should not exist in CAS

    // 4. LU materializes DOCUMENT_EVIDENCE from the quarantined bytes.
    //    A1 ENFORCEMENT (2026-08-11): this step no longer persists. LU holds no write
    //    capability; canonical persistence requires the governed promotion path and a
    //    verified attestation. See tests/A1AuthorityEnforcement.test.ts.
    const evidenceArtifact = await promoter.materialize(
      rawArtifact.artifact_id,
      "prop-karlstad", // property_ref
      "doc-123",       // document_ref
      "BESLUT"         // type
    );

    expect(evidenceArtifact.artifact_type).toBe("DOCUMENT_EVIDENCE");
    expect(evidenceArtifact.payload.raw_source_ref?.artifact_id).toBe(rawArtifact.artifact_id);
    expect(evidenceArtifact.payload.relevant_document.text_content).toContain(
      "grundvattenuttag i Karlstad",
    );

    // 5. The chain stops at materialization: still NOT in CAS. This assertion previously
    //    read "verify it now exists in CAS" — that expectation encoded the authority bypass.
    await expect(
      cas.resolve({ artifact_id: evidenceArtifact.artifact_id, artifact_type: "DOCUMENT_EVIDENCE" }),
    ).rejects.toThrow();
  });
});
