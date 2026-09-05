import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AppendOnlyEventLog,
  DurableMultiAgentCoordinator,
  DuplicateHandoffConflictError,
  FileDurableControlPlaneStore,
  type AgentDispatchPort,
  type AgentHandoff,
  type AgentWorkItem,
  type DevGovDispatchPort,
  type DevGovWorkItem,
  type MultiAgentUnitState,
} from "../../../packages/mps-control-plane/src/multi-agent";

const roots: string[] = [];
const baseSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const unitDefinitionHash = "c".repeat(64);
const proofContractHash = "d".repeat(64);

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function store() {
  const root = mkdtempSync(path.join(tmpdir(), "mimer-control-plane-"));
  roots.push(root);
  return new FileDurableControlPlaneStore(path.join(root, "state.json"));
}

function state(): MultiAgentUnitState {
  return {
    unitId: "K1",
    unitDefinitionHash,
    baseSha,
    candidateSha,
    branch: "claude/k1-governed-harvest-canonical-entrypoint-01",
    scope: ["packages/mps-data-governance/**"],
    proofContractHash,
    controllerContractVersion: "multi-agent-control-plane-v1",
    state: "VERIFYING",
    revision: 4,
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}

function pass(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    agentRunId: "codex-run-1",
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

class AgentPort implements AgentDispatchPort {
  async dispatch(item: AgentWorkItem) { return `agent:${item.dispatchKey}`; }
}
class DevGovPort implements DevGovDispatchPort {
  failNext = false;
  readonly calls: DevGovWorkItem[] = [];
  async dispatch(item: DevGovWorkItem) {
    this.calls.push(item);
    if (this.failNext) { this.failNext = false; throw new Error("transport failure"); }
    return `devgov:${item.dispatchKey}`;
  }
}

describe("Multi-Agent durable coordinator V1", () => {
  it("persists transition and pending outbox before external dispatch", async () => {
    const s = store(); s.initializeUnit(state());
    const devgov = new DevGovPort(); devgov.failNext = true;
    const coordinator = new DurableMultiAgentCoordinator({ store: s, agentDispatch: new AgentPort(), devGovDispatch: devgov });

    await expect(coordinator.acceptHandoff(pass())).rejects.toThrow("transport failure");
    const snapshot = s.read();
    expect(snapshot.units.K1).toMatchObject({ state: "READY_FOR_DEV_GOV", revision: 5, unitDefinitionHash, proofContractHash });
    expect(Object.values(snapshot.outbox)[0].status).toBe("PENDING");
    expect(new AppendOnlyEventLog(snapshot.events).verifyChain()).toBe(true);
  });

  it("resumes the same dispatch key after restart without replaying state", async () => {
    const s = store(); s.initializeUnit(state());
    const devgov = new DevGovPort(); devgov.failNext = true;
    const deps = { store: s, agentDispatch: new AgentPort(), devGovDispatch: devgov };
    await expect(new DurableMultiAgentCoordinator(deps).acceptHandoff(pass())).rejects.toThrow();

    const ids = await new DurableMultiAgentCoordinator(deps).flushPending();
    expect(ids).toHaveLength(1);
    expect(s.read().units.K1.revision).toBe(5);
    expect(Object.values(s.read().outbox)[0].status).toBe("DISPATCHED");
    expect(devgov.calls[0].dispatchKey).toBe(devgov.calls[1].dispatchKey);
  });

  it("keeps accepted agentRunId idempotent across restart", async () => {
    const s = store(); s.initializeUnit(state());
    const devgov = new DevGovPort();
    const deps = { store: s, agentDispatch: new AgentPort(), devGovDispatch: devgov };
    await new DurableMultiAgentCoordinator(deps).acceptHandoff(pass());
    const duplicate = await new DurableMultiAgentCoordinator(deps).acceptHandoff(pass());
    expect(duplicate.duplicate).toBe(true);
    expect(s.read().units.K1.revision).toBe(5);
    expect(devgov.calls).toHaveLength(1);
  });

  it("audits conflicting replay and does not advance canonical state", async () => {
    const s = store(); s.initializeUnit(state());
    const deps = { store: s, agentDispatch: new AgentPort(), devGovDispatch: new DevGovPort() };
    const coordinator = new DurableMultiAgentCoordinator(deps);
    await coordinator.acceptHandoff(pass());
    const before = s.read().units.K1;
    await expect(coordinator.acceptHandoff(pass({ result: "FAIL", findings: [{ id: "F1", severity: "BLOCKING", classification: "MECHANICAL", message: "format" }] }))).rejects.toThrow(DuplicateHandoffConflictError);
    const after = s.read();
    expect(after.units.K1).toEqual(before);
    expect(after.events.at(-1)?.kind).toBe("HANDOFF_REJECTED");
  });

  it("fails closed on durable event-chain tamper", async () => {
    const s = store(); s.initializeUnit(state());
    const deps = { store: s, agentDispatch: new AgentPort(), devGovDispatch: new DevGovPort() };
    await new DurableMultiAgentCoordinator(deps).acceptHandoff(pass());
    const snapshot = s.read();
    s.write({ ...snapshot, events: snapshot.events.map((e, i) => i === 0 ? { ...e, unitId: "FORGED" } : e) });
    await expect(new DurableMultiAgentCoordinator(deps).acceptHandoff(pass())).rejects.toThrow("seeded control-plane event chain is invalid");
  });
});
