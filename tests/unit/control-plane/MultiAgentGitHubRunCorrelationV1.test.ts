import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileCorrelationStore,
  WorkflowDispatchCorrelator,
  type GitHubActionsRunObserverPort,
  type GitHubWorkflowDispatchPort,
  type ObservedWorkflowRun,
} from "../../../packages/mps-control-plane/src/multi-agent";

const roots: string[] = [];
const refSha = "4".repeat(40);

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function store(): FileCorrelationStore {
  const root = mkdtempSync(path.join(tmpdir(), "mimer-run-correlation-"));
  roots.push(root);
  return new FileCorrelationStore(path.join(root, "correlation.json"));
}

class DispatchPort implements GitHubWorkflowDispatchPort {
  calls = 0;
  constructor(private readonly sha = refSha) {}
  async getRefSha() {
    return this.sha;
  }
  async dispatchWorkflow() {
    this.calls += 1;
  }
}

class RunObserver implements GitHubActionsRunObserverPort {
  constructor(public runs: ObservedWorkflowRun[] = []) {}
  async listRuns() {
    return this.runs;
  }
}

function run(overrides: Partial<ObservedWorkflowRun> = {}): ObservedWorkflowRun {
  return {
    runId: "1001",
    workflow: "devgov-v0-orchestrate.yml",
    headBranch: "main",
    headSha: refSha,
    event: "workflow_dispatch",
    createdAt: "2026-09-05T01:00:05.000Z",
    status: "completed",
    conclusion: "success",
    htmlUrl: "https://github.com/x/y/actions/runs/1001",
    ...overrides,
  };
}

describe("GitHub workflow-dispatch run correlation (Part B)", () => {
  it("does not pretend workflow_dispatch returns a run id, and correlates by head_sha + time window", async () => {
    const dispatchPort = new DispatchPort();
    const observer = new RunObserver([run()]);
    const correlator = new WorkflowDispatchCorrelator(store(), dispatchPort, observer, {
      now: () => new Date("2026-09-05T01:00:00.000Z"),
    });

    const pending = await correlator.dispatch({
      dispatchKey: "K1:6:DEV_GOV",
      workflow: "devgov-v0-orchestrate.yml",
      ref: "main",
      inputs: { candidate_sha: "x" },
    });
    expect(pending.status).toBe("AWAITING_RUN");
    expect(dispatchPort.calls).toBe(1);

    const resolved = await correlator.poll("K1:6:DEV_GOV");
    expect(resolved).toMatchObject({ status: "CORRELATED", runId: "1001" });
  });

  it("is idempotent per dispatchKey: a second dispatch call never re-submits workflow_dispatch", async () => {
    const dispatchPort = new DispatchPort();
    const correlator = new WorkflowDispatchCorrelator(store(), dispatchPort, new RunObserver());
    const input = { dispatchKey: "K1:6:DEV_GOV", workflow: "wf.yml", ref: "main", inputs: {} };
    await correlator.dispatch(input);
    await correlator.dispatch(input);
    expect(dispatchPort.calls).toBe(1);
  });

  it("refuses to guess when more than one run matches — reports AMBIGUOUS_CORRELATION", async () => {
    const dispatchPort = new DispatchPort();
    const observer = new RunObserver([run({ runId: "1001" }), run({ runId: "1002" })]);
    const correlator = new WorkflowDispatchCorrelator(store(), dispatchPort, observer, {
      now: () => new Date("2026-09-05T01:00:00.000Z"),
    });
    await correlator.dispatch({ dispatchKey: "K1:6:DEV_GOV", workflow: "wf.yml", ref: "main", inputs: {} });
    const resolved = await correlator.poll("K1:6:DEV_GOV");
    expect(resolved.status).toBe("AMBIGUOUS_CORRELATION");
    expect(resolved.candidateRunIds).toEqual(["1001", "1002"]);
  });

  it("times out rather than binding a run from a different commit or a run created before dispatch", async () => {
    const dispatchPort = new DispatchPort();
    const observer = new RunObserver([
      run({ headSha: "5".repeat(40) }),
      run({ createdAt: "2026-09-05T00:59:00.000Z" }),
    ]);
    let now = new Date("2026-09-05T01:00:00.000Z");
    const correlator = new WorkflowDispatchCorrelator(store(), dispatchPort, observer, {
      now: () => now,
      windowMs: 60_000,
    });
    await correlator.dispatch({ dispatchKey: "K1:6:DEV_GOV", workflow: "wf.yml", ref: "main", inputs: {} });
    expect((await correlator.poll("K1:6:DEV_GOV")).status).toBe("AWAITING_RUN");
    now = new Date("2026-09-05T01:01:01.000Z");
    expect((await correlator.poll("K1:6:DEV_GOV")).status).toBe("CORRELATION_TIMEOUT");
  });

  it("survives restart: a fresh correlator instance over the same store resumes AWAITING_RUN polling", async () => {
    const filePath = path.join(mkdtempSync(path.join(tmpdir(), "mimer-run-correlation-")), "correlation.json");
    roots.push(path.dirname(filePath));
    const dispatchPort = new DispatchPort();
    const before = new WorkflowDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver(),
      { now: () => new Date("2026-09-05T01:00:00.000Z") },
    );
    await before.dispatch({ dispatchKey: "K1:6:DEV_GOV", workflow: "wf.yml", ref: "main", inputs: {} });

    const after = new WorkflowDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver([run()]),
      { now: () => new Date("2026-09-05T01:00:05.000Z") },
    );
    const resumed = await after.pollAllPending();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ status: "CORRELATED", runId: "1001" });
    expect(dispatchPort.calls).toBe(1);
  });
});
