import { ContentReference } from "@miljobeslut/mps-evolution";
import {
  EventArtifact,
  OrderedEventArtifact,
  CausalEventArtifact,
  DeduplicatedEventArtifact,
  TemporalEventArtifact,
  EventStreamArtifact,
} from "../contracts/EventArtifact.js";

function isCanonicalRef(ref: ContentReference): boolean {
  return !!ref.hash;
}

function createsProvenanceCycle(_event: EventArtifact): boolean {
  return false;
}

function isCanonicalTimestamp(ts: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ts);
}

export interface EventProvenanceValidator {
  validate(event: EventArtifact): void;
}

export const DefaultEventProvenanceValidator: EventProvenanceValidator = {
  validate(event) {
    if (!event.subject_ref) {
      throw new Error("EVENT_PROVENANCE_VIOLATION: missing subject_ref");
    }
    if (!event.payload_ref) {
      throw new Error("EVENT_PROVENANCE_VIOLATION: missing payload_ref");
    }
    if (!isCanonicalRef(event.subject_ref)) {
      throw new Error("EVENT_PROVENANCE_VIOLATION: non-canonical subject_ref");
    }
    if (!isCanonicalRef(event.payload_ref)) {
      throw new Error("EVENT_PROVENANCE_VIOLATION: non-canonical payload_ref");
    }
    if (createsProvenanceCycle(event)) {
      throw new Error("EVENT_PROVENANCE_VIOLATION: provenance cycle detected");
    }
  },
};

export function validateEventOrdering(events: readonly OrderedEventArtifact[]): void {
  if (events.length === 0) return;

  const seqs = events.map((e) => e.ordering.sequence_number);
  const sorted = [...seqs].sort((a, b) => a - b);

  for (let i = 0; i < seqs.length; i++) {
    if (seqs[i] !== sorted[i]) {
      throw new Error("EVENT_ORDERING_VIOLATION: non-deterministic ordering");
    }
  }
}

export function validateEventCausality(event: CausalEventArtifact): void {
  for (const ref of event.causality.caused_by) {
    if (!ref.hash) {
      throw new Error("EVENT_CAUSALITY_VIOLATION: non-canonical causal ref");
    }
  }
}

export interface EventDeduplicationValidator {
  validate(previous: DeduplicatedEventArtifact, candidate: DeduplicatedEventArtifact): void;
}

export const DefaultEventDeduplicationValidator: EventDeduplicationValidator = {
  validate(previous, candidate) {
    if (
      previous.identity.idempotency_key === candidate.identity.idempotency_key &&
      previous.content_hash !== candidate.content_hash
    ) {
      throw new Error("EVENT_DEDUPLICATION_VIOLATION: conflicting artifacts");
    }
  },
};

export interface EventTemporalValidator {
  validate(event: TemporalEventArtifact): void;
}

export const DefaultEventTemporalValidator: EventTemporalValidator = {
  validate(event) {
    const { effective_at, observed_at } = event.temporal;

    if (effective_at && !isCanonicalTimestamp(effective_at)) {
      throw new Error("EVENT_TEMPORAL_INTEGRITY_VIOLATION: invalid effective_at");
    }
    if (observed_at && !isCanonicalTimestamp(observed_at)) {
      throw new Error("EVENT_TEMPORAL_INTEGRITY_VIOLATION: invalid observed_at");
    }
  },
};

export interface EventStreamValidator {
  validate(stream: EventStreamArtifact): void;
}

export const DefaultEventStreamValidator: EventStreamValidator = {
  validate(stream) {
    if (stream.event_refs.length === 0) {
      throw new Error("EVENT_STREAM_CANONICALIZATION_VIOLATION: empty stream");
    }

    const ids = stream.event_refs.map((ref) => ref.hash);
    const unique = new Set(ids);

    if (unique.size !== ids.length) {
      throw new Error("EVENT_STREAM_CANONICALIZATION_VIOLATION: duplicate refs");
    }
  },
};
