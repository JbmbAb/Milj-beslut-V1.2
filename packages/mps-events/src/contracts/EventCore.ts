import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

// EVT-001 — Event Identity Isolation
export interface EventArtifact extends CanonicalArtifact {
  readonly artifact_type: "EVENT_ARTIFACT";

  readonly event_key: string;
  readonly event_version: string;

  readonly subject_ref: ContentReference;
  readonly payload_ref: ContentReference;

  // EVENT-24-18-I5: Event Causality
  readonly triggering_artifact_ref?: ContentReference;
  readonly previous_causal_event_ref?: ContentReference;
}

export interface EventEngine {
  createEvent(
    event_key: string,
    event_version: string,
    subject_ref: ContentReference,
    payload_ref: ContentReference,
    triggering_artifact_ref?: ContentReference,
    previous_causal_event_ref?: ContentReference
  ): Promise<EventArtifact>;
}

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
