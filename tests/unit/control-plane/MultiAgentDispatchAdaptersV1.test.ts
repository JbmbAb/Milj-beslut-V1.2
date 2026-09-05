import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentMailboxConflictError,
  DevGovBindingError,
  FileAgentMailbox,
  GitHubDevGovDispatchAdapter,
  type AgentWorkItem,
  type DevGovBindingResolver,
  type DevGovUnitBinding,
  type GitHubWorkflowDispatchClient,
  type MultiAgentUnitState,
} from "../../../packages/mps-control-plane/src/multi-agent";

const roots: string[] = [];
const candidateSha = "1".repeat(40);
const baseSha = "2".repeat(40);
const unitDefinitionHash = "a".repeat(64);
const proofContractHash = "b".repeat(64);

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

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

class Client implements GitHubWorkflowDispatchClient {
  readonly calls: Parameters<GitHubWorkflowDispatchClient["dispatchWorkflow"]>[0][] = [];
  async dispatchWorkflow(input: Parameters<GitHubWorkflowDispatchClient["dispatchWorkflow"]>[0]) {
    this.calls.push(input);
    return { runId: "33999999999" };
  }
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

  it("dispatches DEV-GOV only from exact canonical PROVING_RED binding", async () => {
    const client = new Client();
    const adapter = new GitHubDevGovDispatchAdapter(new Resolver(), client);
    const dispatchId = await adapter.dispatch({
      dispatchKey: "K1:6:DEV_GOV",
      unit: unit(),
      reason: "verified and controller-activated",
    });
    expect(dispatchId).toBe("github-actions:33999999999");
    expect(client.calls[0]).toEqual({
      workflow: "devgov-v0-orchestrate.yml",
      ref: "main",
      idempotencyKey: "K1:6:DEV_GOV",
      inputs: {
        candidate_sha: candidateSha,
        unit_definition_path: "governance/devgov/units/governed-harvest-canonical-entrypoint.json",
      },
    });
  });

  it("denies pre-activation, missing proof identity or mismatched proof binding", async () => {
    const client = new Client();
    const adapter = new GitHubDevGovDispatchAdapter(new Resolver(), client);
    await expect(
      adapter.dispatch({
        dispatchKey: "pre",
        unit: { ...unit(), state: "READY_FOR_DEV_GOV" },
        reason: "not activated",
      }),
    ).rejects.toThrow(/requires PROVING_RED/);

    await expect(
      new GitHubDevGovDispatchAdapter(
        new Resolver({ proofContractHash: "c".repeat(64) }),
        client,
      ).dispatch({ dispatchKey: "bad", unit: unit(), reason: "verified" }),
    ).rejects.toThrow(/proof-contract hash mismatch/);

    await expect(
      adapter.dispatch({
        dispatchKey: "missing",
        unit: { ...unit(), proofContractHash: undefined },
        reason: "verified",
      }),
    ).rejects.toThrow(DevGovBindingError);
    expect(client.calls).toHaveLength(0);
  });

  it("denies arbitrary unit-definition paths", async () => {
    const client = new Client();
    const adapter = new GitHubDevGovDispatchAdapter(
      new Resolver({ unitDefinitionPath: "../../.github/workflows/evil.yml" }),
      client,
    );
    await expect(
      adapter.dispatch({ dispatchKey: "x", unit: unit(), reason: "verified" }),
    ).rejects.toThrow(/invalid unit-definition path/);
    expect(client.calls).toHaveLength(0);
  });
});
