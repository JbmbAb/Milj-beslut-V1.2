import { ContentReference } from "@miljobeslut/mps-evolution";
import { AuditArtifact } from "../contracts/AuditArtifact.js";

export interface AuditResolutionTrace {
  readonly source: "ArtifactRepository";
  readonly artifact_ref: ContentReference;
}

export interface AuditResolver {
  resolveByRef(
    ref: ContentReference
  ): Promise<{
    audit: AuditArtifact;
    trace: AuditResolutionTrace;
  }>;
}
