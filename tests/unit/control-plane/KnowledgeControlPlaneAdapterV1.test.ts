import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ControlPlaneTransitionError,
  DuplicateHandoffConflictError,
  FileAgentMailbox,
  FileDurableControlPlaneStore,
  InMemoryLeaseRegistry,
  LeaseConflictError,
  type AgentDispatchPort,
  type AgentLease,
  type AgentWorkItem,
} from "../../../packages/mps-control-plane/src/multi-agent";
import {
  deriveKnowledgeUnitMetrics,
  KnowledgeUnitSeedError,
  seedKnowledgeUnitState,
  toAgentHandoff,
  type KnowledgeRunResult,
} from "../../../packages/mps-knowledge-control-plane-adapter/src";
import {
  buildKnowledgeCoordinator,
  driveKnowledgeHandoff,
  LocalDevGovDispatchStub,
  seedAndActivateKnowledgeUnit,
} from "../../../scripts/knowledge/control-plane-dispatch";

const roots: string[] = [];
const BASE_SHA = "1".repeat(40);
const CANDIDATE_SHA = "2".repeat(40);
const clock = (iso: string) => () => new Date(iso);

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tmpRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "mimer-knowledge-cp-"));
  roots.push(root);
  return root;
}

function unitDefinition(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "dev-gov-v1-unit-definition",
    unit: "KNOWLEDGE-CP-ADAPTER-FIXTURE-1",
    role: "producer",
    mode: "writer",
    branch: "codex/knowledge-cp-adapter-fixture-1",
    base_sha: BASE_SHA,
    ancestry_policy: "descendant_of_base",
    allowed_paths: ["packages/mps-knowledge-corpus/**"],
    forbidden_paths: [".github/**", "scripts/devgov/**"],
    ...overrides,
  };
}

class RecordingAgentPort implements AgentDispatchPort {
  readonly calls: AgentWorkItem[] = [];
  async dispatch(item: AgentWorkItem) {
    this.calls.push(item);
    return `agent:${item.dispatchKey}`;
  }
}

function implementerRun(
  unitId: string,
  overrides: Partial<KnowledgeRunResult> = {},
): KnowledgeRunResult {
  return {
    agentRunId: "impl-run-1",
    unitId,
    role: "IMPLEMENTER",
    inputState: "IMPLEMENTING",
    observedBaseSha: BASE_SHA,
    observedCandidateSha: CANDIDATE_SHA,
    unitDefinitionHash: overrides.unitDefinitionHash ?? "",
    proofContractHash: overrides.proofContractHash ?? "",
    outcome: "PASS",
    findings: [],
    outputArtifacts: [{ kind: "vitest-report", ref: "report.json", sha256: "e".repeat(64) }],
    startedAt: "2026-09-08T00:00:00.000Z",
    finishedAt: "2026-09-08T00:05:00.000Z",
    ...overrides,
  };
}

function verifierRun(unitId: string, overrides: Partial<KnowledgeRunResult> = {}): KnowledgeRunResult {
  return {
    agentRunId: "verify-run-1",
    unitId,
    role: "VERIFIER",
    inputState: "VERIFYING",
    observedBaseSha: BASE_SHA,
    observedCandidateSha: CANDIDATE_SHA,
    unitDefinitionHash: overrides.unitDefinitionHash ?? "",
    proofContractHash: overrides.proofContractHash ?? "",
    verifierIndependent: true,
    outcome: "PASS",
    findings: [],
    outputArtifacts: [],
    startedAt: "2026-09-08T00:10:00.000Z",
    finishedAt: "2026-09-08T00:15:00.000Z",
    ...overrides,
  };
}

describe("Knowledge x Control Plane adapter V1 — composition round trip", () => {
  it("seeds, activates, implements and independently verifies one Knowledge unit end to end", async () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    // Reuses Control Plane V1's own FileAgentMailbox unmodified — the real dispatch adapter, not a
    // test double — to prove this is genuine composition, not a simulation of one.
    const agent = new FileAgentMailbox(path.join(root, "knowledge-mailbox.json"));
    const devGov = new LocalDevGovDispatchStub();
    const coordinator = buildKnowledgeCoordinator(store, agent, devGov, clock("2026-09-08T00:20:00.000Z"));

    const def = unitDefinition();
    const activated = seedAndActivateKnowledgeUnit(store, def, {
      now: clock("2026-09-08T00:00:00.000Z"),
    });
    expect(activated.state).toBe("IMPLEMENTING");
    expect(activated.revision).toBe(1);
    expect(activated.candidateSha).toBeUndefined();

    // (7) implementation completion != verification completion: PASS from the implementer only
    // ever reaches VERIFYING, never further, and the candidate SHA becomes canonical exactly here.
    const implResult = await driveKnowledgeHandoff(
      coordinator,
      implementerRun(def.unit, {
        unitDefinitionHash: activated.unitDefinitionHash,
        proofContractHash: activated.proofContractHash,
      }),
    );
    expect(implResult.duplicate).toBe(false);
    expect(implResult.state.state).toBe("VERIFYING");
    expect(implResult.state.candidateSha).toBe(CANDIDATE_SHA);
    const mailboxRecords = agent.list();
    expect(mailboxRecords).toHaveLength(1);
    expect(mailboxRecords[0].item.role).toBe("VERIFIER");
    expect(mailboxRecords[0].status).toBe("PENDING");

    const verifyResult = await driveKnowledgeHandoff(
      coordinator,
      verifierRun(def.unit, {
        unitDefinitionHash: activated.unitDefinitionHash,
        proofContractHash: activated.proofContractHash,
      }),
    );
    expect(verifyResult.state.state).toBe("PROVING_RED");
    expect(devGov.dispatched).toHaveLength(1);
    expect(devGov.dispatched[0].unit.candidateSha).toBe(CANDIDATE_SHA);

    // (10) metrics are deterministically reconstructable from the durable event log alone.
    const metrics = deriveKnowledgeUnitMetrics(store.read().events, def.unit);
    expect(metrics.candidateSha).toBe(CANDIDATE_SHA);
    expect(metrics.retries).toBe(0);
    expect(metrics.firstPassVerification).toBe(true);
    expect(metrics.implementerAgentRunIds).toEqual(["impl-run-1"]);
    expect(metrics.verifierAgentRunIds).toEqual(["verify-run-1"]);
  });

  it("(1) deterministic Knowledge work identity: seeding the same definition twice never collides", () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    const def = unitDefinition();
    const first = seedAndActivateKnowledgeUnit(store, def, { now: clock("2026-09-08T00:00:00.000Z") });
    const second = seedAndActivateKnowledgeUnit(store, def, { now: clock("2026-09-08T00:00:00.000Z") });
    expect(second).toEqual(first);
    expect(store.read().events.filter((e) => e.kind === "UNIT_STATE_TRANSITIONED")).toHaveLength(1);
  });

  it("(1) fails closed rather than silently reusing another unit's canonical identity", () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    seedAndActivateKnowledgeUnit(store, unitDefinition(), { now: clock("2026-09-08T00:00:00.000Z") });
    expect(() =>
      seedAndActivateKnowledgeUnit(store, unitDefinition({ base_sha: "3".repeat(40) }), {
        now: clock("2026-09-08T00:00:00.000Z"),
      }),
    ).toThrow();
  });

  it("(3) two independent Knowledge units coexist in one store without state collision", async () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    const agent = new RecordingAgentPort();
    const devGov = new LocalDevGovDispatchStub();
    const coordinator = buildKnowledgeCoordinator(store, agent, devGov, clock("2026-09-08T00:20:00.000Z"));

    const defA = unitDefinition({ unit: "KNOWLEDGE-CP-ADAPTER-FIXTURE-A" });
    const defB = unitDefinition({ unit: "KNOWLEDGE-CP-ADAPTER-FIXTURE-B" });
    const a = seedAndActivateKnowledgeUnit(store, defA, { now: clock("2026-09-08T00:00:00.000Z") });
    const b = seedAndActivateKnowledgeUnit(store, defB, { now: clock("2026-09-08T00:00:01.000Z") });
    expect(a.unitId).not.toBe(b.unitId);

    await driveKnowledgeHandoff(
      coordinator,
      implementerRun(defA.unit, {
        unitDefinitionHash: a.unitDefinitionHash,
        proofContractHash: a.proofContractHash,
      }),
    );

    const snapshot = store.read();
    expect(snapshot.units[defA.unit].state).toBe("VERIFYING");
    expect(snapshot.units[defB.unit].state).toBe("IMPLEMENTING");
    expect(snapshot.events.every((e) => e.unitId === defA.unit || e.unitId === defB.unit)).toBe(true);
  });

  it("(2) lease scope overlap enforces mutual exclusion for a Knowledge-shaped unit id", () => {
    const registry = new InMemoryLeaseRegistry();
    const unitId = "KNOWLEDGE-CP-ADAPTER-FIXTURE-1";
    const lease = (overrides: Partial<AgentLease> = {}): AgentLease => ({
      leaseId: overrides.leaseId ?? "lease-1",
      unitId,
      role: "IMPLEMENTER",
      holder: "claude-a",
      scope: ["packages/mps-knowledge-corpus/**"],
      candidateSha: CANDIDATE_SHA,
      issuedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-09-08T01:00:00.000Z",
      heartbeatAt: "2026-09-08T00:00:00.000Z",
      status: "ACTIVE",
      ...overrides,
    });

    const at = new Date("2026-09-08T00:00:00.000Z");
    registry.acquire(lease(), at);
    expect(() => registry.acquire(lease({ leaseId: "lease-2" }), at)).toThrow(LeaseConflictError);

    // A different unit with the same scope is unaffected (dependencies are per unit_id+role+scope,
    // not manufactured across unrelated units).
    expect(() =>
      registry.acquire(lease({ leaseId: "lease-3", unitId: "KNOWLEDGE-CP-ADAPTER-FIXTURE-2" }), at),
    ).not.toThrow();
  });

  it("(4) a replayed handoff does not duplicate the authoritative outcome or re-dispatch", async () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    const agent = new RecordingAgentPort();
    const devGov = new LocalDevGovDispatchStub();
    const coordinator = buildKnowledgeCoordinator(store, agent, devGov, clock("2026-09-08T00:20:00.000Z"));
    const def = unitDefinition();
    const activated = seedAndActivateKnowledgeUnit(store, def, { now: clock("2026-09-08T00:00:00.000Z") });
    const run = implementerRun(def.unit, {
      unitDefinitionHash: activated.unitDefinitionHash,
      proofContractHash: activated.proofContractHash,
    });

    const first = await driveKnowledgeHandoff(coordinator, run);
    const replayed = await driveKnowledgeHandoff(coordinator, run);
    expect(replayed.duplicate).toBe(true);
    expect(replayed.state).toEqual(first.state);
    expect(agent.calls).toHaveLength(1);
  });

  it("(4) reusing an agentRunId with a different payload is refused, not silently accepted", async () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    const agent = new RecordingAgentPort();
    const devGov = new LocalDevGovDispatchStub();
    const coordinator = buildKnowledgeCoordinator(store, agent, devGov, clock("2026-09-08T00:20:00.000Z"));
    const def = unitDefinition();
    const activated = seedAndActivateKnowledgeUnit(store, def, { now: clock("2026-09-08T00:00:00.000Z") });
    const base = implementerRun(def.unit, {
      unitDefinitionHash: activated.unitDefinitionHash,
      proofContractHash: activated.proofContractHash,
    });
    await driveKnowledgeHandoff(coordinator, base);

    const relabeled = { ...base, outcome: "FAIL" as const, findings: [
      { id: "F1", severity: "BLOCKING" as const, classification: "MECHANICAL" as const, message: "reused id" },
    ] };
    await expect(driveKnowledgeHandoff(coordinator, relabeled)).rejects.toThrow(
      DuplicateHandoffConflictError,
    );
    expect(store.read().units[def.unit].state).toBe("VERIFYING");
  });

  it("(5) retry/restart preserves identity: a fresh coordinator over the same store resumes cleanly", async () => {
    const root = tmpRoot();
    const storePath = path.join(root, "knowledge-store.json");
    const def = unitDefinition();
    const activated = seedAndActivateKnowledgeUnit(new FileDurableControlPlaneStore(storePath), def, {
      now: clock("2026-09-08T00:00:00.000Z"),
    });

    const restartedStore = new FileDurableControlPlaneStore(storePath);
    const agent = new RecordingAgentPort();
    const devGov = new LocalDevGovDispatchStub();
    const coordinator = buildKnowledgeCoordinator(
      restartedStore,
      agent,
      devGov,
      clock("2026-09-08T00:20:00.000Z"),
    );
    const result = await driveKnowledgeHandoff(
      coordinator,
      implementerRun(def.unit, {
        unitDefinitionHash: activated.unitDefinitionHash,
        proofContractHash: activated.proofContractHash,
      }),
    );
    expect(result.state.unitId).toBe(activated.unitId);
    expect(result.state.unitDefinitionHash).toBe(activated.unitDefinitionHash);
    expect(result.state.baseSha).toBe(activated.baseSha);
  });

  it("(6) a stale handoff (wrong candidate SHA) cannot overwrite newer authoritative state", async () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    const agent = new RecordingAgentPort();
    const devGov = new LocalDevGovDispatchStub();
    const coordinator = buildKnowledgeCoordinator(store, agent, devGov, clock("2026-09-08T00:20:00.000Z"));
    const def = unitDefinition();
    const activated = seedAndActivateKnowledgeUnit(store, def, { now: clock("2026-09-08T00:00:00.000Z") });
    await driveKnowledgeHandoff(
      coordinator,
      implementerRun(def.unit, {
        unitDefinitionHash: activated.unitDefinitionHash,
        proofContractHash: activated.proofContractHash,
      }),
    );

    const staleVerifier = toAgentHandoff(
      verifierRun(def.unit, {
        unitDefinitionHash: activated.unitDefinitionHash,
        proofContractHash: activated.proofContractHash,
        observedCandidateSha: "9".repeat(40), // stale/wrong candidate
      }),
    );
    await expect(coordinator.acceptHandoff(staleVerifier)).rejects.toThrow(ControlPlaneTransitionError);
    expect(store.read().units[def.unit].state).toBe("VERIFYING");
    expect(store.read().units[def.unit].candidateSha).toBe(CANDIDATE_SHA);
  });

  it("(8) failed verification is auto-reopened for the implementer, never promotion-ready", async () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    const agent = new RecordingAgentPort();
    const devGov = new LocalDevGovDispatchStub();
    const coordinator = buildKnowledgeCoordinator(store, agent, devGov, clock("2026-09-08T00:20:00.000Z"));
    const def = unitDefinition();
    const activated = seedAndActivateKnowledgeUnit(store, def, { now: clock("2026-09-08T00:00:00.000Z") });
    await driveKnowledgeHandoff(
      coordinator,
      implementerRun(def.unit, {
        unitDefinitionHash: activated.unitDefinitionHash,
        proofContractHash: activated.proofContractHash,
      }),
    );
    const failResult = await driveKnowledgeHandoff(
      coordinator,
      verifierRun(def.unit, {
        unitDefinitionHash: activated.unitDefinitionHash,
        proofContractHash: activated.proofContractHash,
        outcome: "FAIL",
        verifierIndependent: undefined,
        findings: [
          { id: "F1", severity: "BLOCKING", classification: "SEMANTIC", message: "gap in coverage" },
        ],
      }),
    );
    // routeAfterHandoff sends a VERIFIER FAIL through the intermediate VERIFY_FAILED state and
    // auto-activates straight back to IMPLEMENTING (same as the real DurableCoordinator) — the
    // unit is never left sitting in VERIFY_FAILED waiting for a promotion path that doesn't exist.
    expect(failResult.state.state).toBe("IMPLEMENTING");
    expect(devGov.dispatched).toHaveLength(0);

    // (9) exact candidate/evidence binding preserved: a subsequent handoff claiming DEV-GOV proof
    // for this unit's candidate is impossible from IMPLEMENTING — there is no automatic route.
    const bogusDevGovClaim = toAgentHandoff(
      verifierRun(def.unit, {
        agentRunId: "verify-run-2",
        unitDefinitionHash: activated.unitDefinitionHash,
        proofContractHash: activated.proofContractHash,
        inputState: "PROVING_GREEN",
      }),
    );
    await expect(coordinator.acceptHandoff(bogusDevGovClaim)).rejects.toThrow(ControlPlaneTransitionError);
  });

  it("(9) a handoff whose unit-definition hash drifted from the canonical one is refused", async () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    const agent = new RecordingAgentPort();
    const devGov = new LocalDevGovDispatchStub();
    const coordinator = buildKnowledgeCoordinator(store, agent, devGov, clock("2026-09-08T00:20:00.000Z"));
    const def = unitDefinition();
    const activated = seedAndActivateKnowledgeUnit(store, def, { now: clock("2026-09-08T00:00:00.000Z") });

    const driftedHandoff = toAgentHandoff(
      implementerRun(def.unit, {
        unitDefinitionHash: "f".repeat(64), // does not match the canonical seeded hash
        proofContractHash: activated.proofContractHash,
      }),
    );
    await expect(coordinator.acceptHandoff(driftedHandoff)).rejects.toThrow(ControlPlaneTransitionError);
  });

  it("KnowledgeUnitSeedError surfaces before any store mutation for an invalid unit definition", () => {
    const root = tmpRoot();
    const store = new FileDurableControlPlaneStore(path.join(root, "knowledge-store.json"));
    expect(() => seedKnowledgeUnitState(unitDefinition({ base_sha: "not-a-sha" }))).toThrow(
      KnowledgeUnitSeedError,
    );
    expect(store.read().units).toEqual({});
  });
});
