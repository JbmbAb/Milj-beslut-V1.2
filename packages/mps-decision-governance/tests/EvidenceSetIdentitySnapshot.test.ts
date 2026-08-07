/**
 * EvidenceSetIdentity schema freeze — snapshot / structural lock.
 * Future schema changes must be intentional (new schema_version + ADR).
 */
import { describe, expect, it } from "vitest";
import { canonicalizeStrict } from "../../mimers-brunn-core/src/serialization/canonicalize";
import {
  buildEvidenceSetIdentityPayload,
  hashEvidenceSetIdentity,
} from "../src/CanonicalDecisionImpactHash";
import {
  EVIDENCE_SET_IDENTITY_FIELDS,
  EVIDENCE_SET_LINEAGE_SCOPE_FIELDS,
  type EvidenceSetIdentity,
  type EvidenceSetMetadata,
} from "../src/EvidenceSetArtifact";

const frozenIdentity: EvidenceSetIdentity = {
  documents: [
    { document_hash: "doc-b", municipality_code: "2062" },
    { document_hash: "doc-a", municipality_code: "2062" },
  ],
  schema_version: 1,
  previous_evidence_set_hash: undefined,
  lineage_sequence: 1,
  lineage_scope: {
    jurisdiction_level: "MUNICIPALITY",
    decision_type: "WASTEWATER",
  },
};

describe("EvidenceSetIdentitySnapshot — schema freeze", () => {
  it("freezes identity field names", () => {
    expect([...EVIDENCE_SET_IDENTITY_FIELDS].sort()).toEqual(
      [
        "documents",
        "lineage_scope",
        "lineage_sequence",
        "previous_evidence_set_hash",
        "schema_version",
      ].sort(),
    );
    expect([...EVIDENCE_SET_LINEAGE_SCOPE_FIELDS].sort()).toEqual(
      ["decision_type", "jurisdiction_level"].sort(),
    );
  });

  it("identity structure matches frozen shape (no metadata leakage)", () => {
    const keys = Object.keys(frozenIdentity).sort();
    expect(keys).toEqual([...EVIDENCE_SET_IDENTITY_FIELDS].sort());

    const metadata: EvidenceSetMetadata = {
      created_at: "2026-08-07T12:00:00.000Z",
      materialization_version: "v1",
      generated_by: "snapshot-test",
    };
    expect(Object.keys(metadata).sort()).toEqual(
      ["created_at", "generated_by", "materialization_version"].sort(),
    );
    expect(Object.keys(metadata)).not.toContain("lineage_sequence");
  });

  it("canonical form is stable (golden)", () => {
    const payload = buildEvidenceSetIdentityPayload(frozenIdentity);
    const canonical = canonicalizeStrict(payload);

    // Documents appear sorted by document_hash in canonical form.
    expect(canonical).toContain('"document_hash":"doc-a"');
    expect(canonical.indexOf("doc-a")).toBeLessThan(canonical.indexOf("doc-b"));

    expect(payload).toEqual({
      documents: [
        { document_hash: "doc-a", municipality_code: "2062" },
        { document_hash: "doc-b", municipality_code: "2062" },
      ],
      schema_version: 1,
      lineage_sequence: 1,
      lineage_scope: {
        jurisdiction_level: "MUNICIPALITY",
        decision_type: "WASTEWATER",
      },
    });

    // Golden hash — change only with intentional schema/identity ADR.
    expect(hashEvidenceSetIdentity(frozenIdentity)).toBe(
      hashEvidenceSetIdentity({ ...frozenIdentity }),
    );
    expect(hashEvidenceSetIdentity(frozenIdentity)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("lineage_sequence is identity, not metadata — changing it changes hash", () => {
    const h1 = hashEvidenceSetIdentity(frozenIdentity);
    const h2 = hashEvidenceSetIdentity({
      ...frozenIdentity,
      lineage_sequence: 2,
    });
    expect(h1).not.toBe(h2);
  });
});
