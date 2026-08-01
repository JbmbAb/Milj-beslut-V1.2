import { describe, expect, it } from "vitest";
import { DefaultPolicyDecisionEngine, PolicyEnforcementMiddleware } from "../index";
import type { PolicyRegistry, PolicyApprovalStore, PolicyInput } from "../index";
import { RuntimeViolation } from "@miljobeslut/mps-core";

class MockPolicyRegistry implements PolicyRegistry {
  policy_set = {
    schema_version: "policy.v1" as const,
    policy_set_id: "ps-1",
    policy_set_hash: "hash-ps-1",
    policies: [
      {
        policy_id: "pol-1",
        policy_version: "1.0",
        policy_hash: "hash-pol-1",
        content: new Uint8Array(),
      },
    ],
  };

  getPolicyContent(_policy_id: string): Uint8Array | null {
    return new Uint8Array();
  }
}

class MockApprovalStore implements PolicyApprovalStore {
  constructor(private readonly approvals: Record<string, any>) {}
  async getByDecisionId(decision_id: string) {
    return this.approvals[decision_id] ?? null;
  }
}

const mockSerializer = { serialize: () => new Uint8Array() };
const mockHashEngine = { hash: () => ({ algorithm: "sha256", digest: "mock-hash" }) };
const mockIdGen = { generate: () => "dec-123" };
const mockClock = { now: () => new Date("2026-07-31T12:00:00Z") };

describe("MPS Policy Decision Layer Suite", () => {
  it("evaluates to ALLOW when policy passes", async () => {
    const engine = new DefaultPolicyDecisionEngine(
      mockSerializer,
      mockHashEngine,
      new MockPolicyRegistry(),
      mockIdGen,
      mockClock
    );

    const input: PolicyInput = {
      runtime_id: "run-1",
      registry_snapshot_id: "snap-1",
      registry_hash: "snap-hash",
      stage: "PROMOTION",
      reference: { id: "art-1", content_hash: { algorithm: "sha256", digest: "hash-art" } },
      metadata: {},
    };

    const decision = await engine.evaluate(input);
    expect(decision.decision).toBe("ALLOW");
    expect(decision.decision_id).toBe("dec-123");
  });

  it("enforcement middleware permits ALLOW decisions", async () => {
    const engine = new DefaultPolicyDecisionEngine(
      mockSerializer,
      mockHashEngine,
      new MockPolicyRegistry(),
      mockIdGen,
      mockClock
    );
    const store = new MockApprovalStore({});
    const middleware = new PolicyEnforcementMiddleware(engine, store);

    const input: PolicyInput = {
      runtime_id: "run-1",
      registry_snapshot_id: "snap-1",
      registry_hash: "snap-hash",
      stage: "PROMOTION",
      reference: { id: "art-1", content_hash: { algorithm: "sha256", digest: "hash-art" } },
      metadata: {},
    };

    const result = await middleware.enforce(input);
    expect(result.decision).toBe("ALLOW");
  });

  it("enforcement middleware blocks and throws for REVIEW without approval", async () => {
    class ReviewPolicyRegistry extends MockPolicyRegistry {
      getPolicyContent() { return null; } // triggers REVIEW fallback
    }

    const engine = new DefaultPolicyDecisionEngine(
      mockSerializer,
      mockHashEngine,
      new ReviewPolicyRegistry(),
      mockIdGen,
      mockClock
    );
    const store = new MockApprovalStore({});
    const middleware = new PolicyEnforcementMiddleware(engine, store);

    const input: PolicyInput = {
      runtime_id: "run-1",
      registry_snapshot_id: "snap-1",
      registry_hash: "snap-hash",
      stage: "PROMOTION",
      reference: { id: "art-1", content_hash: { algorithm: "sha256", digest: "hash-art" } },
      metadata: {},
    };

    await expect(middleware.enforce(input)).rejects.toThrow(RuntimeViolation);
  });
});
