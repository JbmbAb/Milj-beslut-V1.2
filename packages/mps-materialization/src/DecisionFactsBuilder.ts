import type { EvidenceSetArtifact } from "../../mps-decision-governance/src/EvidenceSetArtifact";
import type { DecisionImpactIndicator } from "../../mps-decision-governance/src/DecisionImpactIdentity";

export class DecisionFactsBuilder {
  /**
   * Bygger deterministiska fakta och indikatorer uteslutande baserat på det oföränderliga evidenssetet.
   * Denna logik är helt biverkningsfri och rent beräknande (Materialization Truth).
   */
  static buildIndicators(
    evidenceSet: EvidenceSetArtifact,
    ruleVersion: string
  ): readonly DecisionImpactIndicator[] {
    // Exempel på deterministisk beräkning: Antalet granskade dokument i evidensmängden
    const documentCount = evidenceSet.identity.documents.length;

    return [
      {
        code: "IND-AUDITED-DOCS-COUNT",
        description: `Deterministic audit-count of evidence documents under rules ${ruleVersion}`,
        value: documentCount,
        unit: "pcs",
        confidence: "HIGH",
        derivation: "COUNT"
      }
    ];
  }
}
