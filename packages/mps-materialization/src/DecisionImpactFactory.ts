import type { DecisionImpactIdentity, JurisdictionLevel, DecisionType } from "../../mps-decision-governance/src/DecisionImpactIdentity";
import type { EvidenceSetArtifact } from "../../mps-decision-governance/src/EvidenceSetArtifact";
import type { DecisionImpactIndicator } from "../../mps-decision-governance/src/DecisionImpactIdentity";

export class DecisionImpactFactory {
  /**
   * Skapar en ren, fryst DecisionImpactIdentity-faktakoppling.
   * Säkerställer att ingen lokal hashning sker i fabriken.
   */
  static createIdentity(options: {
    readonly jurisdiction_level: JurisdictionLevel;
    readonly decision_type: DecisionType;
    readonly municipality_code?: string;
    readonly evidence_set_hashes: readonly string[];
    readonly indicators: readonly DecisionImpactIndicator[];
    readonly schema_version: number;
    readonly derivation_version: string;
  }): DecisionImpactIdentity {
    return {
      jurisdiction_level: options.jurisdiction_level,
      decision_type: options.decision_type,
      municipality_code: options.municipality_code,
      evidence_set_hashes: options.evidence_set_hashes,
      indicators: options.indicators,
      schema_version: options.schema_version,
      derivation_version: options.derivation_version
    };
  }
}
