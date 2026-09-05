import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentMailboxConflictError,
  DevGovBindingError,
  DevGovWorkflowUnavailableError,
  FileAgentMailbox,
  FileCorrelationStore,
  GitHubDevGovDispatchAdapter,
  WorkflowDispatchCorrelator,
  type AgentWorkItem,
  type DevGovBindingResolver,
  type DevGovUnitBinding,
  type DevGovWorkflowAvailabilityPort,
  type GitHubActionsRunObserverPort,
  type GitHubWorkflowDispatchPort,
  type MultiAgentUnitState,
  type ObservedWorkflowRun,
} from "../../../packages/mps-control-plane/src/multi-agent";

const roots: string[] = [];
const candidateSha = "1".repeat(40);
const baseSha = "2".repeat(40);
const unitDefinitionHash = "a".repeat(64);
const proofContractHash = "b".repeat(64);
const refSha = "3".repeat(40);

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function mailbox(): FileAgentMailbox {
  const root = mkdtempSync(path.join(tmpdir(), "mimer-agent-mailbox-"));
  roots.push(root);
  return new FileAgentMailbox(path.join(root, "mailbox.json"));
}

function correlationStore(): FileCorrelationStore {
  const root = mkdtempSync(path.join(tmpdir(), "mimer-run-correlation-"));
  roots.push(root);
  return new FileCorrelationStore(path.join(root, "correlation.json"));
}

function unit(): MultiAgentUnitState {
  return {
    unitId: "K1",
    unitDefinitionHash,
    baseSha,
    candidateSha,
    branch: "claude/k1-governed-harvest-canonical-entrypoint-01",
    scope: ["packages/mps-data-governance/**"],
    proofContractHash,
    controllerContractVersion: "multi-agent-control-plane-v1",
    state: "PROVING_RED",
    revision: 6,
    updatedAt: "2026-09-05T01:00:00.000Z",
  };
}

function agentItem(): AgentWorkItem {
  return {
    dispatchKey: "K1:3:VERIFIER",
    unit: { ...unit(), state: "VERIFYING", revision: 3 },
    role: "VERIFIER",
    reason: "independent verification required",
  };
}

class Resolver implements DevGovBindingResolver {
  constructor(private readonly overrides: Partial<DevGovUnitBinding> = {}) {}
  resolve(): DevGovUnitBinding {
    return {
      unitId: "K1",
      unitDefinitionPath: "governance/devgov/units/governed-harvest-canonical-entrypoint.json",
      unitDefinitionHash,
      proofContractHash,
      ...this.overrides,
    };
  }
}

class Availability implements DevGovWorkflowAvailabilityPort {
  constructor(private readonly available = true) {}
  async workflowExists() {
    return this.available;
  }
}

class DispatchPort implements GitHubWorkflowDispatchPort {
  readonly calls: Parameters<GitHubWorkflowDispatchPort["dispatchWorkflow"]>[0][] = [];
  async getRefSha() {
    return refSha;
  }
  async dispatchWorkflow(input: Parameters<GitHubWorkflowDispatchPort["dispatchWorkflow"]>[0]) {
    this.calls.push(input);
  }
}

class RunObserver implements GitHubActionsRunObserverPort {
  constructor(private runs: ObservedWorkflowRun[] = []) {}
  async listRuns() {
    return this.runs;
  }
}

function correlator(dispatch: DispatchPort, observer: RunObserver, now?: () => Date): WorkflowDispatchCorrelator {
  return new WorkflowDispatchCorrelator(correlationStore(), dispatch, observer, { now });
}

describe("Multi-Agent Control Plane V1 dispatch adapters", () => {
  it("queues identical agent work idempotently and prevents dispatch-key substitution", async () => {
    const box = mailbox();
    const item = agentItem();
    const first = await box.dispatch(item);
    const second = await box.dispatch(item);
    expect(second).toBe(first);
    expect(box.list()).toHaveLength(1);
    await expect(box.dispatch({ ...item, role: "IMPLEMENTER" })).rejects.toThrow(
      AgentMailboxConflictError,
    );
  });

  it("leases work to the requested role and only that worker can complete it", async () => {
    const box = mailbox();
    await box.dispatch(agentItem());
    expect(box.reserve("IMPLEMENTER", "claude-a")).toBeUndefined();
    const reserved = box.reserve("VERIFIER", "codex-1", new Date("2026-09-05T01:00:00Z"));
    expect(reserved).toMatchObject({ status: "LEASED", leasedBy: "codex-1" });
    expect(() => box.complete(agentItem().dispatchKey, "claude-a")).toThrow(
      AgentMailboxConflictError,
    );
    box.complete(agentItem().dispatchKey, "codex-1");
    expect(box.list()[0].status).toBe("COMPLETED");
  });

  it("submits DEV-GOV dispatch through the correlator without fabricating a run id", async () => {
    const dispatchPort = new DispatchPort();
    const observer = new RunObserver();
    const adapter = new GitHubDevGovDispatchAdapter(
      new Resolver(),
      new Availability(true),
      correlator(dispatchPort, observer),
    );
    const dispatchId = await adapter.dispatch({
      dispatchKey: "K1:6:DEV_GOV",
      unit: unit(),
      reason: "verified and controller-activated",
    });
    expect(dispatchId).toBe("github-actions:pending:K1:6:DEV_GOV");
    expect(dispatchPort.calls[0]).toEqual({
      workflow: "devgov-v0-orchestrate.yml",
      ref: "main",
      inputs: {
        candidate_sha: candidateSha,
        unit_definition_path: "governance/devgov/units/governed-harvest-canonical-entrypoint.json",
      },
    });
  });

  it("classifies a missing DEV-GOV workflow as unavailable instead of dispatching", async () => {
    const dispatchPort = new DispatchPort();
    const adapter = new GitHubDevGovDispatchAdapter(
      new Resolver(),
      new Availability(false),
      correlator(dispatchPort, new RunObserver()),
    );
    await expect(
      adapter.dispatch({ dispatchKey: "K1:6:DEV_GOV", unit: unit(), reason: "verified" }),
    ).rejects.toThrow(DevGovWorkflowUnavailableError);
    expect(dispatchPort.calls).toHaveLength(0);
  });

  it("denies pre-activation, missing proof identity or mismatched proof binding", async () => {
    const dispatchPort = new DispatchPort();
    const availability = new Availability(true);
    const build = () => new GitHubDevGovDispatchAdapter(new Resolver(), availability, correlator(dispatchPort, new RunObserver()));

    await expect(
      build().dispatch({
        dispatchKey: "pre",
        unit: { ...unit(), state: "READY_FOR_DEV_GOV" },
        reason: "not activated",
      }),
    ).rejects.toThrow(/requires PROVING_RED/);

    await expect(
      new GitHubDevGovDispatchAdapter(
        new Resolver({ proofContractHash: "c".repeat(64) }),
        availability,
        correlator(dispatchPort, new RunObserver()),
      ).dispatch({ dispatchKey: "bad", unit: unit(), reason: "verified" }),
    ).rejects.toThrow(/proof-contract hash mismatch/);

    await expect(
      build().dispatch({
        dispatchKey: "missing",
        unit: { ...unit(), proofContractHash: undefined },
        reason: "verified",
      }),
    ).rejects.toThrow(DevGovBindingError);
    expect(dispatchPort.calls).toHaveLength(0);
  });

  it("denies arbitrary unit-definition paths", async () => {
    const dispatchPort = new DispatchPort();
    const adapter = new GitHubDevGovDispatchAdapter(
      new Resolver({ unitDefinitionPath: "../../.github/workflows/evil.yml" }),
      new Availability(true),
      correlator(dispatchPort, new RunObserver()),
    );
    await expect(
      adapter.dispatch({ dispatchKey: "x", unit: unit(), reason: "verified" }),
    ).rejects.toThrow(/invalid unit-definition path/);
    expect(dispatchPort.calls).toHaveLength(0);
  });
});
