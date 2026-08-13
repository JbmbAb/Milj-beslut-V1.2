import {
  DOCUMENT_FACT_VERIFICATION_POLICY_V1,
  verifyDocumentFactCandidate,
  type DocumentFactCandidateArtifact,
  type VerifiedDocumentFactArtifact,
} from "../../../mps-data-governance/src/DocumentFactArtifact";
import type { DocumentEvidenceArtifact } from "../../src/artifacts/DocumentEvidenceArtifact";

/**
 * E2E FIXTURE RECONCILIATION 2026-08-13.
 *
 * The end-to-end fixtures used to reach `LU-DOC-BESLUT-001` through the forbidden path:
 * the document text contained "avslag", and the rule was expected to fire because of it.
 * The frozen fact model made that path illegal, so the fixtures — not the production code —
 * had to change.
 *
 * This builder deliberately drives the REAL governance gate (`verifyDocumentFactCandidate`
 * under `DOCUMENT_FACT_VERIFICATION_POLICY_V1`) rather than hand-constructing a verified
 * artifact. A hand-built fixture would assert the shape of a verified fact while proving
 * nothing about whether it could ever have been verified; this one cannot exist unless the
 * candidate actually passes policy, separation of asserter and verifier, and span validation.
 */

function contentRef(id: string) {
  return { id, content_hash: { algorithm: "sha256", digest: `hash-${id}` } };
}

export function buildVerifiedPriorDecisionFact(scope: string): VerifiedDocumentFactArtifact {
  const candidate: DocumentFactCandidateArtifact = {
    artifact_id: `fact-candidate-${scope}`,
    artifact_type: "DOCUMENT_FACT_CANDIDATE",
    content_hash: { algorithm: "sha256", digest: `hash-cand-${scope}` },
    signature: { algorithm: "ed25519", signature: `sig-cand-${scope}` },
    verification_status: "CANDIDATE",
    fact_type: "PRIOR_LOCATION_RESTRICTING_DECISION",
    fact_version: "1.0",
    source_document_ref: contentRef(`doc-${scope}`),
    inventory_ref: contentRef(`inv-${scope}`),
    source_span: {
      text_projection_ref: contentRef(`proj-${scope}`),
      start_offset: 0,
      end_offset: 48,
    },
    subject_ref: contentRef(`prop-${scope}`),
    assertion: {
      asserted_by: { identity_ref: contentRef("extractor-1"), role: "SYSTEM_PROCESS" },
      assertion_method: "MODEL_EXTRACTION",
      asserter_version: "extractor/1.4.0",
      asserted_at: "2026-08-13T09:00:00.000Z",
    },
  };

  return verifyDocumentFactCandidate({
    candidate,
    candidate_ref: contentRef(candidate.artifact_id),
    verification: {
      verified_by: { identity_ref: contentRef("reviewer-1"), role: "GOVERNANCE_REVIEWER" },
      verification_method: "HUMAN_REVIEW",
      verification_policy_version: DOCUMENT_FACT_VERIFICATION_POLICY_V1.policy_version,
      verified_at: "2026-08-13T10:00:00.000Z",
    },
    policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
    artifact_id: `fact-verified-${scope}`,
    content_hash: { algorithm: "sha256", digest: `hash-verified-${scope}` },
    signature: { algorithm: "ed25519", signature: `sig-verified-${scope}` },
  });
}

/**
 * Attaches the Tier 3 fact reference to materialized document evidence.
 *
 * `DocumentEvidenceMaterializer` does not set `fact_refs` — classification happens in Tier 3,
 * after materialization, and wiring that into the materializer would give it the legal
 * classification authority the freeze explicitly denies it. The link is therefore composed
 * here, which is what the real pipeline does at a later stage.
 *
 * NOTE: `content_hash` is intentionally not recomputed. These fixtures exercise the
 * evidence → fact → rule path, not hash integrity, which is proven separately.
 */
export function withFactRef(
  evidence: DocumentEvidenceArtifact,
  fact: VerifiedDocumentFactArtifact,
): DocumentEvidenceArtifact {
  return {
    ...evidence,
    payload: {
      ...evidence.payload,
      fact_refs: [{ artifact_id: fact.artifact_id, artifact_type: fact.artifact_type }],
    },
  };
}
