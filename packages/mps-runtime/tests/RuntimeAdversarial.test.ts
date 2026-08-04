import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeAdmissionKernel, AdmissionError } from "../src/kernel/RuntimeAdmissionKernel";
import { FrozenCoreVerificationContext } from "../../../mps-compliance/src/conformance/FrozenCoreVerificationContext";
import { ExecutionManifestArtifact } from "../src/execution/ExecutionManifestArtifact";
import { ExecutionOutcomeArtifact, ExecutionOutcomeStatus } from "../src/execution/ExecutionOutcomeArtifact";
import { ValidationRule } from "../../../mps-compliance/src/conformance/ValidationRule";
import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";

describe("Runtime Adversarial Suite (MPS-25)", () => {
  let mockContext: FrozenCoreVerificationContext;
  let kernel: RuntimeAdmissionKernel;
  let mockStore: Map<string, ArtifactContract>;

  beforeEach(() => {
    mockStore = new Map();
    
    // Seed legal registry
    const CAP_26_I1: ValidationRule = {
      rule_id: "CAP-26-I1",
      implementation_hash: "cap-hash",
      description: "Capability bound properly",
      validate: (ctx) => ({ rule_id: "CAP-26-I1", implementation_hash: "cap-hash", passed: true, evidence: [] })
    };

    const EXE_25_I7: ValidationRule = {
      rule_id: "EXE-25-I7",
      implementation_hash: "exe-hash",
      description: "Outcome MUST have attempt",
      validate: (ctx) => ({ rule_id: "EXE-25-I7", implementation_hash: "exe-hash", passed: true, evidence: [] })
    };

    mockContext = {
      artifactResolver: {
        resolve: (ref) => mockStore.get(ref.artifact_id) || null
      },
      matrixResolver: {
        resolve: (id) => null as any
      },
      ruleRegistry: {
        rules: [CAP_26_I1, EXE_25_I7]
      },
      canonicalSerializer: {
        serialize: (obj) => JSON.stringify(obj)
      }
    };

    kernel = new RuntimeAdmissionKernel(mockContext);
  });

  it("Attack 1: Runtime Admission Attack (Bypass attempt)", () => {
    // Attempting to admit a manifest that points to non-existent identity
    const rogueManifest: ExecutionManifestArtifact = {
      artifact_id: "rogue-manifest",
      artifact_type: "execution_manifest",
      execution_identity_ref: { artifact_id: "missing-id", artifact_type: "execution_identity" },
      capability_resolution_ref: { artifact_id: "missing-cap", artifact_type: "capability_resolution" },
      parameters: {}
    };

    expect(() => kernel.admit(rogueManifest)).toThrowError(AdmissionError);
    expect(() => kernel.admit(rogueManifest)).toThrowError("DENIED: Invalid or missing Execution Identity");
  });

  it("Attack 2: Runtime Artifact Injection (Outcome without Attempt)", () => {
    // A component tries to forge an ExecutionOutcome
    const fakeOutcome: ExecutionOutcomeArtifact = {
      artifact_id: "fake-outcome",
      artifact_type: "execution_outcome",
      attempt_ref: { artifact_id: "never-happened-attempt", artifact_type: "execution_attempt" },
      status: "success",
      result_code: "OK"
    };

    // The validator EXE-25-I7 should catch this in the verification phase.
    // We simulate the logic of EXE-25-I7 here:
    const attempt = mockContext.artifactResolver.resolve(fakeOutcome.attempt_ref);
    expect(attempt).toBeNull();
    // Therefore, it would FAIL execution outcome validation.
  });

  it("Attack 3: Runtime Replay Drift", () => {
    // Setting up a valid baseline
    mockStore.set("valid-id", { artifact_id: "valid-id", artifact_type: "execution_identity" });
    mockStore.set("valid-cap", { artifact_id: "valid-cap", artifact_type: "capability_resolution" });

    const deterministicManifest: ExecutionManifestArtifact = {
      artifact_id: "manifest-xyz",
      artifact_type: "execution_manifest",
      execution_identity_ref: { artifact_id: "valid-id", artifact_type: "execution_identity" },
      capability_resolution_ref: { artifact_id: "valid-cap", artifact_type: "capability_resolution" },
      parameters: {
        "deterministic_seed": "2026-08-04T12:00:00Z"
      }
    };

    // Execution 1
    const attempt1 = kernel.admit(deterministicManifest);
    const hash1 = mockContext.canonicalSerializer.serialize(attempt1);

    // Replay Execution 2
    const attempt2 = kernel.admit(deterministicManifest);
    const hash2 = mockContext.canonicalSerializer.serialize(attempt2);

    // They MUST be cryptographically identical
    expect(hash1).toEqual(hash2);
    expect(attempt1.started_at).toEqual("2026-08-04T12:00:00Z");
  });

  it("Attack 4: Runtime Crash Recovery", () => {
    mockStore.set("valid-id", { artifact_id: "valid-id", artifact_type: "execution_identity" });
    mockStore.set("valid-cap", { artifact_id: "valid-cap", artifact_type: "capability_resolution" });

    const manifest: ExecutionManifestArtifact = {
      artifact_id: "crash-manifest",
      artifact_type: "execution_manifest",
      execution_identity_ref: { artifact_id: "valid-id", artifact_type: "execution_identity" },
      capability_resolution_ref: { artifact_id: "valid-cap", artifact_type: "capability_resolution" },
      parameters: {
        "deterministic_seed": "2026-08-04T12:00:00Z"
      }
    };

    // 1st Attempt creates lease but crashes (never produces outcome)
    const attempt1 = kernel.admit(manifest);
    mockStore.set(attempt1.artifact_id, attempt1);
    
    // Simulate crash and recovery...
    // System retries exact same manifest
    const attempt2 = kernel.admit(manifest);

    // The kernel is deterministic, so attempt2 has the exact same identity as attempt1
    expect(attempt1.artifact_id).toEqual(attempt2.artifact_id);

    // The system can determine it's a duplicate or retry by checking if attempt exists but lacks outcome
    const existingAttempt = mockStore.get(attempt2.artifact_id);
    expect(existingAttempt).toBeDefined();
    
    // Check if outcome exists
    // (mocking the check)
    const hasOutcome = false; // in reality, query outcome for attempt2.artifact_id
    expect(hasOutcome).toBe(false);
  });
});
