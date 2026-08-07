/**
 * Package 22.2 — FailureArtifact hash invariants F22-1..F22-4
 */
import { describe, expect, it } from "vitest";
import {
  createFailureArtifact,
  FailureArtifactBuilder,
  verifyFailureArtifactIntegrity,
  canonicalizeJson,
  hashCanonical,
} from "../src/index.js";

const baseInput = {
  failure_code: "MPS-HARVEST-001",
  stage: "IMPORT_GATE" as const,
  execution_id: "exec-fail-1",
  input_refs: [
    {
      id: "geom-a",
      content_hash: { algorithm: "sha256", digest: "aaa111" },
    },
  ],
  evidence_refs: [
    {
      artifact_id: "gate-report-1",
      content_hash: { algorithm: "sha256", digest: "bbb222" },
    },
  ],
  failed_controls: ["IMPORT_GATE_SPATIAL_INVALID"],
  diagnostics: { rule: "spatial_validity", reason: "invalid_geometry" },
  created_at: "2026-08-07T11:00:00.000Z",
};

describe("F22 FailureArtifact hash invariants", () => {
  it("F22-1 Identity determinism: same failure identity → same artifact_hash", () => {
    const a = createFailureArtifact(baseInput);
    const b = createFailureArtifact({
      ...baseInput,
      created_at: "2026-08-07T11:00:00.000Z",
      host: undefined,
    });
    expect(a.artifact_hash).toBe(b.artifact_hash);
    expect(a.artifact_id).toBe(b.artifact_id);
    expect(verifyFailureArtifactIntegrity(a)).toBe(true);
  });

  it("F22-2 Metadata isolation: created_at/host/runtime change → same artifact_hash", () => {
    const a = createFailureArtifact(baseInput);
    const b = createFailureArtifact({
      ...baseInput,
      created_at: "2099-12-31T23:59:59.000Z",
      host: "worker-99.example.local",
      runtime_version: "99.0.0",
      request_id: "req-different",
    });
    expect(a.artifact_hash).toBe(b.artifact_hash);
    expect(a.created_at).not.toBe(b.created_at);
    expect(a.host).not.toBe(b.host);
  });

  it("F22-3 Evidence binding: input_ref change → new hash", () => {
    const a = createFailureArtifact(baseInput);
    const b = createFailureArtifact({
      ...baseInput,
      input_refs: [
        {
          id: "geom-a",
          content_hash: { algorithm: "sha256", digest: "CHANGED" },
        },
      ],
    });
    expect(a.artifact_hash).not.toBe(b.artifact_hash);
  });

  it("F22-4 Diagnostic canonicalization: key order does not affect hash", () => {
    const a = createFailureArtifact({
      ...baseInput,
      diagnostics: { a: 1, b: 2 },
    });
    const b = createFailureArtifact({
      ...baseInput,
      diagnostics: { b: 2, a: 1 },
    });
    expect(a.artifact_hash).toBe(b.artifact_hash);
    expect(canonicalizeJson({ a: 1, b: 2 })).toBe(canonicalizeJson({ b: 2, a: 1 }));
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });

  it("forbidden diagnostic keys (stack/path/host/timestamp) excluded from hash", () => {
    const clean = createFailureArtifact({
      ...baseInput,
      diagnostics: { rule: "spatial_validity" },
    });
    const dirty = createFailureArtifact({
      ...baseInput,
      diagnostics: {
        rule: "spatial_validity",
        stackTrace: "Error\n    at Object.<anonymous> (/tmp/x.ts:1:1)",
        path: "C:\\Users\\secret\\file.geojson",
        hostname: "evil-host",
        created_at: "2020-01-01T00:00:00.000Z",
        uuid: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(dirty.artifact_hash).toBe(clean.artifact_hash);
  });

  it("builder produces equivalent hash to createFailureArtifact", () => {
    const viaCreate = createFailureArtifact(baseInput);
    const viaBuilder = new FailureArtifactBuilder()
      .withFailureCode(baseInput.failure_code)
      .withStage(baseInput.stage)
      .withExecutionId(baseInput.execution_id)
      .withInputRefs(baseInput.input_refs)
      .withEvidenceRefs(baseInput.evidence_refs)
      .withFailedControls(baseInput.failed_controls)
      .withDiagnostics(baseInput.diagnostics)
      .withCreatedAt(baseInput.created_at)
      .withHost("ignored-for-hash")
      .build();
    expect(viaBuilder.artifact_hash).toBe(viaCreate.artifact_hash);
  });
});
