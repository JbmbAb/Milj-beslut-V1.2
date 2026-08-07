/**
 * EvidenceSetIdentity property tests — document order tolerance.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hashEvidenceSetIdentity } from "../src/CanonicalDecisionImpactHash";
import type {
  EvidenceDocumentReference,
  EvidenceSetIdentity,
} from "../src/EvidenceSetArtifact";

const documents: EvidenceDocumentReference[] = [
  { document_hash: "d1", municipality_code: "2062" },
  { document_hash: "d2", municipality_code: "2062" },
  { document_hash: "d3", municipality_code: "2062" },
];

function baseIdentity(
  docs: readonly EvidenceDocumentReference[] = documents,
): EvidenceSetIdentity {
  return {
    documents: docs,
    schema_version: 1,
    lineage_sequence: 1,
    lineage_scope: {
      jurisdiction_level: "MUNICIPALITY",
      decision_type: "WASTEWATER",
    },
  };
}

describe("EvidenceSetIdentityPropertyTests — order tolerance", () => {
  it("Permutation(documents) ⇒ same canonical identity ⇒ same hash", () => {
    const expected = hashEvidenceSetIdentity(baseIdentity());

    fc.assert(
      fc.property(
        fc.shuffledSubarray(documents, { minLength: 3, maxLength: 3 }),
        (permutation) => {
          expect(
            hashEvidenceSetIdentity({
              ...baseIdentity(),
              documents: permutation,
            }),
          ).toBe(expected);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("[d1,d2,d3] = [d3,d1,d2] = [d2,d3,d1]", () => {
    const a = hashEvidenceSetIdentity(
      baseIdentity([
        { document_hash: "d1" },
        { document_hash: "d2" },
        { document_hash: "d3" },
      ]),
    );
    const b = hashEvidenceSetIdentity(
      baseIdentity([
        { document_hash: "d3" },
        { document_hash: "d1" },
        { document_hash: "d2" },
      ]),
    );
    const c = hashEvidenceSetIdentity(
      baseIdentity([
        { document_hash: "d2" },
        { document_hash: "d3" },
        { document_hash: "d1" },
      ]),
    );
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
