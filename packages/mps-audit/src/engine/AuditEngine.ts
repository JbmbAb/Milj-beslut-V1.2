import { ContentReference } from "@miljobeslut/mps-evolution";
import { AuditArtifact } from "../contracts/AuditArtifact.js";

export interface AuditIntent {
  readonly audit_key: string;
  readonly subject_ref: ContentReference;
  readonly trigger_ref: ContentReference;
}

export interface AuditEngine {
  createAudit(intent: AuditIntent): Promise<AuditArtifact>;
}
