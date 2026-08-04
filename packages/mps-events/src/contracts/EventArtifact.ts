import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface EventArtifact extends CanonicalArtifact {
  readonly artifact_type: "EVENT_ARTIFACT";

  readonly event_key: string;
  readonly event_version: string;

  readonly subject_ref: ContentReference;
  readonly payload_ref: ContentReference;
}

export interface EventOrdering {
  readonly sequence_number: number;
  readonly previous_event_ref?: ContentReference;
}

export interface OrderedEventArtifact extends EventArtifact {
  readonly ordering: EventOrdering;
}

export interface EventCausality {
  readonly caused_by: readonly ContentReference[];
}

export interface CausalEventArtifact extends OrderedEventArtifact {
  readonly causality: EventCausality;
}

export interface EventIdentity {
  readonly idempotency_key: string;
}

export interface DeduplicatedEventArtifact extends EventArtifact {
  readonly identity: EventIdentity;
}

export interface EventTemporal {
  readonly effective_at?: string;
  readonly observed_at?: string;
}

export interface TemporalEventArtifact extends EventArtifact {
  readonly temporal: EventTemporal;
}

export interface EventStreamArtifact extends CanonicalArtifact {
  readonly artifact_type: "EVENT_STREAM_ARTIFACT";

  readonly stream_key: string;

  readonly event_refs: readonly ContentReference[];
}
