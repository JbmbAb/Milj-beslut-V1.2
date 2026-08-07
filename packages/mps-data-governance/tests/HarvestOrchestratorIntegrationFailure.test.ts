// packages/mps-data-governance/tests/HarvestOrchestratorIntegrationFailure.test.ts

import { describe, test, expect, beforeEach, vi } from "vitest";
import { HarvestOrchestrator } from "../src/HarvestOrchestrator";
import type {
  HarvestExecutionRequest,
  HarvestExecutionCheckpoint,
} from "../src/HarvestOrchestratorTypes";

const contentRef = (hash: string) => ({ content_hash: { algorithm: "sha256", digest: hash }, id: hash });
const artifactRef = (id: string, hash: string) => ({ id, content_hash: { algorithm: "sha256", digest: hash } });

const fixedClock = { now: () => "2026-01-01T00:00:00.000Z" };

function mockCheckpointStore() {
  let store: Record<string, HarvestExecutionCheckpoint> = {};
  return {
    load: vi.fn(async (id: string) => store[id] ?? null),
    save: vi.fn(async (id: string, cp: HarvestExecutionCheckpoint) => {
      store[id] = cp;
    }),
    remove: vi.fn(async (id: string) => {
      delete store[id];
    }),
    loadApproval: vi.fn(async (ref: any) => ({
      artifact_id: 'approval-1',
      artifact_type: 'DATASET_APPROVAL' as any,
      approved_ref: contentRef("manifest"),
      decision: ref.id === "rejected-approval" ? "REJECTED" : "APPROVED",
      actor_ref: { actor_id: 'revisor', role: 'GOVERNANCE_REVIEWER' as any },
      decision_at: '2026-08-07T02:00:00Z',
      reason: 'Beslut'
    })),
    _store: store,
  };
}

describe("HarvestOrchestrator Integration — Failure Paths", () => {
  let store: ReturnType<typeof mockCheckpointStore>;
  let orchestrator: HarvestOrchestrator;

  const request: HarvestExecutionRequest = {
    dataset_ref: contentRef("dataset"),
    execution_id: "exec-fail",
    requested_at: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    store = mockCheckpointStore();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Verification failure → QUARANTINED
  // -------------------------------------------------------------------------

  test("Verification failure leads to QUARANTINED and stops pipeline", async () => {
    const mockHarvestExecutor = {
      execute: vi.fn(async () => contentRef("manifest")),
    };

    const mockVerificationExecutor = {
      verify: vi.fn(async () => {
        throw new Error("verification failed");
      }),
    };

    const mockComplianceRunner = { run: vi.fn() };
    const mockImportGate = { evaluate: vi.fn() };
    const mockProjectionExecutor = { project: vi.fn() };
    const mockLUInitializer = { initialize: vi.fn() };

    orchestrator = new HarvestOrchestrator(
      mockHarvestExecutor,
      mockVerificationExecutor,
      mockComplianceRunner,
      mockImportGate as any,
      mockProjectionExecutor,
      mockLUInitializer,
      store,
      fixedClock,
    );

    // Step 1: CREATED → HARVESTED
    await orchestrator.execute(request);

    // Step 2: HARVESTED → QUARANTINED (verification fails)
    const result = await orchestrator.execute(request);

    const cp = store._store["exec-fail"]!;
    expect(cp.state).toBe("QUARANTINED");

    expect(result.state).toBe("QUARANTINED");

    // No further stages
    expect(mockComplianceRunner.run).not.toHaveBeenCalled();
    expect(mockImportGate.evaluate).not.toHaveBeenCalled();
    expect(mockProjectionExecutor.project).not.toHaveBeenCalled();
    expect(mockLUInitializer.initialize).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. Compliance failure → BLOCKED
  // -------------------------------------------------------------------------

  test("Compliance failure leads to BLOCKED and prevents ImportGate", async () => {
    const mockHarvestExecutor = {
      execute: vi.fn(async () => contentRef("manifest")),
    };

    const mockVerificationExecutor = {
      verify: vi.fn(async () => artifactRef("verification", "vhash")),
    };

    const mockComplianceRunner = {
      run: vi.fn(async () => [
        { control_id: "MB-001", result: "PASS" as const },
        { control_id: "MB-002", result: "FAIL" as const },
      ]),
    };

    const mockImportGate = { evaluate: vi.fn() };
    const mockProjectionExecutor = { project: vi.fn() };
    const mockLUInitializer = { initialize: vi.fn() };

    orchestrator = new HarvestOrchestrator(
      mockHarvestExecutor,
      mockVerificationExecutor,
      mockComplianceRunner,
      mockImportGate as any,
      mockProjectionExecutor,
      mockLUInitializer,
      store,
      fixedClock,
    );

    // CREATED → HARVESTED
    await orchestrator.execute(request);
    // HARVESTED → VERIFIED
    await orchestrator.execute(request);
    // VERIFIED → AWAITING_APPROVAL
    await orchestrator.execute(request);

    const approval = artifactRef("approval", "ahash");

    await orchestrator.resumeWithApproval("exec-fail", approval);

    // Trigger execute to run compliance checks and reach BLOCKED
    await orchestrator.execute(request);

    const cp = store._store["exec-fail"]!;
    expect(cp.state).toBe("BLOCKED");

    expect(mockComplianceRunner.run).toHaveBeenCalledTimes(1);
    expect(mockImportGate.evaluate).not.toHaveBeenCalled();
    expect(mockProjectionExecutor.project).not.toHaveBeenCalled();
    expect(mockLUInitializer.initialize).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. ImportGate BLOCK_IMPORT → BLOCKED
  // -------------------------------------------------------------------------

  test("ImportGate BLOCK_IMPORT leads to BLOCKED and prevents projection", async () => {
    const mockHarvestExecutor = {
      execute: vi.fn(async () => contentRef("manifest")),
    };

    const mockVerificationExecutor = {
      verify: vi.fn(async () => artifactRef("verification", "vhash")),
    };

    const mockComplianceRunner = {
      run: vi.fn(async () => [
        { control_id: "MB-001", result: "PASS" as const },
      ]),
    };

    const mockImportGate = {
      evaluate: vi.fn(async () => ({
        decision: "BLOCK_IMPORT",
        evidence_ref: artifactRef("gate", "ghash"),
      })),
    };

    const mockProjectionExecutor = { project: vi.fn() };
    const mockLUInitializer = { initialize: vi.fn() };

    orchestrator = new HarvestOrchestrator(
      mockHarvestExecutor,
      mockVerificationExecutor,
      mockComplianceRunner,
      mockImportGate as any,
      mockProjectionExecutor,
      mockLUInitializer,
      store,
      fixedClock,
    );

    // CREATED → HARVESTED
    await orchestrator.execute(request);
    // HARVESTED → VERIFIED
    await orchestrator.execute(request);
    // VERIFIED → AWAITING_APPROVAL
    await orchestrator.execute(request);

    const approval = artifactRef("approval", "ahash");
    await orchestrator.resumeWithApproval("exec-fail", approval); // APPROVED → COMPLIANCE_CHECK → IMPORT_GATE

    const result = await orchestrator.execute(request); // IMPORT_GATE → BLOCKED

    const cp = store._store["exec-fail"]!;
    expect(cp.state).toBe("BLOCKED");

    expect(mockImportGate.evaluate).toHaveBeenCalledTimes(1);
    expect(mockProjectionExecutor.project).not.toHaveBeenCalled();
    expect(mockLUInitializer.initialize).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Governance rejection (simulated via ARCHIVED) stops pipeline
  // -------------------------------------------------------------------------

  test("Governance rejection modeled as ARCHIVED stops all further execution", async () => {
    const mockHarvestExecutor = {
      execute: vi.fn(async () => contentRef("manifest")),
    };

    const mockVerificationExecutor = {
      verify: vi.fn(async () => artifactRef("verification", "vhash")),
    };

    const mockComplianceRunner = { run: vi.fn() };
    const mockImportGate = { evaluate: vi.fn() };
    const mockProjectionExecutor = { project: vi.fn() };
    const mockLUInitializer = { initialize: vi.fn() };

    orchestrator = new HarvestOrchestrator(
      mockHarvestExecutor,
      mockVerificationExecutor,
      mockComplianceRunner,
      mockImportGate as any,
      mockProjectionExecutor,
      mockLUInitializer,
      store,
      fixedClock,
    );

    // Simulate external governance rejection:
    store._store["exec-fail"] = {
      checkpoint_version: 1,
      execution_id: "exec-fail",
      updated_at: fixedClock.now(),
      state: "ARCHIVED",
      manifest_ref: contentRef("manifest"),
      verification_ref: artifactRef("verification", "vhash"),
    };

    const result = await orchestrator.execute(request);

    expect(result.state).toBe("ARCHIVED");

    expect(mockComplianceRunner.run).not.toHaveBeenCalled();
    expect(mockImportGate.evaluate).not.toHaveBeenCalled();
    expect(mockProjectionExecutor.project).not.toHaveBeenCalled();
    expect(mockLUInitializer.initialize).not.toHaveBeenCalled();
  });
});
