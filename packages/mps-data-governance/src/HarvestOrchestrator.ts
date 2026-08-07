// packages/mps-data-governance/src/HarvestOrchestrator.ts

import type {
  HarvestExecutionRequest,
  HarvestExecutionResult,
  HarvestExecutionCheckpoint,
  HarvestExecutionState,
} from "./HarvestOrchestratorTypes";

import type {
  HarvestExecutor,
  VerificationExecutor,
  ComplianceRunner,
  ProjectionExecutor,
  LURuntimeInitializer,
} from "./HarvestOrchestratorContracts";

import type {
  ContentReference,
  ArtifactReference,
  Timestamp,
} from "../../mps-core/src/types";
import type { HarvestCheckpointStore } from "./HarvestCheckpointStore";

import { HarvestExecutionStateMachine } from "./HarvestExecutionStateMachine";
import type { ImportGate } from "./ImportGate";

interface Clock {
  now(): Timestamp;
}

export class HarvestOrchestrator {
  constructor(
    private readonly harvestExecutor: HarvestExecutor,
    private readonly verificationExecutor: VerificationExecutor,
    private readonly complianceRunner: ComplianceRunner,
    private readonly importGate: ImportGate,
    private readonly projectionExecutor: ProjectionExecutor,
    private readonly luInitializer: LURuntimeInitializer,
    private readonly checkpointStore: HarvestCheckpointStore,
    private readonly clock: Clock,
  ) {}

  async execute(request: HarvestExecutionRequest): Promise<HarvestExecutionResult> {
    const checkpoint = await this.checkpointStore.load(request.execution_id);
    const state: HarvestExecutionState = checkpoint?.state ?? "CREATED";

    switch (state) {
      case "CREATED":
        return this.runHarvesting(request);

      case "HARVESTED":
        return this.runVerification(request, checkpoint!.manifest_ref!);

      case "VERIFIED":
      case "AWAITING_APPROVAL":
        // Governance boundary: orchestrator stops at AWAITING_APPROVAL
        return {
          state: "AWAITING_APPROVAL",
          produced_artifacts: checkpoint?.manifest_ref ? [checkpoint.manifest_ref] : [],
          evidence_refs: checkpoint?.verification_ref ? [checkpoint.verification_ref] : [],
        };

      case "APPROVED":
        return this.runCompliance(request, checkpoint!.manifest_ref!, checkpoint!.approval_ref!);

      case "COMPLIANCE_CHECK":
      case "IMPORT_GATE":
        return this.runImportGate(
          request,
          checkpoint!.manifest_ref!,
          checkpoint!.approval_ref!,
          checkpoint!.compliance_results!,
        );

      case "ALLOW_IMPORT":
        return this.runProjection(
          request,
          checkpoint!.gate_evidence_ref!,
          checkpoint!.archive_refs ?? [checkpoint!.manifest_ref!],
        );

      case "POSTGIS_PROJECTION":
        return this.runLUInitialization(request, checkpoint!.projection_ref!);

      default:
        return this.terminalResult(state, checkpoint ?? {});
    }
  }

  /**
   * Event-driven resume after human governance decision.
   */
  async resumeWithApproval(
    execution_id: string,
    approval_ref: ArtifactReference,
  ): Promise<void> {
    const checkpoint = await this.checkpointStore.load(execution_id);
    if (!checkpoint || checkpoint.state !== "AWAITING_APPROVAL") {
      throw new Error(`Cannot resume with approval from state '${checkpoint?.state ?? "UNKNOWN"}'.`);
    }

    await this.saveCheckpoint(execution_id, {
      state: "APPROVED",
      manifest_ref: checkpoint.manifest_ref,
      verification_ref: checkpoint.verification_ref,
      approval_ref,
      archive_refs: checkpoint.archive_refs ?? [checkpoint.manifest_ref!],
    });
  }

  // -------------------------------
  // Stage 1: Harvest
  // -------------------------------

  private async runHarvesting(request: HarvestExecutionRequest): Promise<HarvestExecutionResult> {
    // Övergå först till HARVESTING (transitional state)
    await this.saveCheckpoint(request.execution_id, { state: "HARVESTING" });

    const manifest_ref = await this.harvestExecutor.execute(request);

    await this.saveCheckpoint(request.execution_id, {
      state: "HARVESTED",
      manifest_ref,
    });

    return this.runVerification(request, manifest_ref);
  }

  // -------------------------------
  // Stage 2: Verification
  // -------------------------------

  private async runVerification(
    request: HarvestExecutionRequest,
    manifest_ref: ContentReference,
  ): Promise<HarvestExecutionResult> {
    try {
      // Övergå först till VERIFYING (transitional state)
      await this.saveCheckpoint(request.execution_id, { state: "VERIFYING", manifest_ref });

      const verification_ref = await this.verificationExecutor.verify(manifest_ref);

      await this.saveCheckpoint(request.execution_id, {
        state: "VERIFIED",
        manifest_ref,
        verification_ref,
      });

      // Övergå direkt till AWAITING_APPROVAL och stoppa där (asynkron event/resume gräns)
      await this.saveCheckpoint(request.execution_id, {
        state: "AWAITING_APPROVAL",
        manifest_ref,
        verification_ref,
      });

      // Stop at governance boundary; caller will later resumeWithApproval()
      return {
        state: "AWAITING_APPROVAL",
        produced_artifacts: [manifest_ref],
        evidence_refs: [verification_ref],
      };
    } catch {
      await this.saveCheckpoint(request.execution_id, {
        state: "QUARANTINED",
        manifest_ref,
      });

      return this.terminalResult("QUARANTINED", { manifest_ref });
    }
  }

  // -------------------------------
  // Stage 4: Compliance
  // -------------------------------

  private async runCompliance(
    request: HarvestExecutionRequest,
    manifest_ref: ContentReference,
    approval_ref: ArtifactReference,
  ): Promise<HarvestExecutionResult> {
    // 1. Övergå först till COMPLIANCE_CHECK (startar kommandorundan enligt state-machine)
    await this.saveCheckpoint(request.execution_id, {
      state: "COMPLIANCE_CHECK",
      manifest_ref,
      approval_ref,
    });

    const compliance_results = await this.complianceRunner.run(manifest_ref, approval_ref);

    const anyFail = compliance_results.some(r => r.result === "FAIL");

    if (anyFail) {
      // 2a. Om kontroller felar -> Gå sekventiellt från COMPLIANCE_CHECK till BLOCKED (Lagligt!)
      await this.saveCheckpoint(request.execution_id, {
        state: "BLOCKED",
        manifest_ref,
        approval_ref,
        compliance_results,
      });

      return this.terminalResult("BLOCKED", { compliance_results, approval_ref });
    }

    // 2b. Om kontroller passerar -> Gå sekventiellt från COMPLIANCE_CHECK till IMPORT_GATE (Lagligt!)
    await this.saveCheckpoint(request.execution_id, {
      state: "IMPORT_GATE",
      manifest_ref,
      approval_ref,
      compliance_results,
    });

    return this.runImportGate(request, manifest_ref, approval_ref, compliance_results);
  }

  // -------------------------------
  // Stage 5: ImportGate
  // -------------------------------

  private async runImportGate(
    request: HarvestExecutionRequest,
    manifest_ref: ContentReference,
    approval_ref: ArtifactReference,
    compliance_results: readonly any[],
  ): Promise<HarvestExecutionResult> {
    const approval_artifact = await this.checkpointStore.loadApproval(approval_ref);

    const gateResult = await this.importGate.evaluate(
      { manifest_ref, approval_artifact, compliance_results },
      request.requested_at,
    );

    const nextState: HarvestExecutionState =
      gateResult.decision === "ALLOW_IMPORT" ? "ALLOW_IMPORT" : "BLOCKED";

    await this.saveCheckpoint(request.execution_id, {
      state: nextState,
      manifest_ref,
      approval_ref,
      compliance_results,
      gate_evidence_ref: gateResult.evidence_ref,
      archive_refs: [manifest_ref],
    });

    if (nextState === "BLOCKED") {
      return this.terminalResult("BLOCKED", gateResult);
    }

    return this.runProjection(request, gateResult.evidence_ref, [manifest_ref]);
  }

  // -------------------------------
  // Stage 6: Projection
  // -------------------------------

  private async runProjection(
    request: HarvestExecutionRequest,
    gate_evidence_ref: ArtifactReference,
    archive_refs: readonly ContentReference[],
  ): Promise<HarvestExecutionResult> {
    const projection_ref = await this.projectionExecutor.project({
      gate_evidence_ref,
      archive_refs,
    });

    await this.saveCheckpoint(request.execution_id, {
      state: "POSTGIS_PROJECTION",
      gate_evidence_ref,
      archive_refs,
      projection_ref,
    });

    return {
      state: "POSTGIS_PROJECTION",
      produced_artifacts: archive_refs,
      evidence_refs: [gate_evidence_ref, projection_ref],
    };
  }

  // -------------------------------
  // Stage 7: LU Initialization
  // -------------------------------

  private async runLUInitialization(
    request: HarvestExecutionRequest,
    projection_ref: ArtifactReference,
  ): Promise<HarvestExecutionResult> {
    const lu_ref = await this.luInitializer.initialize(projection_ref);

    await this.saveCheckpoint(request.execution_id, {
      state: "READY_FOR_LU",
      projection_ref,
      lu_ref,
    });

    return {
      state: "READY_FOR_LU",
      produced_artifacts: [],
      evidence_refs: [projection_ref, lu_ref],
    };
  }

  // -------------------------------
  // Helpers
  // -------------------------------

  private async saveCheckpoint(
    execution_id: string,
    next: Partial<HarvestExecutionCheckpoint>,
  ): Promise<void> {
    const previous = await this.checkpointStore.load(execution_id);

    if (previous) {
      HarvestExecutionStateMachine.assertTransition(previous.state, next.state!);
    }

    const checkpoint: HarvestExecutionCheckpoint = {
      checkpoint_version: 1,
      execution_id,
      updated_at: this.clock.now(),
      state: next.state!,
      manifest_ref: next.manifest_ref ?? previous?.manifest_ref,
      archive_refs: next.archive_refs ?? previous?.archive_refs,
      verification_ref: next.verification_ref ?? previous?.verification_ref,
      approval_ref: next.approval_ref ?? previous?.approval_ref,
      gate_evidence_ref: next.gate_evidence_ref ?? previous?.gate_evidence_ref,
      projection_ref: next.projection_ref ?? previous?.projection_ref,
      lu_ref: next.lu_ref ?? previous?.lu_ref,
      compliance_results: next.compliance_results ?? previous?.compliance_results,
    };

    await this.checkpointStore.save(execution_id, checkpoint);
  }

  private terminalResult(
    state: HarvestExecutionState,
    data: any,
  ): HarvestExecutionResult {
    const produced_artifacts: ContentReference[] = Object.values(data).filter(v => this.isContentRef(v));
    const evidence_refs: ArtifactReference[] = Object.values(data).filter(v => this.isArtifactRef(v));

    return {
      state,
      produced_artifacts,
      evidence_refs,
    };
  }

  private isContentRef(v: any): v is ContentReference {
    return this.isRef(v) && "id" in v && !("artifact_id" in v);
  }

  private isArtifactRef(v: any): v is ArtifactReference {
    return this.isRef(v) && "artifact_id" in v && "artifact_type" in v;
  }

  private isRef(v: any): boolean {
    return Boolean(v) && typeof v === "object" && "content_hash" in v;
  }
}
