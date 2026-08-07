import type { EvidenceSetArtifact } from "../../../mps-decision-governance/src/EvidenceSetArtifact";

export interface EvidenceResolver {
  /**
   * Löser och hämtar ett fullt evidensset-artefakt utifrån dess unika hash (C-01).
   */
  resolve(evidenceSetHash: string): Promise<EvidenceSetArtifact | null>;
}
