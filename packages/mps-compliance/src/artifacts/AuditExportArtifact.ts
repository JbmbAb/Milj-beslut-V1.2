import { ArtifactContract } from "./ArtifactContract";

/**
 * AuditExportArtifact
 * 
 * Cryptographically seals a generated UI export (e.g., PDF, report).
 * Proves that an exported document was strictly backed by a canonical proof.
 */
export interface AuditExportArtifact extends ArtifactContract {
  readonly artifact_type: "audit_export";
  readonly release_hash: string;
  readonly snapshot_hash: string; // The specific rendering snapshot loaded
  readonly frame_hash: string;    // The frame hash at the time of export
  readonly renderer_version: string;
}
