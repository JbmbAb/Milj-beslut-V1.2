import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HarvestOrchestrator } from '../src/HarvestOrchestrator';
import { HarvestExecutionCheckpoint, HarvestExecutionRequest } from '../src/HarvestOrchestratorTypes';
import type { DatasetApprovalArtifact } from '../src/DatasetApprovalArtifact';
import type { ContentReference, ArtifactReference } from '../../mps-core/src/types';

describe('🜃 HarvestOrchestrator & Ingestion State Machine (ORCH-001 / ORCH-007)', () => {
  let mockHarvestExecutor: any;
  let mockVerificationExecutor: any;
  let mockComplianceRunner: any;
  let mockImportGate: any;
  let mockProjectionExecutor: any;
  let mockLuInitializer: any;
  let mockCheckpointStore: any;
  let mockClock: any;
  let checkpointDb: Map<string, HarvestExecutionCheckpoint>;
  let orchestrator: HarvestOrchestrator;

  const manifestRef: ContentReference = {
    id: 'manifest-sgu',
    content_hash: { algorithm: 'sha256', digest: 'manifest-hash' }
  };

  const request: HarvestExecutionRequest = {
    dataset_ref: manifestRef,
    execution_id: 'orch-run-2026',
    requested_at: '2026-08-07T00:00:00Z'
  };

  const verificationRef: ArtifactReference = {
    artifact_id: 'verify-evidence',
    artifact_type: 'VERIFICATION_EVIDENCE',
    content_hash: { algorithm: 'sha256', digest: 'verify-hash' }
  };

  const approvalRef: ArtifactReference = {
    artifact_id: 'approval-artifact',
    artifact_type: 'DATASET_APPROVAL',
    content_hash: { algorithm: 'sha256', digest: 'approval-hash' }
  };

  const gateEvidenceRef: ArtifactReference = {
    artifact_id: 'gate-evidence',
    artifact_type: 'IMPORT_GATE_EVIDENCE',
    content_hash: { algorithm: 'sha256', digest: 'gate-hash' }
  };

  const projectionRef: ArtifactReference = {
    artifact_id: 'projection-artifact',
    artifact_type: 'POSTGIS_PROJECTION',
    content_hash: { algorithm: 'sha256', digest: 'projection-hash' }
  };

  const luRef: ArtifactReference = {
    artifact_id: 'lu-artifact',
    artifact_type: 'LU_RUNTIME_INIT',
    content_hash: { algorithm: 'sha256', digest: 'lu-hash' }
  };

  beforeEach(() => {
    checkpointDb = new Map();

    mockHarvestExecutor = { execute: vi.fn().mockResolvedValue(manifestRef) };
    mockVerificationExecutor = { verify: vi.fn().mockResolvedValue(verificationRef) };
    mockComplianceRunner = { run: vi.fn().mockResolvedValue([{ control_id: 'MB-006', result: 'PASS' }]) };
    mockImportGate = {
      evaluate: vi.fn().mockResolvedValue({
        decision: 'ALLOW_IMPORT',
        evidence_ref: gateEvidenceRef
      })
    };
    mockProjectionExecutor = { project: vi.fn().mockResolvedValue(projectionRef) };
    mockLuInitializer = { initialize: vi.fn().mockResolvedValue(luRef) };
    mockClock = { now: () => '2026-08-07T00:00:00Z' };

    mockCheckpointStore = {
      load: async (id: string) => checkpointDb.get(id) || null,
      save: async (id: string, checkpoint: any) => {
        checkpointDb.set(id, checkpoint);
      },
      loadApproval: async (ref: any): Promise<DatasetApprovalArtifact> => ({
        artifact_id: 'approval-1',
        artifact_type: 'DATASET_APPROVAL',
        content_hash: { algorithm: 'sha256', digest: 'approval-hash' },
        signature: { algorithm: 'ed25519', signature: 'sig:approval-hash' },
        approved_ref: manifestRef,
        decision: 'APPROVED',
        actor_ref: {
          identity_ref: {
            id: 'revisor',
            content_hash: { algorithm: 'sha256', digest: 'revisor-identity' }
          },
          role: 'GOVERNANCE_REVIEWER'
        },
        decision_at: '2026-08-07T02:00:00Z',
        reason: 'Godkänt'
      })
    };

    orchestrator = new HarvestOrchestrator(
      mockHarvestExecutor,
      mockVerificationExecutor,
      mockComplianceRunner,
      mockImportGate,
      mockProjectionExecutor,
      mockLuInitializer,
      mockCheckpointStore,
      mockClock
    );
  });

  it('runs Stage 1 and Stage 2 and pauses on Stage 3 (AWAITING_APPROVAL) without human block-waiting loops', async () => {
    const result = await orchestrator.execute(request);

    // Både skörd och verifiering ska ha körts
    expect(mockHarvestExecutor.execute).toHaveBeenCalled();
    expect(mockVerificationExecutor.verify).toHaveBeenCalledWith(manifestRef);

    // Orkestreringen ska pausa vid AWAITING_APPROVAL
    expect(result.state).toBe('AWAITING_APPROVAL');
    expect(result.produced_artifacts).toEqual([manifestRef]);
    expect(result.evidence_refs[0]!.artifact_id).toBe('verify-evidence');

    // Kontrollera sparat checkpoint
    const cp = checkpointDb.get(request.execution_id)!;
    expect(cp.state).toBe('AWAITING_APPROVAL');
    expect(cp.manifest_ref).toEqual(manifestRef);
    expect(cp.verification_ref).toEqual(verificationRef);
  });

  it('resumes from AWAITING_APPROVAL and runs until READY_FOR_LU once resumeWithApproval is triggered', async () => {
    // 1. Kör första vändan för att upprätta AWAITING_APPROVAL checkpoint
    await orchestrator.execute(request);
    expect(checkpointDb.get(request.execution_id)!.state).toBe('AWAITING_APPROVAL');

    // 2. Simulera mänskligt godkännandebeslut genom att anropa resumeWithApproval
    await orchestrator.resumeWithApproval(request.execution_id, approvalRef);
    expect(checkpointDb.get(request.execution_id)!.state).toBe('APPROVED');

    // 3. Återuppta orkestreringen!
    const result = await orchestrator.execute(request);

    expect(mockComplianceRunner.run).toHaveBeenCalledWith(manifestRef, approvalRef);
    expect(mockImportGate.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ manifest_ref: manifestRef }),
      expect.any(String)
    );
    expect(mockProjectionExecutor.project).toHaveBeenCalled();
    expect(mockLuInitializer.initialize).toHaveBeenCalledWith(projectionRef);

    // Ska nå terminaltillståndet READY_FOR_LU
    expect(result.state).toBe('READY_FOR_LU');

    // Verifiera att checkpoint är uppdaterad till slutsteget
    const cp = checkpointDb.get(request.execution_id)!;
    expect(cp.state).toBe('READY_FOR_LU');
    expect(cp.lu_ref).toEqual(luRef);
  });

  describe('ORCH-007: illegal transitions are quarantined, not merely thrown', () => {
    /**
     * Corrupts the run mid-flight: the harvest executor rewrites the checkpoint
     * to COMPLIANCE_CHECK, so the orchestrator's next save (HARVESTED) arrives
     * from a state it cannot legally come from.
     */
    function corruptCheckpointDuringHarvest() {
      mockHarvestExecutor.execute.mockImplementation(async () => {
        checkpointDb.set(request.execution_id, {
          checkpoint_version: 1,
          execution_id: request.execution_id,
          updated_at: '2026-08-07T00:00:00Z',
          state: 'COMPLIANCE_CHECK'
        });
        return manifestRef;
      });
    }

    it('persists QUARANTINED rather than leaving the checkpoint in its old state', async () => {
      corruptCheckpointDuringHarvest();

      await expect(orchestrator.execute(request)).rejects.toThrow('Illegal transition');

      // The exception alone proves nothing: it disappears up the call stack.
      // The durable account of the run must say QUARANTINED.
      const cp = checkpointDb.get(request.execution_id)!;
      expect(cp.state).toBe('QUARANTINED');
    });

    it('produces no authority: no compliance, no gate, no projection, no LU init', async () => {
      corruptCheckpointDuringHarvest();

      await expect(orchestrator.execute(request)).rejects.toThrow('Illegal transition');

      expect(mockComplianceRunner.run).not.toHaveBeenCalled();
      expect(mockImportGate.evaluate).not.toHaveBeenCalled();
      expect(mockProjectionExecutor.project).not.toHaveBeenCalled();
      expect(mockLuInitializer.initialize).not.toHaveBeenCalled();
    });

    it('is terminal: re-execution observes QUARANTINED without resuming the pipeline', async () => {
      corruptCheckpointDuringHarvest();
      await expect(orchestrator.execute(request)).rejects.toThrow('Illegal transition');

      mockHarvestExecutor.execute.mockClear();

      const result = await orchestrator.execute(request);

      expect(result.state).toBe('QUARANTINED');
      expect(checkpointDb.get(request.execution_id)!.state).toBe('QUARANTINED');
      expect(mockHarvestExecutor.execute).not.toHaveBeenCalled();
      expect(mockProjectionExecutor.project).not.toHaveBeenCalled();
      expect(mockLuInitializer.initialize).not.toHaveBeenCalled();
    });

    it('cannot be released by a governance approval arriving afterwards', async () => {
      corruptCheckpointDuringHarvest();
      await expect(orchestrator.execute(request)).rejects.toThrow('Illegal transition');

      await expect(
        orchestrator.resumeWithApproval(request.execution_id, approvalRef)
      ).rejects.toThrow(/QUARANTINED/);

      expect(checkpointDb.get(request.execution_id)!.state).toBe('QUARANTINED');
    });

    it('preserves the lineage reached before the violation', async () => {
      corruptCheckpointDuringHarvest();

      await expect(orchestrator.execute(request)).rejects.toThrow('Illegal transition');

      // Quarantine records how far the run got; it does not erase the evidence.
      const cp = checkpointDb.get(request.execution_id)!;
      expect(cp.execution_id).toBe(request.execution_id);
      expect(cp.checkpoint_version).toBe(1);
    });
  });
});
