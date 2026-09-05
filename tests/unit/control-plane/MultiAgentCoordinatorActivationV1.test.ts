import { describe, expect, it } from "vitest";

import {
  MultiAgentCoordinator,
  type AgentDispatchPort,
  type AgentHandoff,
  type AgentWorkItem,
  type DevGovDispatchPort,
  type DevGovWorkItem,
  type MultiAgentUnitState,
} from "../../../packages/mps-control-plane/src/multi-agent";

const baseSha = "1".repeat(40);
const candidateSha = "2".repeat(40);
const unitDefinitionHash = "a".repeat(64);
const proofContractHash = "b".repeat(64);
const now = () => new Date("2026-09-05T02:00:00.000Z");

function state(value: MultiAgentUnitState["state"], revision: number): MultiAgentUnitState {
  return {
    unitId: "K1",
    unitDefinitionHash,
    baseSha,
    candidateSha,
    branch: "feature/k1",
    scope: ["packages/**"],
    proofContractHash,
    controllerContractVersion: "multi-agent-control-plane-v1",
    state: value,
    revision,
    updatedAt: "2026-09-05T01:00:00.000Z",
  };
}

function handoff(role: AgentHandoff["role"], inputState: AgentHandoff["inputState"], result: AgentHandoff["result"]): AgentHandoff {
  return {
    agentRunId: `${role}-${result}`,
    unitId: "K1",
    role,
    inputState,
    observedBaseSha: baseSha,
    observedCandidateSha: candidateSha,
    unitDefinitionHash,
    proofContractHash,
    result,
    verifierIndependent: role === "VERIFIER" ? true : undefined,
    findings: result === "FAIL" ? [{ id: "F1", severity: "BLOCKING", classification: "MECHANICAL", message: "format" }] : [],
    outputArtifacts: [],
    startedAt: "2026-09-05T01:10:00.000Z",
    finishedAt: "2026-09-05T01:20:00.000Z",
  };
}

class AgentPort implements AgentDispatchPort {
  readonly calls: AgentWorkItem[] = [];
  async dispatch(item: AgentWorkItem) { this.calls.push(item); return `agent:${item.dispatchKey}`; }
}
class DevGovPort implements DevGovDispatchPort {
  readonly calls: DevGovWorkItem[] = [];
  async dispatch(item: DevGovWorkItem) { this.calls.push(item); return `devgov:${item.dispatchKey}`; }
}

function coordinator() {
  const agents = new AgentPort();
  const devgov = new DevGovPort();
  return { agents, devgov, controller: new MultiAgentCoordinator({ agentDispatch: agents, devGovDispatch: devgov, now }) };
}

describe("Multi-Agent controller activation V1", () => {
  it("accepts implementer PASS, records IMPLEMENTATION_READY, then activates VERIFYING before verifier dispatch", async () => {
    const { controller, agents } = coordinator();
    const result = await controller.acceptHandoff(state("IMPLEMENTING", 1), handoff("IMPLEMENTER", "IMPLEMENTING", "PASS"));
    expect(result.state).toMatchObject({ state: "VERIFYING", revision: 3 });
    expect(agents.calls[0].unit).toMatchObject({ state: "VERIFYING", revision: 3 });
    expect(controller.events().filter((event) => event.kind === "UNIT_STATE_TRANSITIONED").map((event) => event.payload.to)).toEqual([
      "IMPLEMENTATION_READY",
      "VERIFYING",
    ]);
  });

  it("accepts verifier FAIL, records VERIFY_FAILED, then activates IMPLEMENTING before correction dispatch", async () => {
    const { controller, agents } = coordinator();
    const result = await controller.acceptHandoff(state("VERIFYING", 4), handoff("VERIFIER", "VERIFYING", "FAIL"));
    expect(result.state).toMatchObject({ state: "IMPLEMENTING", revision: 6 });
    expect(agents.calls[0]).toMatchObject({ role: "IMPLEMENTER", verificationMode: "DELTA_REVERIFY" });
    expect(agents.calls[0].unit.state).toBe("IMPLEMENTING");
  });

  it("accepts independent verifier PASS, records READY_FOR_DEV_GOV, then activates PROVING_RED before DEV-GOV dispatch", async () => {
    const { controller, devgov } = coordinator();
    const result = await controller.acceptHandoff(state("VERIFYING", 4), handoff("VERIFIER", "VERIFYING", "PASS"));
    expect(result.state).toMatchObject({ state: "PROVING_RED", revision: 6 });
    expect(devgov.calls[0].unit).toMatchObject({ state: "PROVING_RED", revision: 6 });
    expect(controller.events().filter((event) => event.kind === "UNIT_STATE_TRANSITIONED").map((event) => event.payload.to)).toEqual([
      "READY_FOR_DEV_GOV",
      "PROVING_RED",
    ]);
  });
});
