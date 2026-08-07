import type { CanonicalArtifact, ContentReference, ActorReference, Timestamp } from "../../mps-core/src/types";

/**
 * 🜃 DatasetApprovalArtifact (Mimers Brunn v2.0.1 Section 7)
 * 
 * En formell, omutlig godkännande-artefakt som krävs för att tillåta import
 * av externa geodataset till PostGIS.
 */
export interface DatasetApprovalArtifact extends CanonicalArtifact {
  readonly artifact_type: "DATASET_APPROVAL";
  readonly approved_ref: ContentReference;
  readonly decision: "APPROVED" | "REJECTED";
  readonly actor_ref: ActorReference;
  readonly decision_at: Timestamp;
  readonly reason: string;
}
