/**
 * Workflow Runtime — Epoch II §2.6.
 *
 * Registry-backed ordered steps → CapabilityRuntime / CapabilityExecutorPort
 * → FrozenWorkflowExecutionArtifact (replay spine).
 *
 * Domain-agnostic: no LU / RuleEngine / provider imports.
 */

import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { FrozenWorkflowExecutionArtifact } from "../contracts/freeze/FrozenIdentities.js";
import {
  sha256ContentHash,
  type CapabilityExecutorPort,
  type WorkflowExecutorPort,
} from "../kernel/ExecutionKernel.js";
import type { RuntimeState } from "../kernel/RuntimeState.js";
import type { RegistryRuntime } from "../registry/RegistryRuntime.js";
import type { CapabilityRuntime } from "../capability/CapabilityRuntime.js";

export const WORKFLOW_RUNTIME_VERSION = "1.0.0" as const;

export type WorkflowRuntimeOptions = {
  readonly registry: RegistryRuntime;
  /** Prefer CapabilityRuntime; CapabilityExecutorPort accepted for tests. */
  readonly capabilityRuntime?: CapabilityRuntime;
  readonly capabilityExecutor?: CapabilityExecutorPort;
};

export type WorkflowReplayResult = {
  readonly equivalent: boolean;
  readonly replayed: FrozenWorkflowExecutionArtifact;
};

/**
 * Sole platform surface for multi-step workflow execution.
 */
export class WorkflowRuntime {
  private readonly registry: RegistryRuntime;
  private readonly capabilityExecutor: CapabilityExecutorPort;

  private constructor(
    registry: RegistryRuntime,
    capabilityExecutor: CapabilityExecutorPort,
  ) {
    this.registry = registry;
    this.capabilityExecutor = capabilityExecutor;
  }

  static create(options: WorkflowRuntimeOptions): WorkflowRuntime {
    const executor =
      options.capabilityExecutor ??
      options.capabilityRuntime?.asExecutorPort();
    if (!executor) {
      throw new Error(
        "WorkflowRuntime: capabilityRuntime or capabilityExecutor is required",
      );
    }
    return new WorkflowRuntime(options.registry, executor);
  }

  /** Port consumed by ExecutionKernel when workflow path is wired. */
  asExecutorPort(): WorkflowExecutorPort {
    return {
      execute: (args) => this.execute(args),
    };
  }

  async execute(args: {
    readonly workflow_definition_ref: ArtifactReference;
    readonly input_refs: readonly ArtifactReference[];
    readonly state: RuntimeState;
  }): Promise<FrozenWorkflowExecutionArtifact> {
    const workflow = this.registry.resolveWorkflowByRef(
      args.workflow_definition_ref.artifact_id,
    );
    if (!workflow) {
      throw new Error(
        `Workflow not in registry: ${args.workflow_definition_ref.artifact_id}`,
      );
    }
    if (workflow.steps.length === 0) {
      throw new Error(
        `Workflow has no steps: ${workflow.artifact_id}`,
      );
    }

    const execution_refs: ArtifactReference[] = [];
    const execution_order: string[] = [];
    let stepInputs: readonly ArtifactReference[] = args.input_refs;

    for (const step of workflow.steps) {
      const capability = this.registry.resolveCapabilityByRef(
        step.capability_ref.artifact_id,
      );
      if (!capability) {
        throw new Error(
          `Workflow step '${step.step_id}' capability not in registry: ${step.capability_ref.artifact_id}`,
        );
      }

      const capExec = await this.capabilityExecutor.execute({
        capability_ref: {
          artifact_id: capability.artifact_id,
          artifact_type: "CAPABILITY_DEFINITION",
        },
        input_refs: stepInputs,
        state: args.state,
      });

      execution_refs.push({
        artifact_id: capExec.artifact_id,
        artifact_type: "CAPABILITY_EXECUTION",
      });
      execution_order.push(step.step_id);
      stepInputs = capExec.output_refs;
    }

    const workflow_definition_hash = sha256ContentHash({
      workflow_id: workflow.artifact_id,
      workflow_key: workflow.workflow_key,
      steps: workflow.steps.map((s) => ({
        step_id: s.step_id,
        capability_id: s.capability_ref.artifact_id,
      })),
    });

    const workflow_hash = sha256ContentHash({
      execution_refs: execution_refs.map((r) => r.artifact_id),
      execution_order,
    });

    const content_hash = sha256ContentHash({
      workflow_hash: workflow_hash.value,
      workflow_definition_hash: workflow_definition_hash.value,
      execution_refs: execution_refs.map((r) => r.artifact_id),
      execution_order,
    });

    return Object.freeze({
      artifact_id: `wf-exec-${workflow.artifact_id}-${content_hash.value.slice(0, 12)}`,
      artifact_type: "WORKFLOW_EXECUTION" as const,
      workflow_definition_ref: {
        artifact_id: workflow.artifact_id,
        artifact_type: "WORKFLOW_DEFINITION",
      },
      execution_refs: Object.freeze([...execution_refs]),
      execution_order: Object.freeze([...execution_order]),
      workflow_hash,
      workflow_definition_hash,
      content_hash,
    });
  }

  /**
   * Full-workflow replay: re-run same definition + inputs; compare content_hash.
   * Does not mutate prior execution artifact (immutable replay spine).
   */
  async replay(args: {
    readonly workflow_definition_ref: ArtifactReference;
    readonly input_refs: readonly ArtifactReference[];
    readonly prior_execution: FrozenWorkflowExecutionArtifact;
    readonly state: RuntimeState;
  }): Promise<WorkflowReplayResult> {
    const replayed = await this.execute({
      workflow_definition_ref: args.workflow_definition_ref,
      input_refs: args.input_refs,
      state: args.state,
    });
    return {
      equivalent:
        replayed.content_hash.value ===
          args.prior_execution.content_hash.value &&
        replayed.workflow_hash.value ===
          args.prior_execution.workflow_hash.value,
      replayed,
    };
  }
}
