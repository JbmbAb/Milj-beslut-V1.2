/**
 * Canonical identity — version in hash domain (C-02)
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidenceSetIdentityPayload,
  hashVersionedCanonicalPayload,
} from "../../mps-decision-governance/src/index.js";
import { MaterializationPipeline, type VerifiedEvidenceSet } from "../src/index.js";

describe("CanonicalIdentity", () => {
  it("C-02: dg-canonical-1 payload ≠ dg-canonical-2 payload hash", () => {
    const identity = {
      documents: [{ document_hash: "doc-A" }],
      schema_version: 1,
      lineage_sequence: 1,
      lineage_scope: {
        jurisdiction_level: "MUNICIPALITY" as const,
        decision_type: "WASTEWATER" as const,
      },
    };
    const payload = buildEvidenceSetIdentityPayload(identity);
    expect(hashVersionedCanonicalPayload(payload, "dg-canonical-1")).not.toBe(
      hashVersionedCanonicalPayload(payload, "dg-canonical-2"),
    );
  });

  it("materializer embeds canonical_version from decision-governance", () => {
    const evidence: VerifiedEvidenceSet = {
      source_artifact_hashes: ["sha256:dddddddd"],
      jurisdiction_level: "MUNICIPALITY",
      decision_type: "BUILDING_PERMIT",
      municipality_code: "1480",
      verified_attributes: { count: 2 },
    };
    const result = new MaterializationPipeline().materialize(evidence);
    expect(result.versions.canonical_version).toBe("dg-canonical-1");
    expect(result.versions.materialization_version).toBe("mat-1");
    expect(result.versions.rule_version).toBe("rules-1");
  });
});
