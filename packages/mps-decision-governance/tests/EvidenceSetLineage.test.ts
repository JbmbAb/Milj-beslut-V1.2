// packages/mps-decision-governance/tests/EvidenceSetLineage.test.ts

import { describe, test, expect, beforeEach } from "vitest";
import {
  validateEvidenceSetLineage,
  EvidenceSetLineageError,
  EvidenceSetLineageResolver,
} from "../src/validation/validateEvidenceSetLineage";
import type { EvidenceSetArtifact } from "../src/EvidenceSetArtifact";

const makeArtifact = (
  hash: string,
  seq: number,
  prev?: string,
): EvidenceSetArtifact => ({
  evidence_set_hash: hash,
  identity: {
    documents: [{ document_hash: "d1" }, { document_hash: "d2" }],
    schema_version: 1,
    lineage_sequence: seq,
    previous_evidence_set_hash: prev,
    lineage_scope: {
      jurisdiction_level: "MUNICIPALITY",
      decision_type: "WASTEWATER",
    },
  },
  metadata: {
    created_at: "2026-01-01T00:00:00.000Z",
    materialization_version: "v1",
    generated_by: "test",
  },
});

describe("EvidenceSetLineage validation", () => {
  const store = new Map<string, EvidenceSetArtifact>();
  const resolver: EvidenceSetLineageResolver = {
    resolve(hash: string) {
      return store.get(hash);
    },
  };

  beforeEach(() => {
    store.clear();
  });

  test("valid append chain A → B → C", () => {
    const a = makeArtifact("A", 1);
    const b = makeArtifact("B", 2, "A");
    const c = makeArtifact("C", 3, "B");

    store.set("A", a);
    store.set("B", b);
    store.set("C", c);

    expect(() => validateEvidenceSetLineage(a, resolver)).not.toThrow();
    expect(() => validateEvidenceSetLineage(b, resolver)).not.toThrow();
    expect(() => validateEvidenceSetLineage(c, resolver)).not.toThrow();
  });

  test("missing previous → error", () => {
    const b = makeArtifact("B", 2, "X");

    expect(() => validateEvidenceSetLineage(b, resolver)).toThrow(
      EvidenceSetLineageError,
    );
  });

  test("self reference → error", () => {
    const a = makeArtifact("A", 1, "A");
    store.set("A", a);

    expect(() => validateEvidenceSetLineage(a, resolver)).toThrow(
      EvidenceSetLineageError,
    );
  });

  test("scope mismatch → error", () => {
    const a: EvidenceSetArtifact = {
      evidence_set_hash: "A",
      identity: {
        documents: [{ document_hash: "d1" }],
        schema_version: 1,
        lineage_sequence: 1,
        previous_evidence_set_hash: undefined,
        lineage_scope: {
          jurisdiction_level: "MUNICIPALITY",
          decision_type: "WASTEWATER",
        },
      },
      metadata: {
        created_at: "2026-01-01T00:00:00.000Z",
        materialization_version: "v1",
        generated_by: "test",
      },
    };

    const b: EvidenceSetArtifact = {
      evidence_set_hash: "B",
      identity: {
        documents: [{ document_hash: "d1" }],
        schema_version: 1,
        lineage_sequence: 2,
        previous_evidence_set_hash: "A",
        lineage_scope: {
          jurisdiction_level: "MUNICIPALITY",
          decision_type: "BUILDING_PERMIT",
        },
      },
      metadata: {
        created_at: "2026-01-01T00:00:00.000Z",
        materialization_version: "v1",
        generated_by: "test",
      },
    };

    store.set("A", a);
    store.set("B", b);

    expect(() => validateEvidenceSetLineage(b, resolver)).toThrow(
      EvidenceSetLineageError,
    );
  });

  test("sequence regression → error", () => {
    const a = makeArtifact("A", 10);
    const b = makeArtifact("B", 9, "A");

    store.set("A", a);
    store.set("B", b);

    expect(() => validateEvidenceSetLineage(b, resolver)).toThrow(
      EvidenceSetLineageError,
    );
  });
});
