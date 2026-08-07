import { ArtifactContract, ArtifactReference } from "./ArtifactContract";

/**
 * 🜃 DatasetApprovalArtifact (Mimers Brunn v2.0.1 Section 7)
 * 
 * En formell, omutlig godkännande-artefakt som krävs för att tillåta import
 * av externa geodataset (t.ex. från SGU eller Lantmäteriet) till PostGIS.
 * 
 * Invarianter:
 *   - approved_ref SHALL point to a HarvestManifestArtifact.
 *   - actor_ref.role MUST be either 'HUMAN_OPERATOR' or 'GOVERNANCE_REVIEWER'.
 *   - actor_ref MUST NOT be the same as the harvest manifest producer (no self-approval).
 */
export interface DatasetApprovalArtifact extends ArtifactContract {
  readonly artifact_type: "DATASET_APPROVAL";
  readonly payload: {
    readonly approved_ref: ArtifactReference; // Referens till HarvestManifestArtifact
    readonly decision: "APPROVED" | "REJECTED";
    readonly actor_ref: {
      readonly actor_id: string;
      readonly role: "HUMAN_OPERATOR" | "GOVERNANCE_REVIEWER";
    };
    readonly decision_at: string;             // ISO-tidsstämpel
    readonly reason: string;
  };
}
