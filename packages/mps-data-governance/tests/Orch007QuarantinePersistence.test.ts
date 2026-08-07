// packages/mps-data-governance/tests/Orch007QuarantinePersistence.test.ts

import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { HarvestOrchestrator } from "../src/HarvestOrchestrator";
import { FileCheckpointStore } from "../src/FileCheckpointStore";
import type { HarvestExecutionRequest } from "../src/HarvestOrchestratorTypes";

describe("🛡️ ORCH-007 — Fysisk Quarantine Persistence", () => {
  let tempDir: string;
  let fileStore: FileCheckpointStore;
  let orchestrator: HarvestOrchestrator;

  // Mock-executors för att isolera och framkalla fel
  let mockHarvestExecutor: any;
  let mockVerificationExecutor: any;
  let mockComplianceRunner: any;
  let mockImportGate: any;
  let mockProjectionExecutor: any;
  let mockLUInitializer: any;
  let fixedClock: any;

  const contentRef = (hash: string) => ({ content_hash: { algorithm: "sha256", digest: hash }, id: hash });

  const request: HarvestExecutionRequest = {
    dataset_ref: contentRef("raw-observation-123"),
    execution_id: "orch-run-007-violator",
    requested_at: "2026-08-07T00:00:00.000Z",
  };

  beforeAll(() => {
    // Skapa en isolerad, unik temporär mapp för master-arkivet på disk
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch007-quarantine-test-"));
    fileStore = new FileCheckpointStore(tempDir);

    mockHarvestExecutor = {
      execute: vi.fn().mockResolvedValue(contentRef("manifest-123"))
    };

    // Vi framkallar ett medvetet verifieringsfel för att trigga automatisk karantänssluss (L1-11)
    mockVerificationExecutor = {
      verify: vi.fn().mockRejectedValue(new Error("VERIFICATION_FAILED: Signature invalid or corrupted."))
    };

    mockComplianceRunner = { run: vi.fn() };
    mockImportGate = { evaluate: vi.fn() };
    mockProjectionExecutor = { project: vi.fn() };
    mockLUInitializer = { initialize: vi.fn() };
    fixedClock = { now: () => "2026-08-07T12:00:00.000Z" };

    orchestrator = new HarvestOrchestrator(
      mockHarvestExecutor,
      mockVerificationExecutor,
      mockComplianceRunner,
      mockImportGate,
      mockProjectionExecutor,
      mockLUInitializer,
      fileStore,
      fixedClock
    );
  });

  afterAll(() => {
    // Rensa mappen på disk efter avslutad provning
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("ORCH-007: Out-of-order state transitions or errors write physical quarantined checkpoints to the filesystem", async () => {
    // Orkestratorn kör hela kedjan i ett anrop: runHarvesting fortsätter in i
    // runVerification, precis som runProjection fortsätter in i LU-initiering.
    // Den stannar bara vid en governance-gräns (AWAITING_APPROVAL) eller ett
    // terminalt tillstånd. Eftersom mockVerificationExecutor kastar ett fel når
    // detta anrop QUARANTINED (ORCH-007 / L1-11).
    const res = await orchestrator.execute(request);
    expect(res.state).toBe("QUARANTINED");

    // Skörden hann utföras innan verifieringen fällde körningen — karantänen
    // beror alltså på verifieringsfelet och inte på att kedjan aldrig startade.
    expect(mockHarvestExecutor.execute).toHaveBeenCalledTimes(1);

    // Kontrollera att checkpoint-tillståndet på DISK är fryst till "QUARANTINED"
    const checkFile = path.join(tempDir, 'National_Archive', '_quarantine', 'checkpoints', `${request.execution_id}.json`);
    expect(fs.existsSync(checkFile)).toBe(true);
    const cp = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
    expect(cp.state).toBe("QUARANTINED");

    // Karantänen är terminal: ett nytt anrop återupptar inte körningen.
    const resumed = await orchestrator.execute(request);
    expect(resumed.state).toBe("QUARANTINED");
    expect(mockHarvestExecutor.execute).toHaveBeenCalledTimes(1);

    // Kontrollera att det dessutom skapades en fysisk, formell karantänspost under _quarantine/ (L1-11)
    const quarantineRecordPath = path.join(tempDir, 'National_Archive', '_quarantine', `quarantine_record_${request.execution_id}.json`);
    expect(fs.existsSync(quarantineRecordPath)).toBe(true);

    const record = JSON.parse(fs.readFileSync(quarantineRecordPath, 'utf8'));
    expect(record.execution_id).toBe(request.execution_id);
    expect(record.checkpoint.state).toBe("QUARANTINED");
    expect(record.governance_role).toBe("GOVERNANCE_REVIEWER");
    expect(record.retention_policy).toBe("KEEP_30_DAYS_FOR_AUDIT");

    // Bekräfta att exekveringskedjan stoppades helt (inga efterföljande anrop)
    expect(mockComplianceRunner.run).not.toHaveBeenCalled();
    expect(mockImportGate.evaluate).not.toHaveBeenCalled();
  });
});
