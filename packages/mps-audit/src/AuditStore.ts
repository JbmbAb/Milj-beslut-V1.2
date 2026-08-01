import type { AuditArtifact, AuditReference, AuditChainIndex } from "./AuditTypes";

export interface AuditStore {
  append(artifact: AuditArtifact): Promise<AuditReference>;
  get(audit_id: string): Promise<AuditArtifact | null>;
  getChainIndex(): Promise<AuditChainIndex>;
}
