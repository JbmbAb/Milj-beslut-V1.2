import { describe, expect, it } from "vitest";

import {
  ControlPlaneTransitionError,
  InMemoryLeaseRegistry,
  LeaseConflictError,
  applyVerifiedHandoff,
  canTransition,
  classifyVerifierFailure,
  type AgentHandoff,
  type AgentLease,
  type MultiAgentUnitState,
} from "../../../packages/mps-control-plane/src/multi-agent";

const BASE = "1".repeat(40);
const CANDIDATE = "2".repeat(40);

function unit(state: MultiAgentUnitState["state"]): MultiAgentUnitState {
  return {
    unitId: "K1",
    baseSha: BASE,
    candidateSha: CANDIDATE,
    state,
    revision: 7,
  };
}

function verifier(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    agentRunId: "verify-1",
    unitId: "K1",
    role: "VERIFIER",
    inputState: "VERIFYING",
    observedBaseSha: BASE,
    observedCandidateSha: CANDIDATE,
    result: "PASS",
    verifierIndependent: true,
    findingClassifications: [],
    ...overrides,
  };
}

function lease(overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    leaseId: "lease-1",
    unitId: "K1",
    role: "IMPLEMENTER",
    holder: "claude-a",
    scope: ["packages/mps-data-governance/**"],
    candidateSha: CANDIDATE,
    issuedAt: "2026-09-05T00:00:00.000Z",
    expiresAt: "2026-09-05T01:00:00.000Z",
    heartbeatAt: "2026-09-05T00:30:00.000Z",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("Multi-Agent Control Plane V1", () => {
  it("rejects illegal state jumps", () => {
    expect(canTransition("VERIFYING", "PROMOTED")).toBe(false);
    expect(() => applyVerifiedHandoff(unit("VERIFYING"), verifier(), "PROMOTED")).toThrow(
      ControlPlaneTransitionError,
    );
  });

  it("accepts independent verifier PASS only for the exact canonical candidate SHA", () => {
    const next = applyVerifiedHandoff(unit("VERIFYING"), verifier(), "READY_FOR_DEV_GOV");
    expect(next.state).toBe("READY_FOR_DEV_GOV");
    expect(next.revision).toBe(8);

    expect(() =>
      applyVerifiedHandoff(
        unit("VERIFYING"),
        verifier({ observedCandidateSha: "3".repeat(40) }),
        "READY_FOR_DEV_GOV",
      ),
    ).toThrow(/candidate SHA/);
  });

  it("rejects verifier PASS when verifier independence is absent", () => {
    expect(() =>
      applyVerifiedHandoff(
        unit("VERIFYING"),
        verifier({ verifierIndependent: false }),
        "READY_FOR_DEV_GOV",
      ),
    ).toThrow(/independent verifier/);
  });

  it("rejects stale handoffs after canonical state has moved", () => {
    expect(() =>
      applyVerifiedHandoff(
        unit("READY_FOR_DEV_GOV"),
        verifier({ inputState: "VERIFYING" }),
        "PROVING_RED",
      ),
    ).toThrow(/stale handoff/);
  });

  it("routes mechanical-only verifier failures to delta verification and semantic failures to full verification", () => {
    expect(
      classifyVerifierFailure(
        verifier({
          result: "FAIL",
          findingClassifications: ["MECHANICAL", "MECHANICAL"],
        }),
      ),
    ).toBe("DELTA_REVERIFY");

    expect(
      classifyVerifierFailure(
        verifier({ result: "FAIL", findingClassifications: ["MECHANICAL", "SEMANTIC"] }),
      ),
    ).toBe("FULL_REVERIFY");
  });

  it("prevents overlapping active implementer leases for the same unit and scope", () => {
    const registry = new InMemoryLeaseRegistry();
    registry.acquire(lease(), new Date("2026-09-05T00:30:00.000Z"));

    expect(() =>
      registry.acquire(
        lease({ leaseId: "lease-2", holder: "codex", scope: ["packages/mps-data-governance/**"] }),
        new Date("2026-09-05T00:31:00.000Z"),
      ),
    ).toThrow(LeaseConflictError);
  });

  it("allows reclaim after lease expiry without changing canonical candidate identity", () => {
    const registry = new InMemoryLeaseRegistry();
    registry.acquire(lease(), new Date("2026-09-05T00:30:00.000Z"));
    registry.acquire(
      lease({ leaseId: "lease-2", holder: "claude-b" }),
      new Date("2026-09-05T01:01:00.000Z"),
    );

    const active = registry.activeFor("K1");
    expect(active).toHaveLength(1);
    expect(active[0].candidateSha).toBe(CANDIDATE);
    expect(active[0].holder).toBe("claude-b");
  });
});
