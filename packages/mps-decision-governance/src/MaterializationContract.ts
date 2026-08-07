/**
 * Materialization Pipeline — deterministic contracts (Decision Knowledge Plane).
 *
 * Constitutional steps (each idempotent, own contract):
 *   Canonical Source → CAS lookup → (reuse | Parse/Extract → DecisionFacts → DecisionImpact) → Repository
 *
 * SHALL NOT mutate Package 21 replay identity.
 * SHALL run lineage checks before EvidenceSet commit.
 * SHALL NOT use Raw Evidence as analytical primary (MIMER-SCALE-I01).
 *
 * @see ADR-MPS-CONSTITUTIONAL-INVARIANTS §6
 */

import type { DecisionType, JurisdictionLevel } from "./DecisionImpactIdentity";

export const MATERIALIZATION_CONTRACT_VERSION = "1" as const;

export type MaterializationStep =
  | "CAS_LOOKUP"
  | "PARSE_EXTRACT"
  | "DECISION_FACTS"
  | "DECISION_IMPACT"
  | "REPOSITORY_COMMIT";

/** Canonical source input — content-addressed refs only (no runtime clocks in identity). */
export type CanonicalMaterializationSource = {
  readonly source_document_hashes: readonly string[];
  readonly jurisdiction_level: JurisdictionLevel;
  readonly decision_type: DecisionType;
  readonly municipality_code?: string;
  readonly county_code?: string;
  readonly country_code?: string;
  readonly derivation_version: string;
  readonly schema_version: number;
  /** Deterministic extracted facts (already normalized; no LLM nondeterminism). */
  readonly decision_facts: Readonly<Record<string, unknown>>;
  readonly indicator: {
    readonly code: string;
    readonly description: string;
    readonly value: number;
    readonly unit: string;
    readonly confidence: "HIGH" | "MEDIUM" | "LOW";
    readonly derivation: "COUNT" | "AGGREGATION" | "MODEL";
  };
};

export type MaterializationOutcome =
  | {
      readonly status: "REUSED";
      readonly steps: readonly MaterializationStep[];
      readonly impact_id: string;
      readonly canonical_payload: string;
    }
  | {
      readonly status: "CREATED";
      readonly steps: readonly MaterializationStep[];
      readonly impact_id: string;
      readonly canonical_payload: string;
      readonly evidence_set_hash: string;
    };

export class MaterializationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MaterializationError";
  }
}
