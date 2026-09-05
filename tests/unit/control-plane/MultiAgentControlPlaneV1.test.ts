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
const UNIT_HASH = "a".repeat(64);
const PROOF_HASH = "b".repeat(64);

function unit(state: MultiAgentUnitState["state"]): MultiAgentUnitState {
  return {
    unitId: "K1",
    unitDefinitionHash: UNIT_HASH,
    baseSha: BASE,
    candidateSha: CANDIDATE,
    branch: "claude/k1-governed-harvest-canonical-entrypoint-01",
    scope: ["packages/mps-data-governance/**"],
    proofContractHash: PROOF_HASH,
    controllerContractVersion: "multi-agent-control-plane-v1",
    state,
    revision: 7,
    updatedAt: "2026-09-05T00:00:00.000Z",
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
    unitDefinitionHash: UNIT_HASH,
    proofContractHash: PROOF_HASH,
    result: "PASS",
    verifierIndependent: true,
    findings: [],
    outputArtifacts: [],
    startedAt: "2026-09-05T00:10:00.000Z",
    finishedAt: "2026-09-05T00:20:00.000Z",
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
    expect(next.updatedAt).toBe("2026-09-05T00:20:00.000Z");

    expect(() =>
      applyVerifiedHandoff(
        unit("VERIFYING"),
        verifier({ observedCandidateSha: "3".repeat(40) }),
        "READY_FOR_DEV_GOV",
      ),
    ).toThrow(/candidate SHA/);
  });

  it("rejects unit-definition and proof-contract identity substitution", () => {
    expect(() =>
      applyVerifiedHandoff(
        unit("VERIFYING"),
        verifier({ unitDefinitionHash: "c".repeat(64) }),
        "READY_FOR_DEV_GOV",
      ),
    ).toThrow(/unit definition hash/);

    expect(() =>
      applyVerifiedHandoff(
        unit("VERIFYING"),
        verifier({ proofContractHash: "d".repeat(64) }),
        "READY_FOR_DEV_GOV",
      ),
    ).toThrow(/proof contract hash/);
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
          findings: [
            {
              id: "F1",
              severity: "BLOCKING",
              classification: "MECHANICAL",
              message: "format",
            },
            {
              id: "F2",
              severity: "BLOCKING",
              classification: "MECHANICAL",
              message: "lint",
            },
          ],
        }),
      ),
    ).toBe("DELTA_REVERIFY");

    expect(
      classifyVerifierFailure(
        verifier({
          result: "FAIL",
          findings: [
            {
              id: "F1",
              severity: "BLOCKING",
              classification: "MECHANICAL",
              message: "format",
            },
            {
              id: "F2",
              severity: "BLOCKING",
              classification: "SEMANTIC",
              message: "wrong authority",
            },
          ],
        }),
      ),
    ).toBe("FULL_REVERIFY");
  });

  it("prevents overlapping active implementer leases for the same unit and scope", () => {
    const registry = new InMemoryLeaseRegistry();
    registry.acquire(lease(), new Date("2026-09-05T00:30:00.000Z"));

    expect(() =>
      registry.acquire(
        lease({
          leaseId: "lease-2",
          holder: "codex",
          scope: ["packages/mps-data-governance/**"],
        }),
        new Date("2026-09-05T00:31:00.000Z"),
      ),
    ).toThrow(LeaseConflictError);
  });

  it("allows reclaim after lease expiry without changing canonical candidate identity", () => {
    const registry = new InMemoryLeaseRegistry();
    registry.acquire(lease(), new Date("2026-09-05T00:30:00.000Z"));
    registry.acquire(
      lease({
        leaseId: "lease-2",
        holder: "claude-b",
        issuedAt: "2026-09-05T01:01:00.000Z",
        heartbeatAt: "2026-09-05T01:01:00.000Z",
        expiresAt: "2026-09-05T02:00:00.000Z",
      }),
      new Date("2026-09-05T01:01:00.000Z"),
    );

    const active = registry.activeFor("K1", new Date("2026-09-05T01:02:00.000Z"));
    expect(active).toHaveLength(1);
    expect(active[0].candidateSha).toBe(CANDIDATE);
    expect(active[0].holder).toBe("claude-b");
  });
});
