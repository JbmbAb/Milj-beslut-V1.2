// packages/mps-decision-governance/tests/DecisionImpactIdentityHash.test.ts

import { describe, test, expect } from "vitest";
import { hashEvidenceSetIdentity, hashDecisionImpactIdentity } from "../src/CanonicalDecisionImpactHash";
import type { EvidenceSetIdentity } from "../src/EvidenceSetArtifact";
import type { DecisionImpactIdentity } from "../src/DecisionImpactIdentity";

describe("DecisionImpactIdentity & EvidenceSet Hash Determinism", () => {
  
  // -------------------------------------------------------------------------
  // EvidenceSet Hashing Tests
  // -------------------------------------------------------------------------
  describe("hashEvidenceSetIdentity", () => {
    const id1: EvidenceSetIdentity = {
      documents: [
        { document_hash: "hash-A" },
        { document_hash: "hash-B" }
      ],
      schema_version: 1,
      lineage_sequence: 5,
      previous_evidence_set_hash: "prev-hash-999"
    };

    test("same facts produce identical hash", () => {
      const h1 = hashEvidenceSetIdentity(id1);
      const h2 = hashEvidenceSetIdentity({ ...id1 });
      expect(h1).toBe(h2);
    });

    test("order of documents does not change identity (Order-Tolerance)", () => {
      const id2: EvidenceSetIdentity = {
        ...id1,
        documents: [
          { document_hash: "hash-B" },
          { document_hash: "hash-A" }
        ]
      };

      const h1 = hashEvidenceSetIdentity(id1);
      const h2 = hashEvidenceSetIdentity(id2);
      expect(h1).toBe(h2); // Måste matcha trots olika fältordning!
    });

    test("different facts produce different hash", () => {
      const id2: EvidenceSetIdentity = {
        ...id1,
        lineage_sequence: 6 // Förändrad sekvens
      };

      const h1 = hashEvidenceSetIdentity(id1);
      const h2 = hashEvidenceSetIdentity(id2);
      expect(h1).not.toBe(h2);
    });
  });

  // -------------------------------------------------------------------------
  // DecisionImpact Hashing Tests
  // -------------------------------------------------------------------------
  describe("hashDecisionImpactIdentity", () => {
    const id1: DecisionImpactIdentity = {
      jurisdiction_level: "MUNICIPALITY",
      decision_type: "WASTEWATER",
      municipality_code: "1480",
      period_start: "2026-01-01T00:00:00Z",
      period_end: "2026-06-30T23:59:59Z",
      evidence_set_hashes: ["ev-hash-1", "ev-hash-2"],
      indicators: [
        {
          code: "IND-01",
          description: "Total permit count",
          value: 42,
          unit: "pcs",
          confidence: "HIGH",
          derivation: "COUNT"
        },
        {
          code: "IND-02",
          description: "Total wastewater discharge",
          value: 12000.5,
          unit: "m3",
          confidence: "MEDIUM",
          derivation: "AGGREGATION"
        }
      ],
      schema_version: 1,
      derivation_version: "ww-risk-model-2.0"
    };

    test("same facts produce identical hash", () => {
      const h1 = hashDecisionImpactIdentity(id1);
      const h2 = hashDecisionImpactIdentity({ ...id1 });
      expect(h1).toBe(h2);
    });

    test("order of indicators and evidence set hashes does not change identity (Order-Tolerance)", () => {
      const id2: DecisionImpactIdentity = {
        ...id1,
        evidence_set_hashes: ["ev-hash-2", "ev-hash-1"], // Omkastad ordning
        indicators: [
          {
            code: "IND-02",
            description: "Total wastewater discharge",
            value: 12000.5,
            unit: "m3",
            confidence: "MEDIUM",
            derivation: "AGGREGATION"
          },
          {
            code: "IND-01",
            description: "Total permit count",
            value: 42,
            unit: "pcs",
            confidence: "HIGH",
            derivation: "COUNT"
          }
        ] // Omkastad ordning
      };

      const h1 = hashDecisionImpactIdentity(id1);
      const h2 = hashDecisionImpactIdentity(id2);
      expect(h1).toBe(h2); // Identiska hashar trots ordningsvariation!
    });

    test("different facts produce different hash", () => {
      const id2: DecisionImpactIdentity = {
        ...id1,
        derivation_version: "ww-risk-model-2.1" // Ändrad algoritmversion
      };

      const h1 = hashDecisionImpactIdentity(id1);
      const h2 = hashDecisionImpactIdentity(id2);
      expect(h1).not.toBe(h2);
    });
  });
});
