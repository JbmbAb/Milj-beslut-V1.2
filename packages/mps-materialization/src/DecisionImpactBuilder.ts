/**
 * DecisionImpactBuilder — identity + version-bound hash from DecisionFacts + EvidenceSet.
 */

import {
  buildDecisionImpactIdentityPayload,
  DECISION_GOVERNANCE_CANONICAL_VERSION,
  hashDecisionImpactIdentity,
  hashEvidenceSetIdentity,
  serializeCanonicalPayload,
  type DecisionImpactArtifact,
  type DecisionImpactIdentity,
  type EvidenceSetArtifact,
  type EvidenceSetIdentity,
} from "../../mps-decision-governance/src/index.js";
import type { DecisionFacts } from "./DecisionFactsBuilder.js";

export type BuiltImpact = {
  readonly evidence_set: EvidenceSetArtifact;
  readonly impact: DecisionImpactArtifact;
  readonly canonical_payload: string;
  readonly canonical_version: string;
};

export function buildEvidenceSetFromFacts(
  facts: DecisionFacts,
  lineage_sequence = 1,
): EvidenceSetArtifact {
  const documents = [
    ...facts.source_artifact_hashes.map((document_hash) => {
      const ref: {
        document_hash: string;
        municipality_code?: string;
        county_code?: string;
        country_code?: string;
      } = { document_hash };
      if (facts.municipality_code !== undefined) {
        ref.municipality_code = facts.municipality_code;
      }
      if (facts.county_code !== undefined) ref.county_code = facts.county_code;
      if (facts.country_code !== undefined) ref.country_code = facts.country_code;
      return ref;
    }),
    // Facts themselves are content-addressed into the set (identity).
    { document_hash: facts.facts_hash },
  ];

  const identity: EvidenceSetIdentity = {
    documents,
    schema_version: 1,
    lineage_sequence,
    lineage_scope: {
      jurisdiction_level: facts.jurisdiction_level,
      decision_type: facts.decision_type,
    },
  };

  return {
    evidence_set_hash: hashEvidenceSetIdentity(identity),
    identity,
    metadata: {
      created_at: "1970-01-01T00:00:00.000Z",
      materialization_version: facts.materialization_version,
      generated_by: "mps-materialization",
    },
  };
}

export function buildDecisionImpactFromFacts(
  facts: DecisionFacts,
  evidence_set: EvidenceSetArtifact,
): BuiltImpact {
  const identity: DecisionImpactIdentity = {
    jurisdiction_level: facts.jurisdiction_level,
    decision_type: facts.decision_type,
    ...(facts.municipality_code !== undefined
      ? { municipality_code: facts.municipality_code }
      : {}),
    ...(facts.county_code !== undefined ? { county_code: facts.county_code } : {}),
    ...(facts.country_code !== undefined ? { country_code: facts.country_code } : {}),
    evidence_set_hashes: [evidence_set.evidence_set_hash],
    indicators: [facts.indicator],
    schema_version: 1,
    derivation_version: `${facts.rule_version}+${facts.materialization_version}`,
  };

  const impact_id = hashDecisionImpactIdentity(identity);
  const canonical_payload = serializeCanonicalPayload(
    buildDecisionImpactIdentityPayload(identity),
  );

  const impact: DecisionImpactArtifact = {
    impact_id,
    identity,
    metadata: {
      created_at: "1970-01-01T00:00:00.000Z",
      materialization_version: facts.materialization_version,
      generated_by: "mps-materialization",
    },
  };

  return {
    evidence_set,
    impact,
    canonical_payload,
    canonical_version: DECISION_GOVERNANCE_CANONICAL_VERSION,
  };
}
