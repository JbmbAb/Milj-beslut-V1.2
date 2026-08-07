// packages/mps-decision-governance/src/DecisionImpactIdentity.ts

import type { Timestamp } from "../../mps-core/src/types";

export type JurisdictionLevel =
  | "CASE"
  | "MUNICIPALITY"
  | "COUNTY"
  | "NATIONAL";

export type DecisionType =
  | "WASTEWATER"
  | "BUILDING_PERMIT"
  | "ENVIRONMENTAL_PERMIT"
  | "PLANNING_DECISION"
  | "OTHER";

export type IndicatorConfidence = "HIGH" | "MEDIUM" | "LOW";
export type IndicatorDerivation = "COUNT" | "AGGREGATION" | "MODEL";

export interface DecisionImpactIndicator {
  readonly code: string;
  readonly description: string;
  readonly value: number;
  readonly unit: string;
  readonly confidence: IndicatorConfidence;
  readonly derivation: IndicatorDerivation;
}

/**
 * Ren identity: fakta + vilka evidensset som ingår + versionsgräns.
 */
export interface DecisionImpactIdentity {
  readonly jurisdiction_level: JurisdictionLevel;
  readonly decision_type: DecisionType;

  readonly municipality_code?: string;
  readonly county_code?: string;
  readonly country_code?: string;

  readonly period_start?: Timestamp;
  readonly period_end?: Timestamp;

  readonly evidence_set_hashes: readonly string[];

  readonly indicators: readonly DecisionImpactIndicator[];

  readonly schema_version: number;
  readonly derivation_version: string; // t.ex. "ww-risk-model-2.0"
}

/**
 * Metadata = runtime/audit, påverkar aldrig identitet/hash.
 */
export interface DecisionImpactMetadata {
  readonly created_at: Timestamp;
  readonly materialization_version: string;
  readonly generated_by: string;
}

/**
 * Full artefakt: hash(identity) + identity + metadata.
 */
export interface DecisionImpactArtifact {
  readonly impact_id: string; // SHA-256(canonical(identity))
  readonly identity: DecisionImpactIdentity;
  readonly metadata: DecisionImpactMetadata;
}
