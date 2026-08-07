/**
 * MaterializationContract — the single canonical Materialization Boundary.
 *
 * Reconciled in Commit H.3: there is exactly one way to create Decision Authority.
 * Dependencies are injected; the pipeline itself knows nothing about hashing,
 * CAS layout, runtime or database.
 *
 * @see docs/architecture/ADR-MPS-MATERIALIZATION-BOUNDARY.md
 */

import type {
  DecisionImpactArtifact,
  DecisionType,
  EvidenceSetArtifact,
  JurisdictionLevel,
} from "../../mps-decision-governance/src/index.js";

export const MATERIALIZATION_VERSION = "mat-1" as const;
export const RULE_VERSION = "rules-1" as const;

export class MaterializationContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "MaterializationContractError";
  }
}

/**
 * Input to materialization: evidence that has already passed verification upstream.
 * This is a value, not an artifact — it carries no identity of its own.
 */
export type VerifiedEvidenceSet = {
  readonly source_artifact_hashes: readonly string[];
  readonly jurisdiction_level: JurisdictionLevel;
  readonly decision_type: DecisionType;
  readonly municipality_code?: string;
  readonly county_code?: string;
  readonly country_code?: string;
  readonly verified_attributes: Readonly<Record<string, unknown>>;
};

/** Every version that participates in the identity of a materialized artifact. */
export type MaterializationVersions = {
  readonly canonical_version: string;
  readonly rule_version: string;
  readonly materialization_version: string;
};

export type MaterializationResult = {
  readonly status: "CREATED";
  readonly artifact: DecisionImpactArtifact;
  readonly evidence_set: EvidenceSetArtifact;
  readonly evidence_set_hash: string;
  readonly canonical_payload: string;
  readonly versions: MaterializationVersions;
};

export interface MaterializationContract {
  readonly versions: MaterializationVersions;
  materialize(evidenceSet: VerifiedEvidenceSet): MaterializationResult;
}

const AI_MARKERS = [
  "openai",
  "anthropic",
  "gemini",
  "vertex",
  "llm",
  "chatcompletion",
  "embedding",
  "prompt(",
] as const;

/**
 * Fitness check: truth creation is deterministic projection, never inference.
 * Applied to the materialization core's own source text.
 */
export function assertNoAiInMaterializationCore(source: string, origin = "materialization core"): void {
  const haystack = source.toLowerCase();
  for (const marker of AI_MARKERS) {
    if (haystack.includes(marker)) {
      throw new MaterializationContractError(
        "MATERIALIZATION_AI_CONTAMINATION",
        `${origin} references '${marker}'; Decision Truth SHALL NOT be inferred`,
      );
    }
  }
}
