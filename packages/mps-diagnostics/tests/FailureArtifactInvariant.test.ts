/**
 * Package 22.2 — FailureArtifact governance invariants (F22-5 + chain)
 */
import { describe, expect, it } from "vitest";
import {
  assertBlockedFailureArtifactRequired,
  ExecutionEventLogError,
  FailureArtifactBuilder,
  FailureArtifactError,
  InMemoryExecutionEventLog,
  toFailureArtifactReference,
} from "../src/index.js";

describe("F22-5 BLOCKED FailureArtifact binding (Diagnostic Governance)", () => {
  it("BLOCKED without FailureArtifactReference is rejected", () => {
    expect(() =>
      assertBlockedFailureArtifactRequired("BLOCKED", undefined),
    ).toThrow(FailureArtifactError);

    const log = new InMemoryExecutionEventLog();
    log.append({
      execution_id: "exec-blocked-1",
      from_state: "CREATED",
      to_state: "IMPORT_GATE",
      stage: "IMPORT_GATE",
      occurred_at: "2026-08-07T11:00:00.000Z",
      actor: "SYSTEM",
    });

    expect(() =>
      log.append({
        execution_id: "exec-blocked-1",
        from_state: "IMPORT_GATE",
        to_state: "BLOCKED",
        stage: "IMPORT_GATE",
        occurred_at: "2026-08-07T11:00:01.000Z",
        actor: "POLICY",
      }),
    ).toThrow(ExecutionEventLogError);
  });

  it("BLOCKED with FailureArtifactReference commits and binds evidence into transition", () => {
    const artifact = new FailureArtifactBuilder()
      .withFailureCode("MPS-HARVEST-001")
      .withStage("IMPORT_GATE")
      .withExecutionId("exec-blocked-2")
      .withFailedControls(["IMPORT_GATE_SPATIAL_INVALID"])
      .withInputRefs([
        {
          id: "geom-a",
          content_hash: { algorithm: "sha256", digest: "aaa111" },
        },
      ])
      .withEvidenceRefs([
        {
          artifact_id: "underlag-a",
          content_hash: { algorithm: "sha256", digest: "ev-a" },
        },
        {
          artifact_id: "underlag-b",
          content_hash: { algorithm: "sha256", digest: "ev-b" },
        },
      ])
      .withDiagnostics({ reason: "invalid_spatial_geometry" })
      .withCreatedAt("2026-08-07T11:00:00.000Z")
      .withRequestId("req-42")
      .build();

    const ref = toFailureArtifactReference(artifact);
    const log = new InMemoryExecutionEventLog();

    log.append({
      execution_id: "exec-blocked-2",
      from_state: "CREATED",
      to_state: "IMPORT_GATE",
      stage: "IMPORT_GATE",
      occurred_at: "2026-08-07T11:00:00.000Z",
      actor: "SYSTEM",
      request_id: "req-42",
    });

    const blocked = log.append({
      execution_id: "exec-blocked-2",
      from_state: "IMPORT_GATE",
      to_state: "BLOCKED",
      stage: "IMPORT_GATE",
      failure_artifact_ref: ref,
      occurred_at: "2026-08-07T11:00:01.000Z",
      actor: "POLICY",
      request_id: "req-42",
    });

    expect(blocked.to_state).toBe("BLOCKED");
    expect(blocked.output_refs.some((r) => r.artifact_id === ref.artifact_id)).toBe(
      true,
    );
    expect(
      blocked.output_refs.find((r) => r.artifact_id === ref.artifact_id)?.content_hash
        ?.digest,
    ).toBe(ref.artifact_hash);
    expect(log.verifyChain("exec-blocked-2")).toBe(true);

    // Narrative chain: execution → IMPORT_GATE → BLOCKED → FailureArtifact hash
    expect(artifact.failure_code).toBe("MPS-HARVEST-001");
    expect(artifact.failed_controls).toContain("IMPORT_GATE_SPATIAL_INVALID");
    expect(artifact.evidence_refs.map((e) => e.artifact_id).sort()).toEqual([
      "underlag-a",
      "underlag-b",
    ]);
  });

  it("non-BLOCKED transitions do not require FailureArtifactReference", () => {
    expect(() =>
      assertBlockedFailureArtifactRequired("IMPORT_GATE", undefined),
    ).not.toThrow();

    const log = new InMemoryExecutionEventLog();
    const event = log.append({
      execution_id: "exec-ok",
      from_state: "CREATED",
      to_state: "HARVESTED",
      stage: "HARVEST",
      occurred_at: "2026-08-07T11:00:00.000Z",
      actor: "SYSTEM",
    });
    expect(event.to_state).toBe("HARVESTED");
  });
});
