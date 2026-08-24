import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { SecurityRuntime } from "../../mps-runtime/src/security/SecurityRuntime";
import { createGovernedLocalizationAssessment } from "../src/governance/GovernedAssessmentPersistence";
import { LURuleEngine } from "../src/rules/LURuleEngine";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import type { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";
import type { VerifiedDocumentFactArtifact } from "../../mps-data-governance/src/DocumentFactArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";

/**
 * RED -- CANONICAL-SEMANTIC-INPUTS-V1 / H7.
 *
 * `LURuleEngine` currently preserves the incoming spatial-evidence sequence in its emitted
 * findings, while governed assessment persistence hashes that sequence verbatim. The two
 * executions below carry the same semantic evidence set and produce the same logical findings,
 * but their order differs solely because a provider returned rows in another order.
 *
 * The document stream is deliberately included because the product evaluation API receives
 * spatial and document evidence separately. It must not turn either collection's incidental
 * retrieval order into assessment identity.
 */

const PROJECT_CONTEXT_REF = { artifact_id: "project-context-h7-red", artifact_type: "LU_PROJECT_CONTEXT" } as const;
const PROPERTY_REF = { artifact_id: "property-context-h7-red", artifact_type: "LU_PROPERTY_CONTEXT" } as const;

function ref(artifact_id: string, artifact_type: string): ArtifactReference {
  return { artifact_id, artifact_type };
}

function spatialEvidence(artifactId: string, layer: "water" | "natura2000"): SpatialEvidenceArtifact {
  const versionHash = "c".repeat(64);
  return {
    artifact_id: artifactId,
    artifact_type: "SPATIAL_EVIDENCE",
    content_hash: { algorithm: "sha256", value: `hash-${artifactId}` },
    references: [PROPERTY_REF],
    payload: {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: { subject_ref: PROPERTY_REF, srid: 3006, distance_meters: 100 },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: PROPERTY_REF,
      geometry: null,
      srid: 3006,
      operation: { algorithm: "spatial.dwithin_existence", engine: "PostGIS", engine_fingerprint: SPATIAL_STACK_V1 },
      layer_ref: { layer_id: layer, version_hash: versionHash, layer_version: "v1" },
      source_metadata: { provider: "D2", dataset: layer, dataset_version: versionHash, retrieved_at: "2026-08-24T00:00:00.000Z" },
      query_context: { query_id: `query-${artifactId}`, query_type: "SPATIAL_DWITHIN", parameters: {} },
    },
  } as unknown as SpatialEvidenceArtifact;
}

function documentEvidence(id: string, factRef: ArtifactReference): DocumentEvidenceArtifact {
  return {
    artifact_id: id,
    artifact_type: "DOCUMENT_EVIDENCE",
    content_hash: { algorithm: "sha256", value: `hash-${id}` },
    references: [PROPERTY_REF],
    payload: {
      property_ref: PROPERTY_REF,
      document_ref: ref("document-h7-red", "DOCUMENT"),
      fact_refs: [factRef],
      source_metadata: { provider: "D2", retrieved_at: "2026-08-24T00:00:00.000Z" },
    },
  } as unknown as DocumentEvidenceArtifact;
}

function verifiedFact(id: string): VerifiedDocumentFactArtifact {
  return {
    artifact_id: id,
    artifact_type: "VERIFIED_DOCUMENT_FACT",
    verification_status: "VERIFIED",
    fact_type: "PRIOR_LOCATION_RESTRICTING_DECISION",
  } as unknown as VerifiedDocumentFactArtifact;
}

function outcomeAndAttestation() {
  const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: "h7-red-permutation" });
  security.bindPrincipal("lu.site_assessment.actor");
  const outcome = {
    outcome_id: "outcome-h7-red-permutation",
    artifact_type: "execution_outcome" as const,
    attempt_ref: ref("attempt-h7-red", "execution_attempt"),
    result: "success" as const,
    content_hash: sha256ContentHash({ result: "success", tag: "h7-red-permutation" }),
  };
  return { outcome, attestation: security.attestOutcome(outcome.content_hash) };
}

function assessmentFor(
  spatial: readonly SpatialEvidenceArtifact[],
  documents: readonly DocumentEvidenceArtifact[],
  facts: readonly VerifiedDocumentFactArtifact[],
) {
  const findings = new LURuleEngine().evaluate({
    spatial_evidence: spatial,
    document_evidence: documents,
    verified_document_facts: facts,
  });
  const { outcome, attestation } = outcomeAndAttestation();
  return createGovernedLocalizationAssessment({
    draft: {
      site_id: "site-h7-red",
      project_context_ref: PROJECT_CONTEXT_REF,
      property_ref: PROPERTY_REF,
      evidence_refs: [
        ...spatial.map((item) => ref(item.artifact_id, item.artifact_type)),
        ...documents.map((item) => ref(item.artifact_id, item.artifact_type)),
      ],
      system_summary: "H7 RED permutation proof",
    },
    findings,
    outcome,
    attestation,
  });
}

describe("RED -- H7 canonical findings and rule-ref collections", () => {
  it("same mixed spatial/document evidence in a different retrieval order produces one V3 assessment identity", () => {
    const water = spatialEvidence("spatial-water-h7-red", "water");
    const natura = spatialEvidence("spatial-natura-h7-red", "natura2000");
    const firstFact = verifiedFact("verified-fact-a-h7-red");
    const secondFact = verifiedFact("verified-fact-b-h7-red");
    const firstDocument = documentEvidence("document-a-h7-red", ref(firstFact.artifact_id, firstFact.artifact_type));
    const secondDocument = documentEvidence("document-b-h7-red", ref(secondFact.artifact_id, secondFact.artifact_type));

    const first = assessmentFor([water, natura], [firstDocument, secondDocument], [firstFact, secondFact]);
    const second = assessmentFor([natura, water], [secondDocument, firstDocument], [secondFact, firstFact]);

    expect(first.payload.evidence_refs).toEqual(second.payload.evidence_refs);
    expect(first.payload.findings).toEqual(second.payload.findings);
    expect(first.payload.rule_refs).toEqual(second.payload.rule_refs);
    expect(first.artifact_id).toBe(second.artifact_id);
    expect(first.content_hash.value).toBe(second.content_hash.value);
  });

  it("rejects duplicate finding semantic identities instead of choosing an arbitrary tie-break", () => {
    const { outcome, attestation } = outcomeAndAttestation();
    const duplicate = {
      finding_id: "finding-duplicate-h7-red",
      rule_id: "LU-DUPLICATE-001",
      rule_version: "1.0",
      risk_level: "LOW" as const,
      evidence_refs: [ref("evidence-a", "SPATIAL_EVIDENCE")],
      explanation: "First body",
    };

    expect(() =>
      createGovernedLocalizationAssessment({
        draft: {
          site_id: "site-h7-red",
          project_context_ref: PROJECT_CONTEXT_REF,
          property_ref: PROPERTY_REF,
          evidence_refs: [ref("evidence-a", "SPATIAL_EVIDENCE")],
          system_summary: "H7 duplicate proof",
        },
        findings: [duplicate, { ...duplicate, explanation: "Conflicting body" }],
        outcome,
        attestation,
      }),
    ).toThrow(/duplicate finding semantic key/);
  });

  it("canonicalizes each finding object, not only the outer finding collection", () => {
    const { outcome, attestation } = outcomeAndAttestation();
    const canonicalShape = {
      finding_id: "finding-object-order-h7",
      rule_id: "LU-OBJECT-ORDER-001",
      rule_version: "1.0",
      risk_level: "LOW" as const,
      evidence_refs: [ref("evidence-a", "SPATIAL_EVIDENCE")],
      explanation: "Same semantic finding",
    };
    const alternateInsertionOrder = {
      explanation: "Same semantic finding",
      evidence_refs: [ref("evidence-a", "SPATIAL_EVIDENCE")],
      risk_level: "LOW" as const,
      rule_version: "1.0",
      rule_id: "LU-OBJECT-ORDER-001",
      finding_id: "finding-object-order-h7",
    };
    const draft = {
      site_id: "site-h7-object-order",
      project_context_ref: PROJECT_CONTEXT_REF,
      property_ref: PROPERTY_REF,
      evidence_refs: [ref("evidence-a", "SPATIAL_EVIDENCE")],
      system_summary: "H7 object canonicalization proof",
    };

    const first = createGovernedLocalizationAssessment({
      draft,
      findings: [canonicalShape],
      outcome,
      attestation,
    });
    const second = createGovernedLocalizationAssessment({
      draft,
      findings: [alternateInsertionOrder],
      outcome,
      attestation,
    });

    expect(JSON.stringify(first.payload.findings)).toBe(JSON.stringify(second.payload.findings));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.artifact_id).toBe(second.artifact_id);
  });

  it("a meaningful finding-set change still produces a different identity", () => {
    const water = spatialEvidence("spatial-water-h7-red", "water");
    const natura = spatialEvidence("spatial-natura-h7-red", "natura2000");
    const fact = verifiedFact("verified-fact-change-h7-red");
    const document = documentEvidence("document-change-h7-red", ref(fact.artifact_id, fact.artifact_type));

    const withWater = assessmentFor([water], [document], [fact]);
    const withNatura = assessmentFor([natura], [document], [fact]);

    expect(withWater.artifact_id).not.toBe(withNatura.artifact_id);
    expect(withWater.content_hash.value).not.toBe(withNatura.content_hash.value);
  });
});
