import { ContentReference } from "@miljobeslut/mps-evolution";
import { EventArtifact } from "../contracts/EventArtifact.js";

export interface EventResolutionTrace {
  readonly source: "ArtifactRepository";
  readonly artifact_ref: ContentReference;
}

export interface EventResolver {
  resolveByRef(
    ref: ContentReference
  ): Promise<{
    event: EventArtifact;
    trace: EventResolutionTrace;
  }>;
}

export interface EventDeduplicationResolver {
  resolveOrCreate(
    idempotency_key: string,
    event_key: string,
    subject_ref: ContentReference,
    payload_ref: ContentReference
  ): Promise<ContentReference>;
}
