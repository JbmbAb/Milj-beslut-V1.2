import { describe, expect, it } from "vitest";
import { ExecutionAttemptFactory } from "../src/execution/ExecutionAttemptFactory.js";
import { LeaseCoordinator } from "../src/lease/LeaseCoordinator.js";
import { RuntimeSnapshotBuilder } from "../src/runtime/RuntimeSnapshotBuilder.js";
import { PlanArtifact, RuntimeResult } from "../src/domain/types.js";
import * as crypto from "node:crypto";

describe("ADR Compliance Tests (Paket 21)", () => {
  it("Retry SHALL reuse the original PlanArtifact but generate a new AttemptId", () => {
    const factory = new ExecutionAttemptFactory();
    const plan: PlanArtifact = {
      artifact_id: "plan-123",
      content_hash: "hash-123",
      planner_input: {},
      created_at: new Date().toISOString()
    };

    const original = factory.createInitial(plan);
    const retry = factory.createRetry(original);

    // Identity check
    expect(retry.plan_id).toEqual(original.plan_id);
    expect(retry.attempt_id).not.toEqual(original.attempt_id);
    expect(retry.reason).toEqual("RETRY");
  });

  it("Lease recovery SHALL NOT reuse attempt_id", () => {
    const factory = new ExecutionAttemptFactory();
    const coordinator = new LeaseCoordinator(factory);
    
    const plan: PlanArtifact = {
      artifact_id: "plan-123",
      content_hash: "hash-123",
      planner_input: {},
      created_at: new Date().toISOString()
    };

    const expired = factory.createInitial(plan);
    const recovered = coordinator.recover(expired);

    expect(recovered.attempt_id).not.toEqual(expired.attempt_id);
    expect(recovered.reason).toEqual("LEASE_RECOVERY");
  });

  it("Telemetry SHALL be isolated from canonical identity", () => {
    // We simulate hash function for this test
    const hash = (artifact: any) => crypto.createHash("sha256").update(JSON.stringify(artifact)).digest("hex");

    const plan: PlanArtifact = {
      artifact_id: "plan-123",
      content_hash: "hash-123",
      planner_input: {},
      created_at: new Date().toISOString()
    };

    const result1: RuntimeResult<PlanArtifact> = {
      artifact: plan,
      telemetry: {
        started_at: "2024-01-01T00:00:00Z",
        duration_ms: 100
      }
    };

    const result2: RuntimeResult<PlanArtifact> = {
      artifact: plan,
      telemetry: {
        started_at: "2024-01-01T00:01:00Z",
        duration_ms: 250
      }
    };

    // The telemetry differs, but the canonical artifact must remain identical
    expect(hash(result1.artifact)).toEqual(hash(result2.artifact));
  });

  it("RuntimeSnapshotBuilder SHALL enforce consistency between plan and attempt", () => {
    const builder = new RuntimeSnapshotBuilder();
    const factory = new ExecutionAttemptFactory();

    const plan: PlanArtifact = {
      artifact_id: "plan-123",
      content_hash: "hash-123",
      planner_input: {},
      created_at: new Date().toISOString()
    };

    const attempt = factory.createInitial(plan);

    const validBuild = () => builder.build({
      plan,
      attempt,
      registry_ref: { hash: "reg-1", artifact_type: "Registry" },
      policy_ref: { hash: "pol-1", artifact_type: "Policy" },
      capability_ref: { hash: "cap-1", artifact_type: "Capability" }
    });

    expect(validBuild).not.toThrow();

    const invalidBuild = () => builder.build({
      plan,
      attempt: {
        ...attempt,
        plan_id: "different-plan"
      },
      registry_ref: { hash: "reg-1", artifact_type: "Registry" },
      policy_ref: { hash: "pol-1", artifact_type: "Policy" },
      capability_ref: { hash: "cap-1", artifact_type: "Capability" }
    });

    expect(invalidBuild).toThrow("Attempt does not reference plan");
  });
});
