import { describe, expect, it } from "vitest";

import {
  AppendOnlyEventLog,
  DuplicateHandoffConflictError,
  HandoffIngestor,
  InMemoryLeaseRegistry,
  LeaseConflictError,
  routeAfterHandoff,
  type AgentHandoff,
  type AgentLease,
  type MultiAgentUnitState,
} from "../../../packages/mps-control-plane/src/multi-agent";

const baseSha = "1".repeat(40);
const candidateSha = "2".repeat(40);
const unitDefinitionHash = "a".repeat(64);
const proofContractHash = "b".repeat(64);

function unit(state: MultiAgentUnitState["state"]): MultiAgentUnitState {
  return {
    unitId: "K1",
    unitDefinitionHash,
    baseSha,
    candidateSha,
    branch: "claude/k1-governed-harvest-canonical-entrypoint-01",
    scope: ["packages/**"],
    proofContractHash,
    controllerContractVersion: "multi-agent-control-plane-v1",
    state,
    revision: 7,
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}

function handoff(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    agentRunId: "run-1",
    unitId: "K1",
    role: "VERIFIER",
    inputState: "VERIFYING",
    observedBaseSha: baseSha,
    observedCandidateSha: candidateSha,
    unitDefinitionHash,
    proofContractHash,
    result: "PASS",
    verifierIndependent: true,
    findings: [],
    outputArtifacts: [],
    startedAt: "2026-09-05T00:10:00.000Z",
    finishedAt: "2026-09-05T00:20:00.000Z",
    ...overrides,
  };
}

function mechanicalFinding(id = "F1") {
  return {
    id,
    severity: "BLOCKING" as const,
    classification: "MECHANICAL" as const,
    message: "mechanical",
  };
}

function lease(overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    leaseId: "lease-1",
    unitId: "K1",
    role: "IMPLEMENTER",
    holder: "claude-a",
    scope: ["packages/**"],
    candidateSha,
    issuedAt: "2026-09-05T00:00:00.000Z",
    heartbeatAt: "2026-09-05T00:01:00.000Z",
    expiresAt: "2026-09-05T00:10:00.000Z",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("Multi-Agent Control Plane V1 persistence and routing", () => {
  it("records accepted handoffs and state transitions in an append-only hash chain", () => {
    const log = new AppendOnlyEventLog();
    const ingestor = new HandoffIngestor(log);
    const result = ingestor.ingest(
      unit("VERIFYING"),
      handoff(),
      "READY_FOR_DEV_GOV",
      "2026-09-05T01:00:00.000Z",
    );

    expect(result.duplicate).toBe(false);
    expect(result.state).toMatchObject({
      state: "READY_FOR_DEV_GOV",
      revision: 8,
      unitDefinitionHash,
      proofContractHash,
    });
    expect(log.forUnit("K1").map((event) => event.kind)).toEqual([
      "HANDOFF_ACCEPTED",
      "UNIT_STATE_TRANSITIONED",
    ]);
    expect(log.verifyChain()).toBe(true);
  });

  it("is idempotent for equivalent agent_run_id replay and rejects conflicting reuse", () => {
    const log = new AppendOnlyEventLog();
    const ingestor = new HandoffIngestor(log);
    const current = unit("VERIFYING");
    const accepted = ingestor.ingest(current, handoff(), "READY_FOR_DEV_GOV");
    expect(ingestor.ingest(accepted.state, handoff(), "READY_FOR_DEV_GOV").duplicate).toBe(true);

    expect(() =>
      ingestor.ingest(
        accepted.state,
        handoff({ result: "FAIL", findings: [mechanicalFinding()] }),
        "VERIFY_FAILED",
      ),
    ).toThrow(DuplicateHandoffConflictError);
    expect(log.forUnit("K1").at(-1)?.kind).toBe("HANDOFF_REJECTED");
  });

  it("cannot advance stale candidate or proof identity", () => {
    const ingestor = new HandoffIngestor(new AppendOnlyEventLog());
    expect(() =>
      ingestor.ingest(
        unit("VERIFYING"),
        handoff({ observedCandidateSha: "3".repeat(40) }),
        "READY_FOR_DEV_GOV",
      ),
    ).toThrow(/candidate SHA/);
    expect(() =>
      ingestor.ingest(
        unit("VERIFYING"),
        handoff({ proofContractHash: "c".repeat(64) }),
        "READY_FOR_DEV_GOV",
      ),
    ).toThrow(/proof contract hash/);
  });

  it("routes verifier failure through VERIFY_FAILED before controller reactivates implementation", () => {
    expect(routeAfterHandoff(handoff({ result: "FAIL", findings: [mechanicalFinding()] }))).toMatchObject({
      targetRole: "IMPLEMENTER",
      acceptedState: "VERIFY_FAILED",
      activationState: "IMPLEMENTING",
      verificationMode: "DELTA_REVERIFY",
    });

    expect(
      routeAfterHandoff(
        handoff({
          result: "FAIL",
          findings: [
            mechanicalFinding(),
            {
              id: "F2",
              severity: "BLOCKING",
              classification: "SEMANTIC",
              message: "semantic",
            },
          ],
        }),
      ),
    ).toMatchObject({
      targetRole: "IMPLEMENTER",
      acceptedState: "VERIFY_FAILED",
      activationState: "IMPLEMENTING",
      verificationMode: "FULL_REVERIFY",
    });
  });

  it("routes verifier PASS through READY_FOR_DEV_GOV then activates PROVING_RED", () => {
    expect(routeAfterHandoff(handoff())).toMatchObject({
      targetRole: "DEV_GOV",
      acceptedState: "READY_FOR_DEV_GOV",
      activationState: "PROVING_RED",
    });
    const ingestor = new HandoffIngestor(new AppendOnlyEventLog());
    expect(() =>
      ingestor.ingest(
        unit("VERIFYING"),
        handoff({ verifierIndependent: false }),
        "READY_FOR_DEV_GOV",
      ),
    ).toThrow(/independent verifier/);
  });

  it("heartbeats only by the current holder and with monotonic time", () => {
    const registry = new InMemoryLeaseRegistry();
    registry.acquire(lease(), new Date("2026-09-05T00:02:00.000Z"));
    const updated = registry.heartbeat(
      "lease-1",
      "claude-a",
      "2026-09-05T00:03:00.000Z",
      "2026-09-05T00:12:00.000Z",
      new Date("2026-09-05T00:03:01.000Z"),
    );
    expect(updated.heartbeatAt).toBe("2026-09-05T00:03:00.000Z");
    expect(() =>
      registry.heartbeat(
        "lease-1",
        "codex",
        "2026-09-05T00:04:00.000Z",
        "2026-09-05T00:13:00.000Z",
        new Date("2026-09-05T00:04:01.000Z"),
      ),
    ).toThrow(LeaseConflictError);
  });

  it("reclaims expired scope without changing candidate identity", () => {
    const registry = new InMemoryLeaseRegistry();
    registry.acquire(lease(), new Date("2026-09-05T00:02:00.000Z"));
    const expired = registry.expireStale(new Date("2026-09-05T00:11:00.000Z"));
    expect(expired[0]).toMatchObject({ status: "EXPIRED", candidateSha });

    registry.acquire(
      lease({
        leaseId: "lease-2",
        holder: "claude-b",
        issuedAt: "2026-09-05T00:11:01.000Z",
        heartbeatAt: "2026-09-05T00:11:01.000Z",
        expiresAt: "2026-09-05T00:20:00.000Z",
      }),
      new Date("2026-09-05T00:11:02.000Z"),
    );
    expect(
      registry.activeFor("K1", new Date("2026-09-05T00:11:03.000Z"))[0].candidateSha,
    ).toBe(candidateSha);
  });
});
