/**
 * Package 22.4 — CorrelationContext conformance (F22-7)
 */
import { describe, expect, it } from "vitest";
import {
  buildFailureIdentityPayload,
  canonicalFailureIdentity,
  computeFailureArtifactHash,
  createCorrelationContext,
  createFailureArtifact,
  InMemoryCorrelationResolver,
  InMemoryExecutionEventLog,
  FailureArtifactBuilder,
  toFailureArtifactReference,
} from "../src/index.js";

describe("F22-7 Correlation Isolation & Navigation", () => {
  it("F22-7.1 Request → execution", () => {
    const resolver = new InMemoryCorrelationResolver();
    resolver.register({
      request_id: "req-100",
      execution_id: "exec-100",
      trace_root_id: "otel-trace-abc",
    });

    expect(resolver.findExecution("req-100")).toBe("exec-100");
    expect(resolver.findTraceRoot("req-100")).toBe("otel-trace-abc");
    expect(resolver.findExecution("req-missing")).toBeUndefined();
  });

  it("F22-7.2 Execution → events [1,2,3]", () => {
    const resolver = new InMemoryCorrelationResolver();
    resolver.register({
      request_id: "req-200",
      execution_id: "exec-200",
      event_sequence: 1,
    });
    resolver.register({
      request_id: "req-200",
      execution_id: "exec-200",
      event_sequence: 3,
    });
    resolver.register({
      request_id: "req-200",
      execution_id: "exec-200",
      event_sequence: 2,
    });

    expect(resolver.findEvents("exec-200")).toEqual([1, 2, 3]);
  });

  it("F22-7.3 Artifact hash can be found from execution_id", () => {
    const artifact = new FailureArtifactBuilder()
      .withFailureCode("MPS-HARVEST-001")
      .withStage("IMPORT_GATE")
      .withExecutionId("exec-300")
      .withFailedControls(["IMPORT_GATE_SPATIAL_INVALID"])
      .withDiagnostics({ reason: "invalid_geometry" })
      .withCreatedAt("2026-08-07T12:00:00.000Z")
      .withRequestId("req-300")
      .build();

    const resolver = new InMemoryCorrelationResolver();
    const log = new InMemoryExecutionEventLog();

    log.append({
      execution_id: "exec-300",
      from_state: "CREATED",
      to_state: "IMPORT_GATE",
      stage: "IMPORT_GATE",
      occurred_at: "2026-08-07T12:00:00.000Z",
      actor: "SYSTEM",
      request_id: "req-300",
    });
    const blocked = log.append({
      execution_id: "exec-300",
      from_state: "IMPORT_GATE",
      to_state: "BLOCKED",
      stage: "IMPORT_GATE",
      failure_artifact_ref: toFailureArtifactReference(artifact),
      occurred_at: "2026-08-07T12:00:01.000Z",
      actor: "POLICY",
      request_id: "req-300",
    });

    resolver.register({
      request_id: "req-300",
      execution_id: "exec-300",
      event_sequence: 1,
    });
    resolver.register({
      request_id: "req-300",
      execution_id: "exec-300",
      event_sequence: blocked.sequence,
      artifact_hash: artifact.artifact_hash,
      ledger_sequence: 42,
    });

    expect(resolver.findArtifacts("exec-300")).toEqual([artifact.artifact_hash]);
    expect(resolver.findEvents("exec-300")).toEqual([1, 2]);
    expect(resolver.findLedgerSequence("exec-300")).toBe(42);

    const ctx = resolver.resolve("req-300");
    expect(ctx).toEqual(
      createCorrelationContext({
        request_id: "req-300",
        execution_id: "exec-300",
        event_sequence: 2,
        artifact_hashes: [artifact.artifact_hash],
        ledger_sequence: 42,
      }),
    );
  });

  it("F22-7.4 Correlation mutation does not affect FailureArtifact identity", () => {
    const identity = {
      failure_code: "MPS-HARVEST-001",
      stage: "IMPORT_GATE" as const,
      execution_id: "exec-400",
      input_refs: [
        {
          id: "geom-a",
          content_hash: { algorithm: "sha256", digest: "aaa" },
        },
      ],
      evidence_refs: [] as const,
      failed_controls: ["IMPORT_GATE_SPATIAL_INVALID"],
      diagnostics: { reason: "invalid_geometry" },
    };

    const before = computeFailureArtifactHash(buildFailureIdentityPayload(identity));

    const correlated = {
      ...identity,
      correlation_id: "req-123",
      request_id: "req-123",
      trace_root_id: "otel-xyz",
      ledger_sequence: 99,
      event_sequence: 7,
    };

    expect(computeFailureArtifactHash(canonicalFailureIdentity(correlated))).toBe(before);

    // Correlation keys smuggled into diagnostics must also be stripped.
    const withCorrInDiagnostics = {
      ...identity,
      diagnostics: {
        reason: "invalid_geometry",
        correlation_id: "req-999",
        trace_root_id: "otel-leak",
        request_id: "req-leak",
      },
    };
    expect(
      computeFailureArtifactHash(buildFailureIdentityPayload(withCorrInDiagnostics)),
    ).toBe(before);

    const a = createFailureArtifact({
      ...identity,
      created_at: "2026-08-07T12:00:00.000Z",
      request_id: "req-aaa",
    });
    const b = createFailureArtifact({
      ...identity,
      created_at: "2099-01-01T00:00:00.000Z",
      request_id: "req-bbb",
      host: "host-x",
    });
    expect(a.artifact_hash).toBe(b.artifact_hash);
    expect(a.artifact_hash).toBe(before);
  });

  it("CorrelationContext holds references only (no diagnostic payload)", () => {
    const ctx = createCorrelationContext({
      request_id: "req-ref",
      execution_id: "exec-ref",
      event_sequence: 1,
      artifact_hashes: ["hash-a", "hash-a", "hash-b"],
      ledger_sequence: 10,
      trace_root_id: "trace-1",
    });
    expect(ctx.artifact_hashes).toEqual(["hash-a", "hash-b"]);
    expect("diagnostics" in ctx).toBe(false);
    expect("failure_code" in ctx).toBe(false);
    expect("severity" in ctx).toBe(false);
  });

  it("conflicting request→execution mapping is rejected", () => {
    const resolver = new InMemoryCorrelationResolver();
    resolver.register({ request_id: "req-x", execution_id: "exec-1" });
    expect(() =>
      resolver.register({ request_id: "req-x", execution_id: "exec-2" }),
    ).toThrow(/already mapped/);
  });
});
