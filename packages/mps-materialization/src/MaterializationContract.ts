import type { EvidenceSetArtifact } from "../../mps-decision-governance/src/EvidenceSetArtifact";
import type { DecisionImpactArtifact, JurisdictionLevel, DecisionType } from "../../mps-decision-governance/src/DecisionImpactIdentity";

export interface MaterializationContext {
  readonly jurisdiction_level: JurisdictionLevel;
  readonly decision_type: DecisionType;
  readonly municipality_code?: string;
  readonly schema_version: number;
}

export interface MaterializationContract {
  readonly canonicalizer_id: string;
  readonly materialization_version: string;
  readonly rule_version: string;

  /**
   * Materialiserar ett fryst evidensset till ett omutligt beslutsfakta-artefakt (DecisionImpactArtifact).
   */
  materialize(
    evidenceSet: EvidenceSetArtifact,
    context: MaterializationContext
  ): Promise<DecisionImpactArtifact>;
}
