import type {
  HarvestExecutionRequest,
  HarvestExecutionState,
  HarvestExecutionResult,
  HarvestExecutionCheckpoint,
} from "./HarvestOrchestratorTypes";

import type {
  HarvestExecutor,
  VerificationExecutor,
  GovernanceReviewAwaiter,
  ComplianceRunner,
  ProjectionExecutor,
  LURuntimeInitializer,
  Clock,
} from "./HarvestOrchestratorContracts";

import type {
  ContentReference,
  ArtifactReference,
} from "../../mps-core/src/types";

import type { ImportGate } from "./ImportGate";
import type { HarvestCheckpointStore } from "./HarvestCheckpointStore";
import { HarvestExecutionStateMachine } from "./HarvestExecutionStateMachine";

/**
 * 🜃 HarvestOrchestrator (ORCH-001)
 * 
 * En formell, deterministisk och replay-kompatibel tillståndsmaskin och
 * orkestreringsmotor för Mimers Brunn.
 * 
 * Följer strikt alla 5 designjusteringar samt frysta driftsinvarianter:
 *   1. Event-driven asynkron resume för mänskligt godkännande (pollApproval).
 *   2. Ingen intern tolkning av approval-artefakter (delegeras till ImportGate).
 *   3. Separation av requested_at (begäran) och evaluated_at (ImportGate).
 *   4. Ingen Object.values()-baserad sökning; allt returneras i strikt typade strukturer.
 *   5. ORCH-007: Strikt sekventiell tillståndsverifiering via HarvestExecutionStateMachine.
 *   6. IMPORT-TIME-001: Ingen intern tidsstämpel-generering (använder injicerad Clock).
 *   7. Semantisk separation av ContentReference och ArtifactReference.
 */
export class HarvestOrchestrator {
  constructor(
    private readonly harvestExecutor: HarvestExecutor,
    private readonly verificationExecutor: VerificationExecutor,
    private readonly governanceAwaiter: GovernanceReviewAwaiter,
    private readonly complianceRunner: ComplianceRunner,
    private readonly importGate: ImportGate,
    private readonly projectionExecutor: ProjectionExecutor,
    private readonly luInitializer: LURuntimeInitializer,
    private readonly checkpointStore: HarvestCheckpointStore,
    private readonly clock: Clock, // Injicerad klocka för 100% deterministiska körtidsstämplar (IMPORT-TIME-001)
  ) {}

  /**
   * Startar eller återupptar en orkestrering baserat på sparat tillstånd (Checkpoint).
   */
  async execute(
    request: HarvestExecutionRequest,
  ): Promise<HarvestExecutionResult> {
    const checkpoint = await this.checkpointStore.load(request.execution_id);
    const currentState = checkpoint?.state ?? "CREATED";

    switch (currentState) {
      case "CREATED":
        return this.runHarvesting(request);

      case "HARVESTED":
        return this.runVerification(request, checkpoint!.manifest_ref!);

      case "VERIFIED":
      case "AWAITING_APPROVAL":
        return this.awaitApproval(request, checkpoint!.manifest_ref!, checkpoint!.verification_ref!);

      case "APPROVED":
        return this.runCompliance(request, checkpoint!.manifest_ref!, checkpoint!.approval_ref!);

      case "COMPLIANCE_CHECK":
        // Övergå först till IMPORT_GATE (sekventiell ordning) och kör sedan dörrvakten
        await this.transitionTo(request.execution_id, "IMPORT_GATE", {
          manifest_ref: checkpoint!.manifest_ref!,
          approval_ref: checkpoint!.approval_ref!,
          compliance_results: checkpoint!.compliance_results!,
        });
        return this.runImportGate(request, checkpoint!.manifest_ref!, checkpoint!.approval_ref!, checkpoint!.compliance_results!);

      case "IMPORT_GATE":
        return this.runImportGate(request, checkpoint!.manifest_ref!, checkpoint!.approval_ref!, checkpoint!.compliance_results!);

      case "ALLOW_IMPORT":
        return this.runProjection(request, checkpoint!.gate_evidence_ref!, checkpoint!.archive_refs!);

      case "POSTGIS_PROJECTION":
        return this.runLUInitialization(request, checkpoint!.projection_ref!);

      default:
        // Terminala tillstånd
        return this.buildResult(currentState, checkpoint ?? {});
    }
  }

  /**
   * ORCH-007: Strikt sekventiell tillståndsövergång med inbyggd karantäns-automatik.
   * Delegerar all tillståndsvalidering till den rena HarvestExecutionStateMachine-klassen.
   */
  private async transitionTo(
    executionId: string,
    targetState: HarvestExecutionState,
    checkpointData: Omit<HarvestExecutionCheckpoint, "state" | "checkpoint_version" | "execution_id" | "updated_at">
  ): Promise<HarvestExecutionCheckpoint> {
    const current = await this.checkpointStore.load(executionId);
    const currentState = current?.state ?? "CREATED";

    try {
      // Verifiera tillståndsövergången (ORCH-007) via den rena tillståndsmaskinen
      HarvestExecutionStateMachine.assertTransition(currentState, targetState);
    } catch (err: any) {
      // Överträdelse av sekventiell integritet (ORCH-007) -> Karantän omedelbart!
      const quarantinedCheckpoint: HarvestExecutionCheckpoint = {
        checkpoint_version: current?.checkpoint_version ?? 1,
        execution_id: executionId,
        updated_at: this.clock.now(),
        ...current,
        state: "QUARANTINED"
      };
      await this.checkpointStore.save(executionId, quarantinedCheckpoint);
      throw new Error(`[ORCH-007 Violation] Illegal state transition attempted: '${currentState}' -> '${targetState}'. Execution quarantined. Error: ${err.message}`);
    }

    const nextCheckpoint: HarvestExecutionCheckpoint = {
      checkpoint_version: current?.checkpoint_version ?? 1,
      execution_id: executionId,
      updated_at: this.clock.now(),
      ...checkpointData,
      state: targetState
    };

    await this.checkpointStore.save(executionId, nextCheckpoint);
    return nextCheckpoint;
  }

  // ------------------------------------------------------------
  // Stage 1: Harvest
  // ------------------------------------------------------------

  private async runHarvesting(
    request: HarvestExecutionRequest,
  ): Promise<HarvestExecutionResult> {
    // 1. Övergång till aktivt skördande tillstånd (transitional state)
    await this.transitionTo(request.execution_id, "HARVESTING", {});

    // 2. Exekvera skördejobbet
    const manifest_ref = await this.harvestExecutor.execute(request);

    // 3. Slutför skörden
    const checkpoint = await this.transitionTo(request.execution_id, "HARVESTED", {
      manifest_ref,
    });

    return this.runVerification(request, manifest_ref);
  }

  // ------------------------------------------------------------
  // Stage 2: Verification
  // ------------------------------------------------------------

  private async runVerification(
    request: HarvestExecutionRequest,
    manifest_ref: ContentReference,
  ): Promise<HarvestExecutionResult> {
    try {
      // 1. Övergång till aktiv verifiering (transitional state)
      await this.transitionTo(request.execution_id, "VERIFYING", { manifest_ref });

      // 2. Exekvera verifiering
      const verification_ref = await this.verificationExecutor.verify(manifest_ref);

      // 3. Spara grön verifiering
      const checkpoint = await this.transitionTo(request.execution_id, "VERIFIED", {
        manifest_ref,
        verification_ref,
      });

      return this.awaitApproval(request, manifest_ref, verification_ref);
    } catch {
      // Integritetsfel vid verifiering -> Quarantined!
      const checkpoint = await this.transitionTo(request.execution_id, "QUARANTINED", {
        manifest_ref,
      });

      return this.buildResult("QUARANTINED", checkpoint);
    }
  }

  // ------------------------------------------------------------
  // Stage 3: Governance Review (Non-Blocking Event/Resume)
  // ------------------------------------------------------------

  private async awaitApproval(
    request: HarvestExecutionRequest,
    manifest_ref: ContentReference,
    verification_ref: ArtifactReference,
  ): Promise<HarvestExecutionResult> {
    // Poll efter asynkront godkännandebeslut (Event/Resume)
    const approval_ref = await this.governanceAwaiter.pollApproval(manifest_ref);

    if (!approval_ref) {
      // Inget godkännande än -> Spara tillstånd och pausa exekveringen i AWAITING_APPROVAL
      const checkpoint = await this.transitionTo(request.execution_id, "AWAITING_APPROVAL", {
        manifest_ref,
        verification_ref,
      });

      return this.buildResult("AWAITING_APPROVAL", checkpoint);
    }

    // Ta inte bort eller tolk DatasetApproval-artefakten här; passera enbart referensen!
    const checkpoint = await this.transitionTo(request.execution_id, "APPROVED", {
      manifest_ref,
      verification_ref,
      approval_ref,
    });

    return this.runCompliance(request, manifest_ref, approval_ref);
  }

  // ------------------------------------------------------------
  // Stage 4: Compliance
  // ------------------------------------------------------------

  private async runCompliance(
    request: HarvestExecutionRequest,
    manifest_ref: ContentReference,
    approval_ref: ArtifactReference,
  ): Promise<HarvestExecutionResult> {
    const compliance_results = await this.complianceRunner.run(
      manifest_ref,
      approval_ref,
    );

    const anyFail = compliance_results.some(r => r.result === "FAIL");

    if (anyFail) {
      const checkpoint = await this.transitionTo(request.execution_id, "BLOCKED", {
        manifest_ref,
        approval_ref,
        compliance_results,
      });

      return this.buildResult("BLOCKED", checkpoint);
    }

    // 1. Spara resultat för compliance check
    await this.transitionTo(request.execution_id, "COMPLIANCE_CHECK", {
      manifest_ref,
      approval_ref,
      compliance_results,
    });

    // 2. Övergå till det efterföljande IMPORT_GATE steget (enligt tillståndsmaskinen)
    await this.transitionTo(request.execution_id, "IMPORT_GATE", {
      manifest_ref,
      approval_ref,
      compliance_results,
    });

    return this.runImportGate(request, manifest_ref, approval_ref, compliance_results);
  }

  // ------------------------------------------------------------
  // Stage 5: ImportGate
  // ------------------------------------------------------------

  private async runImportGate(
    request: HarvestExecutionRequest,
    manifest_ref: ContentReference,
    approval_ref: ArtifactReference,
    compliance_results: readonly any[],
  ): Promise<HarvestExecutionResult> {
    // 1. Ladda godkännandeartefakten genom butiken (Handoff till Gate)
    const approval_artifact = await this.checkpointStore.loadApproval(approval_ref);

    // 2. Evaluera ImportGate. Separera requested_at från evaluated_at (t.ex. med nuvarande tid)
    const evaluatedAt = this.clock.now();
    const gateResult = await this.importGate.evaluate(
      { manifest_ref, approval_artifact, compliance_results },
      evaluatedAt,
    );

    if (gateResult.decision !== "ALLOW_IMPORT") {
      const checkpoint = await this.transitionTo(request.execution_id, "BLOCKED", {
        manifest_ref,
        approval_ref,
        compliance_results,
        gate_evidence_ref: gateResult.evidence_ref,
      });

      return this.buildResult("BLOCKED", checkpoint);
    }

    const checkpoint = await this.transitionTo(request.execution_id, "ALLOW_IMPORT", {
      manifest_ref,
      approval_ref,
      compliance_results,
      gate_evidence_ref: gateResult.evidence_ref,
      archive_refs: [manifest_ref],
    });

    return this.runProjection(request, gateResult.evidence_ref, [manifest_ref]);
  }

  // ------------------------------------------------------------
  // Stage 6: Projection
  // ------------------------------------------------------------

  private async runProjection(
    request: HarvestExecutionRequest,
    gate_evidence_ref: ArtifactReference,
    archive_refs: readonly ContentReference[],
  ): Promise<HarvestExecutionResult> {
    const projection_ref = await this.projectionExecutor.project({
      gate_evidence_ref,
      archive_refs,
    });

    const checkpoint = await this.transitionTo(request.execution_id, "POSTGIS_PROJECTION", {
      gate_evidence_ref,
      archive_refs,
      projection_ref,
    });

    return this.runLUInitialization(request, projection_ref);
  }

  // ------------------------------------------------------------
  // Stage 7: LU Initialization
  // ------------------------------------------------------------

  private async runLUInitialization(
    request: HarvestExecutionRequest,
    projection_ref: ContentReference,
  ): Promise<HarvestExecutionResult> {
    const lu_ref = await this.luInitializer.initialize(projection_ref);

    const checkpoint = await this.transitionTo(request.execution_id, "READY_FOR_LU", {
      projection_ref,
      lu_ref,
    });

    return this.buildResult("READY_FOR_LU", checkpoint);
  }

  /**
   * Bygger ett sanningsekologiskt resultat utifrån explicit data.
   * Inga Object.values()-baserade elementsökningar är tillåtna!
   */
  private buildResult(
    state: HarvestExecutionState,
    checkpoint: HarvestExecutionCheckpoint
  ): HarvestExecutionResult {
    const produced: ContentReference[] = [];
    const evidence: ArtifactReference[] = [];

    if (checkpoint.manifest_ref) produced.push(checkpoint.manifest_ref);
    if (checkpoint.projection_ref) produced.push(checkpoint.projection_ref);
    if (checkpoint.lu_ref) produced.push(checkpoint.lu_ref);

    if (checkpoint.verification_ref) {
      evidence.push(checkpoint.verification_ref);
    }
    if (checkpoint.gate_evidence_ref) {
      evidence.push(checkpoint.gate_evidence_ref);
    }

    return {
      state,
      produced_artifacts: produced,
      evidence_refs: evidence,
    };
  }
}
