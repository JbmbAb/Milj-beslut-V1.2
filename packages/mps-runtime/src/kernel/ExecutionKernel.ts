import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";

/** Canonical artifact identity — RFC 8785 → SHA-256. Re-exported as the kernel enforcement surface. */
export { sha256ContentHash };
import type {
  FrozenAdmissionResult,
  FrozenCapabilityExecutionArtifact,
  FrozenExecutionAttemptIdentity,
  FrozenExecutionManifestIdentity,
  FrozenExecutionOutcomeIdentity,
  FrozenReplayArtifact,
} from "../contracts/freeze/FrozenIdentities.js";
import { createFrozenExecutionOutcomeIdentityV2 } from "../contracts/freeze/FrozenIdentities.js";
import {
  createEmptyRuntimeState,
  type RuntimeState,
  type RegistrySnapshotView,
} from "./RuntimeState.js";

export interface ArtifactRepositoryPort {
  put(artifact: { artifact_id: string; content_hash: ContentHash; body: unknown }): Promise<void>;
  resolve<T>(ref: ArtifactReference): Promise<T>;
}

export interface AdmissionPort {
  admit(manifest: FrozenExecutionManifestIdentity, state: RuntimeState): Promise<FrozenAdmissionResult>;
}

export interface CapabilityExecutorPort {
  execute(args: {
    capability_ref: ArtifactReference;
    input_refs: readonly ArtifactReference[];
    state: RuntimeState;
  }): Promise<FrozenCapabilityExecutionArtifact>;
}

export interface WorkflowExecutorPort {
  execute(args: {
    workflow_definition_ref: ArtifactReference;
    input_refs: readonly ArtifactReference[];
    state: RuntimeState;
  }): Promise<import("../contracts/freeze/FrozenIdentities.js").FrozenWorkflowExecutionArtifact>;
}

export interface ReplayEnginePort {
  /**
   * Replay reads CAS via repository; Replay is NOT part of CAS.
   */
  replay(manifest_ref: ArtifactReference, state: RuntimeState): Promise<FrozenReplayArtifact>;
}

export interface ExecutionKernelDeps {
  readonly admission: AdmissionPort;
  readonly capabilityExecutor: CapabilityExecutorPort;
  readonly workflowExecutor?: WorkflowExecutorPort;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly replayEngine?: ReplayEnginePort;
  readonly registrySnapshot?: RegistrySnapshotView;
  /** Deterministic clock for identity timestamps. */
  readonly nowIso: () => string;
}

export interface ExecutionResult {
  readonly admission: FrozenAdmissionResult;
  readonly attempt: FrozenExecutionAttemptIdentity | null;
  readonly outcome: FrozenExecutionOutcomeIdentity | null;
  readonly capability_executions: readonly FrozenCapabilityExecutionArtifact[];
  readonly state: RuntimeState;
}

/**
 * ExecutionKernel — central general motor.
 * Domain packages (LU, etc.) are clients; kernel never imports domain.
 */
export class ExecutionKernel {
  private readonly deps: ExecutionKernelDeps;

  constructor(deps: ExecutionKernelDeps) {
    this.deps = deps;
  }

  async execute(manifest: FrozenExecutionManifestIdentity): Promise<ExecutionResult> {
    const state = createEmptyRuntimeState();
    state.registry_snapshot = this.deps.registrySnapshot ?? null;
    state.manifest = manifest;

    const admission = await this.deps.admission.admit(manifest, state);
    state.admission = admission;

    if (admission.decision !== "admitted") {
      const rejectionPayload = {
        manifest_id: manifest.manifest_id,
        reason: admission.reason,
        denied_at: this.deps.nowIso(),
      };
      
      const rejectionHash = sha256ContentHash(rejectionPayload);
      const rejectionArtifact = {
        artifact_id: `rejection-${manifest.manifest_id}`,
        artifact_type: "GovernanceRejectionArtifact" as const,
        manifest_ref: { artifact_id: manifest.manifest_id, artifact_type: "execution_manifest" as const },
        reason: admission.reason,
        content_hash: rejectionHash,
      };
      
      await this.deps.artifactRepository.put({
        artifact_id: rejectionArtifact.artifact_id,
        content_hash: rejectionHash,
        body: rejectionArtifact,
      });

      return {
        admission,
        attempt: null,
        outcome: null,
        capability_executions: [],
        state,
      };
    }

    const attemptPayload = {
      manifest_id: manifest.manifest_id,
      attempt_number: 1,
      started_at: this.deps.nowIso(),
    };
    const attempt: FrozenExecutionAttemptIdentity = {
      attempt_id: `attempt-${manifest.manifest_id}-1`,
      artifact_type: "execution_attempt",
      manifest_ref: {
        artifact_id: manifest.manifest_id,
        artifact_type: "execution_manifest",
      },
      attempt_number: 1,
      started_at: attemptPayload.started_at,
      content_hash: sha256ContentHash(attemptPayload),
    };
    state.attempt = attempt;

    await this.deps.artifactRepository.put({
      artifact_id: attempt.attempt_id,
      content_hash: attempt.content_hash,
      body: attempt,
    });

    const capability_ref = manifest.capability_resolution_ref;
    const capabilityExecution = await this.deps.capabilityExecutor.execute({
      capability_ref,
      input_refs: [],
      state,
    });

    await this.deps.artifactRepository.put({
      artifact_id: capabilityExecution.artifact_id,
      content_hash: capabilityExecution.content_hash,
      body: capabilityExecution,
    });

    state.execution_graph = {
      nodes: [
        {
          node_id: "cap-0",
          kind: "capability",
          ref: { artifact_id: capabilityExecution.artifact_id, artifact_type: "CAPABILITY_EXECUTION" },
        },
      ],
      edges: [],
    };

    const outcome: FrozenExecutionOutcomeIdentity = createFrozenExecutionOutcomeIdentityV2({
      attempt_ref: {
        artifact_id: attempt.attempt_id,
        artifact_type: "execution_attempt",
      },
      result: "success",
      capability_execution_ref: {
        artifact_id: capabilityExecution.artifact_id,
        artifact_type: "CAPABILITY_EXECUTION",
      },
    });
    state.execution_graph = {
      nodes: [
        ...state.execution_graph.nodes,
        {
          node_id: "outcome-0",
          kind: "outcome",
          ref: { artifact_id: outcome.outcome_id, artifact_type: outcome.artifact_type },
        },
      ],
      edges: [{ from: "cap-0", to: "outcome-0" }],
    };

    await this.deps.artifactRepository.put({
      artifact_id: outcome.outcome_id,
      content_hash: outcome.content_hash,
      body: outcome,
    });

    return {
      admission,
      attempt,
      outcome,
      capability_executions: [capabilityExecution],
      state,
    };
  }
}
