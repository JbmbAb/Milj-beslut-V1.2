/**
 * EvidenceSet lineage fork + chain property tests.
 * LINEAGE_SEQUENCE_REGRESSION | SELF_REFERENCING | SCOPE_MISMATCH | FORK_DETECTED
 */
import { describe, expect, it } from "vitest";
import { hashEvidenceSetIdentity } from "../src/CanonicalDecisionImpactHash";
import type { EvidenceSetArtifact, EvidenceSetIdentity } from "../src/EvidenceSetArtifact";
import {
  EvidenceSetLineageError,
  InMemoryEvidenceSetLineageStore,
  validateEvidenceSetLineage,
} from "../src/validation/validateEvidenceSetLineage";

function makeIdentity(
  partial: Partial<EvidenceSetIdentity> &
    Pick<EvidenceSetIdentity, "lineage_sequence"> & {
      previous_evidence_set_hash?: string;
    },
): EvidenceSetIdentity {
  return {
    documents: partial.documents ?? [
      { document_hash: "d1", municipality_code: "2062" },
    ],
    schema_version: partial.schema_version ?? 1,
    previous_evidence_set_hash: partial.previous_evidence_set_hash,
    lineage_sequence: partial.lineage_sequence,
    lineage_scope: partial.lineage_scope ?? {
      jurisdiction_level: "MUNICIPALITY",
      decision_type: "WASTEWATER",
    },
  };
}

function makeArtifact(identity: EvidenceSetIdentity): EvidenceSetArtifact {
  const evidence_set_hash = hashEvidenceSetIdentity(identity);
  return {
    evidence_set_hash,
    identity: {
      ...identity,
      // Ensure stored previous matches identity used for hash
    },
    metadata: {
      created_at: "2026-08-07T12:00:00.000Z",
      materialization_version: "v1",
      generated_by: "lineage-fork-test",
    },
  };
}

describe("EvidenceSetLineageFork", () => {
  it("accepts monotonic chain A(1) → B(2) → C(3)", () => {
    const store = new InMemoryEvidenceSetLineageStore();
    const a = makeArtifact(makeIdentity({ lineage_sequence: 1 }));
    const b = makeArtifact(
      makeIdentity({
        lineage_sequence: 2,
        previous_evidence_set_hash: a.evidence_set_hash,
      }),
    );
    const c = makeArtifact(
      makeIdentity({
        lineage_sequence: 3,
        previous_evidence_set_hash: b.evidence_set_hash,
      }),
    );

    expect(() => store.append(a)).not.toThrow();
    expect(() => store.append(b)).not.toThrow();
    expect(() => store.append(c)).not.toThrow();
  });

  it("rejects sequence regression → LINEAGE_SEQUENCE_REGRESSION", () => {
    const store = new InMemoryEvidenceSetLineageStore();
    const a = makeArtifact(makeIdentity({ lineage_sequence: 1 }));
    const b = makeArtifact(
      makeIdentity({
        lineage_sequence: 3,
        previous_evidence_set_hash: a.evidence_set_hash,
      }),
    );
    store.append(a);
    store.append(b);

    const c = makeArtifact(
      makeIdentity({
        lineage_sequence: 2,
        previous_evidence_set_hash: b.evidence_set_hash,
      }),
    );

    expect(() => store.append(c)).toThrow(EvidenceSetLineageError);
    try {
      store.append(c);
    } catch (e) {
      expect((e as EvidenceSetLineageError).code).toBe("LINEAGE_SEQUENCE_REGRESSION");
    }
  });

  it("rejects self-reference → SELF_REFERENCING_EVIDENCE_SET", () => {
    // Build identity that points previous_hash at its own resulting hash.
    // Iterate: hash without previous, then set previous to that hash — but that
    // changes identity. True self-ref: evidence_set_hash === previous_hash after
    // external assignment (tamper) as governance check.
    const base = makeIdentity({ lineage_sequence: 1 });
    const hash = hashEvidenceSetIdentity(base);
    const selfRef: EvidenceSetArtifact = {
      evidence_set_hash: hash,
      identity: {
        ...base,
        previous_evidence_set_hash: hash,
      },
      metadata: {
        created_at: "2026-08-07T12:00:00.000Z",
        materialization_version: "v1",
        generated_by: "test",
      },
    };

    const store = new InMemoryEvidenceSetLineageStore();
    // Seed the hash so previous resolves to "itself"
    store.append({
      ...selfRef,
      identity: { ...base, previous_evidence_set_hash: undefined },
    });

    expect(() => validateEvidenceSetLineage(selfRef, store)).toThrow(
      EvidenceSetLineageError,
    );
    try {
      validateEvidenceSetLineage(selfRef, store);
    } catch (e) {
      expect((e as EvidenceSetLineageError).code).toBe("SELF_REFERENCING_EVIDENCE_SET");
    }
  });

  it("rejects scope drift → LINEAGE_SCOPE_MISMATCH", () => {
    const store = new InMemoryEvidenceSetLineageStore();
    const a = makeArtifact(
      makeIdentity({
        lineage_sequence: 1,
        lineage_scope: {
          jurisdiction_level: "MUNICIPALITY",
          decision_type: "WASTEWATER",
        },
      }),
    );
    store.append(a);

    const b = makeArtifact(
      makeIdentity({
        lineage_sequence: 2,
        previous_evidence_set_hash: a.evidence_set_hash,
        lineage_scope: {
          jurisdiction_level: "MUNICIPALITY",
          decision_type: "BUILDING_PERMIT",
        },
      }),
    );

    expect(() => store.append(b)).toThrow(EvidenceSetLineageError);
    try {
      store.append(b);
    } catch (e) {
      expect((e as EvidenceSetLineageError).code).toBe("LINEAGE_SCOPE_MISMATCH");
    }
  });

  it("rejects parallel branch A→B and A→C → LINEAGE_FORK_DETECTED", () => {
    const store = new InMemoryEvidenceSetLineageStore();
    const a = makeArtifact(makeIdentity({ lineage_sequence: 1 }));
    store.append(a);

    const b = makeArtifact(
      makeIdentity({
        documents: [{ document_hash: "branch-b" }],
        lineage_sequence: 2,
        previous_evidence_set_hash: a.evidence_set_hash,
      }),
    );
    store.append(b);

    const c = makeArtifact(
      makeIdentity({
        documents: [{ document_hash: "branch-c" }],
        lineage_sequence: 2,
        previous_evidence_set_hash: a.evidence_set_hash,
      }),
    );

    expect(() => store.append(c)).toThrow(EvidenceSetLineageError);
    try {
      store.append(c);
    } catch (e) {
      expect((e as EvidenceSetLineageError).code).toBe("LINEAGE_FORK_DETECTED");
    }
  });

  it("rejects alternative timeline: same (previous+docs+scope), different sequence → LINEAGE_SEQUENCE_AMBIGUITY", () => {
    const store = new InMemoryEvidenceSetLineageStore();
    const a = makeArtifact(makeIdentity({ lineage_sequence: 1 }));
    store.append(a);

    const docs = [
      { document_hash: "d1", municipality_code: "2062" },
      { document_hash: "d2", municipality_code: "2062" },
    ];
    const scope = {
      jurisdiction_level: "MUNICIPALITY" as const,
      decision_type: "WASTEWATER" as const,
    };

    const b = makeArtifact(
      makeIdentity({
        documents: docs,
        lineage_sequence: 2,
        previous_evidence_set_hash: a.evidence_set_hash,
        lineage_scope: scope,
      }),
    );
    store.append(b);

    // Same slot as B, but sequence=27 — alternative historical timeline.
    const bPrime = makeArtifact(
      makeIdentity({
        documents: docs,
        lineage_sequence: 27,
        previous_evidence_set_hash: a.evidence_set_hash,
        lineage_scope: scope,
      }),
    );

    expect(() => store.append(bPrime)).toThrow(EvidenceSetLineageError);
    try {
      store.append(bPrime);
    } catch (e) {
      expect((e as EvidenceSetLineageError).code).toBe("LINEAGE_SEQUENCE_AMBIGUITY");
    }
  });

  it("rejects root-level sequence ambiguity (no previous_hash)", () => {
    const store = new InMemoryEvidenceSetLineageStore();
    const docs = [{ document_hash: "root-doc" }];
    const r1 = makeArtifact(
      makeIdentity({ documents: docs, lineage_sequence: 1 }),
    );
    store.append(r1);

    const r2 = makeArtifact(
      makeIdentity({ documents: docs, lineage_sequence: 27 }),
    );

    expect(() => store.append(r2)).toThrow(EvidenceSetLineageError);
    try {
      store.append(r2);
    } catch (e) {
      expect((e as EvidenceSetLineageError).code).toBe("LINEAGE_SEQUENCE_AMBIGUITY");
    }
  });
});
