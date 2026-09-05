import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileAgentMailbox,
  ProcessAgentWorker,
  type AgentHandoff,
  type AgentHandoffSink,
  type AgentProcessExecutor,
  type AgentWorkItem,
  type MultiAgentUnitState,
} from "../../../packages/mps-control-plane/src/multi-agent";

const roots: string[] = [];
const baseSha = "1".repeat(40);
const candidateSha = "2".repeat(40);
const unitDefinitionHash = "a".repeat(64);
const proofContractHash = "b".repeat(64);

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function mailbox() {
  const root = mkdtempSync(path.join(tmpdir(), "mimer-worker-"));
  roots.push(root);
  return new FileAgentMailbox(path.join(root, "mailbox.json"));
}

function unit(): MultiAgentUnitState {
  return {
    unitId: "K1",
    unitDefinitionHash,
    baseSha,
    candidateSha,
    branch: "feature/k1",
    scope: ["packages/**"],
    proofContractHash,
    controllerContractVersion: "multi-agent-control-plane-v1",
    state: "VERIFYING",
    revision: 3,
    updatedAt: "2026-09-05T01:00:00.000Z",
  };
}

function work(): AgentWorkItem {
  return {
    dispatchKey: "K1:3:VERIFIER",
    unit: unit(),
    role: "VERIFIER",
    reason: "independent verification required",
  };
}

function output(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema_version: "multi-agent-handoff-v1",
    agent_run_id: "codex-1",
    unit_id: "K1",
    role: "VERIFIER",
    input_state: "VERIFYING",
    observed_base_sha: baseSha,
    observed_candidate_sha: candidateSha,
    unit_definition_hash: unitDefinitionHash,
    proof_contract_hash: proofContractHash,
    result: "PASS",
    verifier_independent: true,
    findings: [],
    output_artifacts: [],
    started_at: "2026-09-05T01:10:00.000Z",
    finished_at: "2026-09-05T01:20:00.000Z",
    ...overrides,
  });
}

class Executor implements AgentProcessExecutor {
  constructor(private readonly outputs: string[]) {}
  async execute() {
    const next = this.outputs.shift();
    if (next === undefined) throw new Error("no test output");
    return next;
  }
}

class Sink implements AgentHandoffSink {
  readonly accepted: AgentHandoff[] = [];
  async accept(handoff: AgentHandoff) { this.accepted.push(handoff); }
}

describe("Multi-Agent process worker V1", () => {
  it("moves a strict machine-readable verifier handoff directly from mailbox to sink", async () => {
    const box = mailbox();
    await box.dispatch(work());
    const sink = new Sink();
    const worker = new ProcessAgentWorker(box, new Executor([output()]), sink, {
      workerId: "codex-worker",
      role: "VERIFIER",
      now: () => new Date("2026-09-05T01:30:00.000Z"),
    });

    await expect(worker.runOnce()).resolves.toBe("COMPLETED");
    expect(sink.accepted).toHaveLength(1);
    expect(sink.accepted[0]).toMatchObject({
      unitId: "K1",
      role: "VERIFIER",
      observedCandidateSha: candidateSha,
      verifierIndependent: true,
    });
    expect(box.list()[0].status).toBe("COMPLETED");
  });

  it("rejects prose-wrapped or wrong-SHA output and requeues without accepting it", async () => {
    const box = mailbox();
    await box.dispatch(work());
    const sink = new Sink();
    const worker = new ProcessAgentWorker(
      box,
      new Executor([`result follows:\n${output()}`, output({ observed_candidate_sha: "3".repeat(40) })]),
      sink,
      { workerId: "codex-worker", role: "VERIFIER", maxAttempts: 3 },
    );

    await expect(worker.runOnce()).resolves.toBe("RETRY");
    expect(box.list()[0]).toMatchObject({ status: "PENDING", attempts: 1 });
    await expect(worker.runOnce()).resolves.toBe("RETRY");
    expect(box.list()[0]).toMatchObject({ status: "PENDING", attempts: 2 });
    expect(sink.accepted).toHaveLength(0);
  });

  it("dead-letters repeatedly invalid output instead of retrying forever", async () => {
    const box = mailbox();
    await box.dispatch(work());
    const worker = new ProcessAgentWorker(
      box,
      new Executor(["not json", "still not json"]),
      new Sink(),
      { workerId: "codex-worker", role: "VERIFIER", maxAttempts: 2 },
    );

    expect(await worker.runOnce()).toBe("RETRY");
    expect(await worker.runOnce()).toBe("DEAD_LETTER");
    expect(box.list()[0]).toMatchObject({ status: "DEAD_LETTER", attempts: 2 });
    expect(await worker.runOnce()).toBe("IDLE");
  });

  it("reclaims a crashed worker lease after expiry", async () => {
    const box = mailbox();
    await box.dispatch(work());
    const leased = box.reserve("VERIFIER", "dead-worker", new Date("2026-09-05T01:00:00Z"), 1_000);
    expect(leased?.status).toBe("LEASED");
    expect(box.reclaimExpired(new Date("2026-09-05T01:00:02Z"))).toBe(1);
    const reclaimed = box.reserve("VERIFIER", "new-worker", new Date("2026-09-05T01:00:03Z"));
    expect(reclaimed).toMatchObject({ status: "LEASED", leasedBy: "new-worker", attempts: 2 });
  });
});
