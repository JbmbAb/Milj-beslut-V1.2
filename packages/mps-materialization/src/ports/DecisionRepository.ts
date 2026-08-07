import type { DecisionImpactIdentity, DecisionImpactArtifact, DecisionImpactMetadata } from "../../../mps-decision-governance/src/DecisionImpactIdentity";

export interface DecisionRepository {
  /**
   * Sparar en DecisionImpactIdentity som ett omutligt, innehålls-adresserat artefakt.
   */
  save(
    identity: DecisionImpactIdentity,
    metadata: DecisionImpactMetadata
  ): Promise<DecisionImpactArtifact>;
}
