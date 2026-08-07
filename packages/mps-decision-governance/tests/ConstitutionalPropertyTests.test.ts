/**
 * Constitutional property tests — Decision Knowledge / Materialization readiness
 * 1. Serializer stability
 * 2. Canonical idempotence
 * 3. Materialization determinism
 */
import { describe, expect, it } from "vitest";
import {
  buildDecisionImpactIdentityPayload,
  buildEvidenceSetIdentityPayload,
  DECISION_GOVERNANCE_CANONICAL_VERSION,
  deserializeCanonicalPayload,
  hashDecisionImpactIdentity,
  hashEvidenceSetIdentity,
  hashVersionedCanonicalPayload,
  serializeCanonicalPayload,
} from "../src/CanonicalDecisionImpactHash";
import { InMemoryDecisionKnowledgeRepository } from "../src/DecisionKnowledgeRepository";
import { DeterministicMaterializationPipeline } from "../src/MaterializationPipeline";
import type { CanonicalMaterializationSource } from "../src/MaterializationContract";
import type { DecisionImpactIdentity } from "../src/DecisionImpactIdentity";
import type { EvidenceSetIdentity } from "../src/EvidenceSetArtifact";

const evidenceIdentity: EvidenceSetIdentity = {
  documents: [
    { document_hash: "doc-b" },
    { document_hash: "doc-a" },
  ],
  schema_version: 1,
  lineage_sequence: 1,
  lineage_scope: {
    jurisdiction_level: "MUNICIPALITY",
    decision_type: "WASTEWATER",
  },
};

const impactIdentity: DecisionImpactIdentity = {
  jurisdiction_level: "MUNICIPALITY",
  decision_type: "WASTEWATER",
  municipality_code: "2062",
  evidence_set_hashes: ["ev-1", "ev-2"],
  indicators: [
    {
      code: "WW-01",
      description: "Count",
      value: 3,
      unit: "pcs",
      confidence: "HIGH",
      derivation: "COUNT",
    },
  ],
  schema_version: 1,
  derivation_version: "ww-v1",
};

const source: CanonicalMaterializationSource = {
  source_document_hashes: ["raw-a", "raw-b"],
  jurisdiction_level: "COUNTY",
  decision_type: "WASTEWATER",
  county_code: "17",
  derivation_version: "ww-v1",
  schema_version: 1,
  decision_facts: {
    summary: "Avloppsutveckling Värmland",
    count: 17,
  },
  indicator: {
    code: "WW-TREND",
    description: "Wastewater case trend",
    value: 17,
    unit: "pcs",
    confidence: "HIGH",
    derivation: "AGGREGATION",
  },
};

describe("Constitutional property tests — serializer / canonical / materialize", () => {
  it("Serializer stability: hash(I) == hash(deserialize(serialize(I)))", () => {
    const payload = buildEvidenceSetIdentityPayload(evidenceIdentity);
    const serialized = serializeCanonicalPayload(payload);
    const roundtrip = deserializeCanonicalPayload(serialized) as Record<string, unknown>;

    expect(hashVersionedCanonicalPayload(roundtrip)).toBe(
      hashVersionedCanonicalPayload(payload),
    );
    expect(hashEvidenceSetIdentity(evidenceIdentity)).toBe(
      hashVersionedCanonicalPayload(roundtrip),
    );

    const impactPayload = buildDecisionImpactIdentityPayload(impactIdentity);
    const impactRoundtrip = deserializeCanonicalPayload(
      serializeCanonicalPayload(impactPayload),
    );
    expect(hashVersionedCanonicalPayload(impactRoundtrip)).toBe(
      hashDecisionImpactIdentity(impactIdentity),
    );
  });

  it("Canonical idempotence: canonical(canonical(I)) == canonical(I)", () => {
    const payload = buildEvidenceSetIdentityPayload(evidenceIdentity);
    const once = serializeCanonicalPayload(payload);
    const twice = serializeCanonicalPayload(deserializeCanonicalPayload(once));
    expect(twice).toBe(once);

    const impactOnce = serializeCanonicalPayload(
      buildDecisionImpactIdentityPayload(impactIdentity),
    );
    const impactTwice = serializeCanonicalPayload(
      deserializeCanonicalPayload(impactOnce),
    );
    expect(impactTwice).toBe(impactOnce);
  });

  it("Materialization determinism: materialize(raw) == materialize(raw)", () => {
    const repoA = new InMemoryDecisionKnowledgeRepository();
    const repoB = new InMemoryDecisionKnowledgeRepository();
    const pipeA = new DeterministicMaterializationPipeline({ repository: repoA });
    const pipeB = new DeterministicMaterializationPipeline({ repository: repoB });

    const a1 = pipeA.materialize(source);
    const a2 = pipeA.materialize(source); // CAS reuse
    const b1 = pipeB.materialize(source);

    expect(a1.status).toBe("CREATED");
    expect(a2.status).toBe("REUSED");
    expect(b1.status).toBe("CREATED");

    expect(a1.impact_id).toBe(a2.impact_id);
    expect(a1.impact_id).toBe(b1.impact_id);
    expect(a1.canonical_payload).toBe(b1.canonical_payload);
    expect(a1.canonical_payload).toBe(a2.canonical_payload);

    // Byte-identical canonical payload across independent pipelines.
    expect(Buffer.from(a1.canonical_payload, "utf8").equals(
      Buffer.from(b1.canonical_payload, "utf8"),
    )).toBe(true);
  });

  it("canonical_version is inside the hash domain (not sidecar metadata)", () => {
    const payload = buildEvidenceSetIdentityPayload(evidenceIdentity);
    const v1 = hashVersionedCanonicalPayload(payload, "dg-canonical-1");
    const v2 = hashVersionedCanonicalPayload(payload, "dg-canonical-2");
    expect(v1).not.toBe(v2);
    expect(hashEvidenceSetIdentity(evidenceIdentity)).toBe(v1);
    expect(DECISION_GOVERNANCE_CANONICAL_VERSION).toBe("dg-canonical-1");
  });
});
