import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HarvestOrchestrator } from '../src/HarvestOrchestrator';
import { HarvestExecutionCheckpoint, HarvestExecutionRequest } from '../src/HarvestOrchestratorTypes';
import type { DatasetApprovalArtifact } from '../src/DatasetApprovalArtifact';
import type { ContentReference } from '../../mps-core/src/types';

describe('🜃 HarvestOrchestrator & Ingestion State Machine (ORCH-001 / ORCH-007)', () => {
  let mockHarvestExecutor: any;
  let mockVerificationExecutor: any;
  let mockGovernanceAwaiter: any;
  let mockComplianceRunner: any;
  let mockImportGate: any;
  let mockProjectionExecutor: any;
  let mockLuInitializer: any;
  let mockCheckpointStore: any;
  let checkpointDb: Map<string, HarvestExecutionCheckpoint>;
  let orchestrator: HarvestOrchestrator;

  const request: HarvestExecutionRequest = {
    execution_id: 'orch-run-2026',
    source_id: 'mmd_vaxjo',
    requested_at: '2026-08-07T00:00:00Z'
  };

  const manifestRef: ContentReference = {
    id: 'manifest-sgu',
    content_hash: { algorithm: 'sha256', digest: 'manifest-hash' }
  };

  const verificationRef: ContentReference = {
    id: 'verify-evidence',
    content_hash: { algorithm: 'sha256', digest: 'verify-hash' }
  };

  const approvalRef: ContentReference = {
    id: 'approval-artifact',
    content_hash: { algorithm: 'sha256', digest: 'approval-hash' }
  };

  const gateEvidenceRef: ContentReference = {
    id: 'gate-evidence',
    content_hash: { algorithm: 'sha256', digest: 'gate-evidence-hash' }
  };

  const projectionRef: ContentReference = {
    id: 'projection-artifact',
    content_hash: { algorithm: 'sha256', digest: 'projection-hash' }
  };

  const luRef: ContentReference = {
    id: 'lu-artifact',
    content_hash: { algorithm: 'sha256', digest: 'lu-hash' }
  };

  beforeEach(() => {
    checkpointDb = new Map();

    mockHarvestExecutor = { execute: vi.fn().mockResolvedValue(manifestRef) };
    mockVerificationExecutor = { verify: vi.fn().mockResolvedValue(verificationRef) };
    mockGovernanceAwaiter = { pollApproval: vi.fn().mockResolvedValue(null) }; // Standard: väntar på godkännande
    mockComplianceRunner = { run: vi.fn().mockResolvedValue([{ control_id: 'MB-006', result: 'PASS' }]) };
    mockImportGate = {
      evaluate: vi.fn().mockResolvedValue({
        decision: 'ALLOW_IMPORT',
        evidence_ref: gateEvidenceRef
      })
    };
    mockProjectionExecutor = { project: vi.fn().mockResolvedValue(projectionRef) };
    mockLuInitializer = { initialize: vi.fn().mockResolvedValue(luRef) };

    mockCheckpointStore = {
      load: async (id: string) => checkpointDb.get(id) || null,
      save: async (id: string, checkpoint: any) => {
        checkpointDb.set(id, checkpoint);
      },
      loadApproval: async (ref: any) => ({
        artifact_id: 'approval-1',
        artifact_type: 'DATASET_APPROVAL',
        approved_ref: manifestRef,
        decision: 'APPROVED',
        actor_ref: { actor_id: 'revisor', role: 'GOVERNANCE_REVIEWER' },
        decision_at: '2026-08-07T02:00:00Z',
        reason: 'Godkänt'
      } as DatasetApprovalArtifact)
    };

    orchestrator = new HarvestOrchestrator(
      mockHarvestExecutor,
      mockVerificationExecutor,
      mockGovernanceAwaiter,
      mockComplianceRunner,
      mockImportGate,
      mockProjectionExecutor,
      mockLuInitializer,
      mockCheckpointStore
    );
  });

  it('runs Stage 1 and Stage 2 and pauses on Stage 3 (AWAITING_APPROVAL) when review is pending', async () => {
    const result = await orchestrator.execute(request);

    // Både skörd och verifiering ska ha körts
    expect(mockHarvestExecutor.execute).toHaveBeenCalled();
    expect(mockVerificationExecutor.verify).toHaveBeenCalledWith(manifestRef);
    expect(mockGovernanceAwaiter.pollApproval).toHaveBeenCalledWith(manifestRef);

    // Orkestreringen ska pausa vid AWAITING_APPROVAL
    expect(result.state).toBe('AWAITING_APPROVAL');
    expect(result.produced_artifacts).toEqual([manifestRef]);
    expect(result.evidence_refs[0]!.artifact_id).toBe('verification-evidence');

    // Kontrollera sparat checkpoint
    const cp = checkpointDb.get(request.execution_id)!;
    expect(cp.state).toBe('AWAITING_APPROVAL');
    expect(cp.manifest_ref).toEqual(manifestRef);
    expect(cp.verification_ref).toEqual(verificationRef);
  });

  it('resumes from AWAITING_APPROVAL and runs until READY_FOR_LU once human review resolves to APPROVED', async () => {
    // 1. Kör första vändan för att upprätta AWAITING_APPROVAL checkpoint
    await orchestrator.execute(request);
    expect(checkpointDb.get(request.execution_id)!.state).toBe('AWAITING_APPROVAL');

    // 2. Simulera att den mänskliga granskaren nu har godkänt (pollApproval returnerar nu referens)
    mockGovernanceAwaiter.pollApproval.mockResolvedValue(approvalRef);

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
    expect(result.produced_artifacts).toEqual([projectionRef, luRef]);

    // Verifiera att checkpoint är uppdaterad till slutsteget
    const cp = checkpointDb.get(request.execution_id)!;
    expect(cp.state).toBe('READY_FOR_LU');
    expect(cp.lu_ref).toEqual(luRef);
  });

  it('ORCH-007: immediately quarantines execution and throws upon out-of-order state transitions', async () => {
    // Spara ingen manuell checkpoint på förhand (börjar som CREATED).
    
    // Om mockHarvestExecutor sparar en checkpoint som är 'COMPLIANCE_CHECK' (hoppar över steg!)
    mockHarvestExecutor.execute.mockImplementation(async () => {
      checkpointDb.set(request.execution_id, { state: 'COMPLIANCE_CHECK' }); // Hack!
      return manifestRef;
    });

    await expect(
      orchestrator.execute(request)
    ).rejects.toThrow('[ORCH-007 Violation] Illegal state transition attempted');

    // Kontrollera att tillståndet omedelbart har försatts i karantän!
    const cp = checkpointDb.get(request.execution_id)!;
    expect(cp.state).toBe('QUARANTINED');
  });
});
