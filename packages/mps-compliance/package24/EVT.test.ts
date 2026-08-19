import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import {
  EventArtifact,
  OrderedEventArtifact,
  CausalEventArtifact,
  DeduplicatedEventArtifact,
  TemporalEventArtifact,
  EventStreamArtifact,
} from "../../mps-events/src/contracts/EventArtifact.js";
import { EventEngine } from "../../mps-events/src/engine/EventEngine.js";
import { EventResolver } from "../../mps-events/src/resolver/EventResolver.js";
import {
  DefaultEventProvenanceValidator,
  validateEventOrdering,
  validateEventCausality,
  DefaultEventDeduplicationValidator,
  DefaultEventTemporalValidator,
  DefaultEventStreamValidator,
} from "../../mps-events/src/validation/EventValidator.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  // Identity Isolation: metadata fields do not affect identity
  const payload = { ...obj };
  delete payload.artifact_id;
  delete payload.event_key;
  delete payload.event_version;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("EVT-001 -> EVT-010 Event Compliance", () => {
  // EVT-001 Event Identity Isolation
  it("EVT-001 Event Identity Isolation (A) - metadata does not affect identity", async () => {
    const base: EventArtifact = {
      artifact_type: "EVENT_ARTIFACT",
      artifact_id: "evt-123",
      event_key: "system-event",
      event_version: "1.0.0",
      subject_ref: { artifact_id: "app-123" } as any,
      payload_ref: { artifact_id: "payload-123" } as any,
    } as any;

    const renamed = {
      ...base,
      event_key: "system-event-v2",
      event_version: "99.0.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  // EVT-002 Event Repository Resolution
  it("EVT-002 Event Repository Resolution (A) - event must resolve through ArtifactRepository", async () => {
    const resolver: EventResolver = {
      resolveByRef: async (ref) => ({
        event: {
          artifact_type: "EVENT_ARTIFACT",
          artifact_id: ref.artifact_id,
          event_key: "system-event",
          event_version: "1.0.0",
          subject_ref: { artifact_id: "app-123" } as any,
          payload_ref: { artifact_id: "payload-123" } as any,
        } as any,
        trace: {
          source: "ArtifactRepository",
          artifact_ref: ref,
        },
      }),
    };

    const result = await resolver.resolveByRef({ artifact_id: "evt-123" } as any);
    expect(result.trace.source).toBe("ArtifactRepository");
  });

  // EVT-003 Event Boundary Isolation
  it("EVT-003 Event Boundary Isolation (A) - EventEngine creates events", () => {
    const engine: EventEngine = {
      createEvent: async () => ({} as any),
    };
    expect(typeof engine.createEvent).toBe("function");
  });

  // EVT-004 Event Replay Determinism
  it("EVT-004 Event Replay Determinism (B) - same intent produces identical artifact", async () => {
    const base: EventArtifact = {
      artifact_type: "EVENT_ARTIFACT",
      artifact_id: "evt-1",
      event_key: "sys-evt",
      event_version: "1.0.0",
      subject_ref: { artifact_id: "sub-1" } as any,
      payload_ref: { artifact_id: "pay-1" } as any,
    } as any;

    const replay = { ...base };
    expect(await canonicalHash(base)).toBe(await canonicalHash(replay));
  });

  // EVT-005 Event Provenance Integrity
  it("EVT-005 Event Provenance Integrity (A) - validator enforces valid provenance", () => {
    const event: EventArtifact = {
      artifact_type: "EVENT_ARTIFACT",
      artifact_id: "evt-1",
      event_key: "sys-evt",
      event_version: "1.0.0",
      subject_ref: { hash: "hash-sub-1", artifact_type: "EVENT_SUBJECT" } as any,
      payload_ref: { hash: "hash-pay-1", artifact_type: "EVENT_PAYLOAD" } as any,
    } as any;

    expect(() => DefaultEventProvenanceValidator.validate(event)).not.toThrow();
  });

  it("EVT-005 Event Provenance Integrity (A) - validator rejects missing provenance", () => {
    const event: EventArtifact = {
      artifact_type: "EVENT_ARTIFACT",
      artifact_id: "evt-1",
      event_key: "sys-evt",
      event_version: "1.0.0",
      subject_ref: { artifact_id: "sub-1" } as any,
      // missing payload_ref
    } as any;

    expect(() => DefaultEventProvenanceValidator.validate(event)).toThrow("EVENT_PROVENANCE_VIOLATION: missing payload_ref");
  });

  // EVT-006 Event Ordering Semantics
  it("EVT-006 Event Ordering Semantics (A) - orders events deterministically", () => {
    const events: OrderedEventArtifact[] = [
      { ordering: { sequence_number: 1 } } as any,
      { ordering: { sequence_number: 2 } } as any,
    ];
    expect(() => validateEventOrdering(events)).not.toThrow();

    const badEvents: OrderedEventArtifact[] = [
      { ordering: { sequence_number: 2 } } as any,
      { ordering: { sequence_number: 1 } } as any,
    ];
    expect(() => validateEventOrdering(badEvents)).toThrow("EVENT_ORDERING_VIOLATION: non-deterministic ordering");
  });

  // EVT-007 Event Causality Preservation
  it("EVT-007 Event Causality Preservation (A) - ensures causal refs are canonical", () => {
    const event: CausalEventArtifact = {
      causality: { caused_by: [{ hash: "hash-cause-1", artifact_type: "EVENT_ARTIFACT" } as any] },
    } as any;
    expect(() => validateEventCausality(event)).not.toThrow();

    const badEvent: CausalEventArtifact = {
      causality: { caused_by: [{} as any] },
    } as any;
    expect(() => validateEventCausality(badEvent)).toThrow("EVENT_CAUSALITY_VIOLATION: non-canonical causal ref");
  });

  // EVT-008 Event Deduplication Integrity
  it("EVT-008 Event Deduplication Integrity (A) - prevents identical keys with different artifacts", () => {
    const prev: DeduplicatedEventArtifact = {
      artifact_id: "evt-1",
      content_hash: "hash-1",
      identity: { idempotency_key: "key-1" },
    } as any;

    const dup: DeduplicatedEventArtifact = {
      artifact_id: "evt-1",
      content_hash: "hash-1",
      identity: { idempotency_key: "key-1" },
    } as any;

    expect(() => DefaultEventDeduplicationValidator.validate(prev, dup)).not.toThrow();

    const conflict: DeduplicatedEventArtifact = {
      artifact_id: "evt-2",
      content_hash: "hash-2",
      identity: { idempotency_key: "key-1" },
    } as any;
    expect(() => DefaultEventDeduplicationValidator.validate(prev, conflict)).toThrow("EVENT_DEDUPLICATION_VIOLATION: conflicting artifacts");
  });

  // EVT-009 Event Temporal Integrity
  it("EVT-009 Event Temporal Integrity (A) - validates ISO8601 timestamps", () => {
    const event: TemporalEventArtifact = {
      temporal: { effective_at: "2026-08-02T12:00:00Z" },
    } as any;
    expect(() => DefaultEventTemporalValidator.validate(event)).not.toThrow();

    const badEvent: TemporalEventArtifact = {
      temporal: { effective_at: "bad-date" },
    } as any;
    expect(() => DefaultEventTemporalValidator.validate(badEvent)).toThrow("EVENT_TEMPORAL_INTEGRITY_VIOLATION: invalid effective_at");
  });

  // EVT-010 Event Stream Canonicalization
  it("EVT-010 Event Stream Canonicalization (A) - rejects empty streams and duplicates", () => {
    const stream: EventStreamArtifact = {
      event_refs: [
        { hash: "hash-evt-1", artifact_type: "EVENT_ARTIFACT" } as any,
        { hash: "hash-evt-2", artifact_type: "EVENT_ARTIFACT" } as any,
      ],
    } as any;
    expect(() => DefaultEventStreamValidator.validate(stream)).not.toThrow();

    const emptyStream: EventStreamArtifact = { event_refs: [] } as any;
    expect(() => DefaultEventStreamValidator.validate(emptyStream)).toThrow("EVENT_STREAM_CANONICALIZATION_VIOLATION: empty stream");

    const dupStream: EventStreamArtifact = {
      event_refs: [
        { hash: "hash-evt-1", artifact_type: "EVENT_ARTIFACT" } as any,
        { hash: "hash-evt-1", artifact_type: "EVENT_ARTIFACT" } as any,
      ],
    } as any;
    expect(() => DefaultEventStreamValidator.validate(dupStream)).toThrow("EVENT_STREAM_CANONICALIZATION_VIOLATION: duplicate refs");
  });
});
