import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LokeIngestor, InMemoryQuarantineStorage } from "../src/loke/LokeIngestor";
import { DocumentEvidenceMaterializer } from "../src/loke/QuarantinePromoter";

/**
 * ✅ F4B-0B — DocumentEvidence `references` CONTRACT GREEN PROOF.
 *
 *   `references` is declared REQUIRED by ArtifactContract
 *   (packages/mps-compliance/src/artifacts/ArtifactContract.ts:22). It is the artifact-level
 *   provenance edge set — what makes the evidence graph traversable and replay verifiable.
 *   Compliance validators read it directly: REPLAY_23_I1, REPLAY_23_I5, EXE_25_I5, EXE_25_I7,
 *   CAP_26_I3, CAP_26_I5.
 *
 *   Decision (step 2 of the work unit): MANDATORY by contract, DERIVED from the payload —
 *   never a separate input. Every edge already exists in the payload, so accepting it as a
 *   parameter would let the declared provenance disagree with the actual derivation.
 *
 *   Scope: this proves the provenance edge set only. It does NOT prove LU-DOC-BESLUT-001,
 *   which remains blocked behind F4B.
 *
 *   @see docs/architecture/F4B-DOCUMENT-FACT-MODEL-CHECK-2026-08-12.md
 */
describe("F4B-0B — DocumentEvidence references contract (GREEN PROOF)", () => {
  async function materialize() {
    const dir = await mkdtemp(join(tmpdir(), "f4b0b-"));
    const filePath = join(dir, "beslut.txt");
    await writeFile(filePath, "Avslag: risk för spridning till vattentäkt", "utf8");

    const quarantine = new InMemoryQuarantineStorage();
    const ingestor = new LokeIngestor(quarantine);
    const materializer = new DocumentEvidenceMaterializer(quarantine);

    const raw = await ingestor.ingestFile(filePath, "Länsstyrelsen", "Policy-v1");
    const evidence = await materializer.materialize(
      raw.artifact_id,
      "prop-f4b0b",
      "doc-f4b0b",
      "BESLUT",
    );
    return { evidence, raw };
  }

  it("references is present and non-empty — the artifact is not provenance-orphaned", async () => {
    const { evidence } = await materialize();

    expect(
      Array.isArray(evidence.references),
      "F4B-0B: references is required by ArtifactContract; compliance validators read it to " +
        "verify the evidence graph and replay chain.",
    ).toBe(true);
    expect(evidence.references.length).toBeGreaterThan(0);
  });

  it("every declared edge is derived from the payload — declared provenance cannot disagree with actual", async () => {
    const { evidence } = await materialize();
    const payload = evidence.payload;

    const payloadEdges = [payload.property_ref, payload.document_ref, payload.raw_source_ref]
      .filter((r) => r !== undefined)
      .map((r) => `${r!.artifact_type}:${r!.artifact_id}`)
      .sort();

    const declaredEdges = evidence.references
      .map((r) => `${r.artifact_type}:${r.artifact_id}`)
      .sort();

    expect(
      declaredEdges,
      "F4B-0B: references is DERIVED, not supplied. If these diverge, the artifact declares a " +
        "provenance it does not actually have.",
    ).toEqual(payloadEdges);
  });

  it("the chain back to the preserved Tier 2 original is traversable", async () => {
    const { evidence, raw } = await materialize();

    const rawEdge = evidence.references.find((r) => r.artifact_id === raw.artifact_id);

    expect(
      rawEdge,
      "F4B-0B: the raw source edge is what keeps the chain back to the preserved original " +
        "traversable. Without it the evidence cannot be traced to Tier 2.",
    ).toBeDefined();
    expect(rawEdge!.artifact_type).toBe("RAW_SOURCE_ARTIFACT");
  });

  it("the subject property and document are both declared as edges", async () => {
    const { evidence } = await materialize();
    const ids = evidence.references.map((r) => r.artifact_id);

    expect(ids).toContain("prop-f4b0b");
    expect(ids).toContain("doc-f4b0b");
  });

  it("references carries only identity — no payload is copied into the edge set", async () => {
    const { evidence } = await materialize();

    for (const ref of evidence.references) {
      expect(
        Object.keys(ref).sort(),
        "F4B-0B: an ArtifactReference carries identity and never creates or duplicates it. " +
          "Copying payload into the edge set would make the graph a second source of truth.",
      ).toEqual(["artifact_id", "artifact_type"]);
    }
  });
});
