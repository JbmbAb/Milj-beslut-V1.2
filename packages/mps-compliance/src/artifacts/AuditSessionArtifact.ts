import { ArtifactContract, ArtifactReference } from "./ArtifactContract";

/**
 * AuditSessionArtifact
 * 
 * Records human navigation without making it canonical truth.
 * Enforces VIEW-22-I4 (Audit Session Boundary) by separating ephemeral
 * viewing state from canonical truth.
 */
export interface AuditSessionArtifact extends ArtifactContract {
  readonly artifact_type: "audit_session";
  
  readonly release_ref: ArtifactReference;
  readonly viewer_capability_ref: ArtifactReference;
  
  readonly opened_at: string; // ISO8601 date string
  
  readonly inspected_nodes: readonly ArtifactReference[];
  readonly exported_artifacts: readonly ArtifactReference[];
  
  // Strict lifecycle machine (AUDIT-22.9-I1)
  readonly state: "OPEN" | "CLOSED" | "TERMINATED";
  readonly closed_at?: string; // ISO8601 date string. Required when state != OPEN.
  readonly termination_reason?: "user_exit" | "timeout" | "capability_revoked" | "system_halt";
}
