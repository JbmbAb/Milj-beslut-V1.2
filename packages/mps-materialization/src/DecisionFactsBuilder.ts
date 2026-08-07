/**
 * DecisionFactsBuilder — deterministic projection of verified evidence into facts.
 * Pure computation: no IO, no clock, no inference, no hashing of its own (MAT-I02).
 */

import type {
  DecisionImpactIndicator,
  DecisionType,
  JurisdictionLevel,
} from "../../mps-decision-governance/src/index.js";
import type { MaterializationVersions, VerifiedEvidenceSet } from "./MaterializationContract.js";
import type { MaterializationIdentityProvider } from "./ports/MaterializationIdentityProvider.js";

export type DecisionFacts = {
  readonly source_artifact_hashes: readonly string[];
  readonly jurisdiction_level: JurisdictionLevel;
  readonly decision_type: DecisionType;
  readonly municipality_code?: string;
  readonly county_code?: string;
  readonly country_code?: string;
  readonly indicator: DecisionImpactIndicator;
  readonly facts_hash: string;
  readonly rule_version: string;
  readonly materialization_version: string;
};

function countOf(evidence: VerifiedEvidenceSet): number {
  const declared = evidence.verified_attributes.count;
  return typeof declared === "number" ? declared : evidence.source_artifact_hashes.length;
}

export function buildDecisionFacts(
  evidence: VerifiedEvidenceSet,
  versions: MaterializationVersions,
  identity: MaterializationIdentityProvider,
): DecisionFacts {
  const source_artifact_hashes = [...evidence.source_artifact_hashes].sort();

  const indicator: DecisionImpactIndicator = {
    code: "IND-VERIFIED-EVIDENCE-COUNT",
    description: `Deterministic count of verified evidence under ${versions.rule_version}`,
    value: countOf(evidence),
    unit: "pcs",
    confidence: "HIGH",
    derivation: "COUNT",
  };

  const facts_hash = identity.hashFacts({
    kind: "decision_facts",
    source_artifact_hashes,
    verified_attributes: evidence.verified_attributes,
    indicator,
    rule_version: versions.rule_version,
  });

  return {
    source_artifact_hashes,
    jurisdiction_level: evidence.jurisdiction_level,
    decision_type: evidence.decision_type,
    ...(evidence.municipality_code !== undefined
      ? { municipality_code: evidence.municipality_code }
      : {}),
    ...(evidence.county_code !== undefined ? { county_code: evidence.county_code } : {}),
    ...(evidence.country_code !== undefined ? { country_code: evidence.country_code } : {}),
    indicator,
    facts_hash,
    rule_version: versions.rule_version,
    materialization_version: versions.materialization_version,
  };
}
