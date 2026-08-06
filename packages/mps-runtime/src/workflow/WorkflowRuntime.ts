/**
 * Workflow Runtime — Epoch II §2.6 (+ verification depth).
 *
 * Registry-backed ordered steps → CapabilityRuntime / nested workflows
 * → FrozenWorkflowExecutionArtifact (replay spine).
 *
 * Supports checkpoint resume, nested workflows, and deterministic parallel fan-out.
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
import type { WorkflowStepEntry } from "../registry/RegistryContracts.js";
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

/** Immutable progress for crash / step failure resume. */
export type WorkflowCheckpoint = {
  readonly workflow_id: string;
  readonly completed_step_ids: readonly string[];
  readonly execution_refs: readonly ArtifactReference[];
  readonly last_output_refs: readonly ArtifactReference[];
  readonly failed_step_id: string | null;
};

export class WorkflowStepError extends Error {
  readonly checkpoint: WorkflowCheckpoint;

  constructor(message: string, checkpoint: WorkflowCheckpoint) {
    super(message);
    this.name = "WorkflowStepError";
    this.checkpoint = checkpoint;
  }
}

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
    /** Resume after crash — skip completed steps. */
    readonly checkpoint?: WorkflowCheckpoint | null;
  }): Promise<FrozenWorkflowExecutionArtifact> {
    return this.runWorkflow(args.workflow_definition_ref.artifact_id, {
      input_refs: args.input_refs,
      state: args.state,
      checkpoint: args.checkpoint ?? null,
      nesting_depth: 0,
    });
  }

  /**
   * Resume from a WorkflowStepError checkpoint.
   * Continues at the failed step (re-runs it); does not restart from step 1.
   */
  async resume(args: {
    readonly workflow_definition_ref: ArtifactReference;
    readonly input_refs: readonly ArtifactReference[];
    readonly checkpoint: WorkflowCheckpoint;
    readonly state: RuntimeState;
  }): Promise<FrozenWorkflowExecutionArtifact> {
    if (args.checkpoint.workflow_id !== args.workflow_definition_ref.artifact_id) {
      throw new Error(
        `Checkpoint workflow mismatch: ${args.checkpoint.workflow_id} vs ${args.workflow_definition_ref.artifact_id}`,
      );
    }
    return this.execute({
      workflow_definition_ref: args.workflow_definition_ref,
      input_refs: args.input_refs,
      state: args.state,
      checkpoint: args.checkpoint,
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

  private async runWorkflow(
    workflow_id: string,
    ctx: {
      readonly input_refs: readonly ArtifactReference[];
      readonly state: RuntimeState;
      readonly checkpoint: WorkflowCheckpoint | null;
      readonly nesting_depth: number;
    },
  ): Promise<FrozenWorkflowExecutionArtifact> {
    if (ctx.nesting_depth > 8) {
      throw new Error("WorkflowRuntime: nested workflow depth exceeded");
    }

    const workflow = this.registry.resolveWorkflowByRef(workflow_id);
    if (!workflow) {
      throw new Error(`Workflow not in registry: ${workflow_id}`);
    }
    if (workflow.steps.length === 0) {
      throw new Error(`Workflow has no steps: ${workflow.artifact_id}`);
    }

    const completed = new Set(ctx.checkpoint?.completed_step_ids ?? []);
    const execution_refs: ArtifactReference[] = [
      ...(ctx.checkpoint?.execution_refs ?? []),
    ];
    const execution_order: string[] = [
      ...(ctx.checkpoint?.completed_step_ids ?? []),
    ];
    let stepInputs: readonly ArtifactReference[] =
      ctx.checkpoint && ctx.checkpoint.completed_step_ids.length > 0
        ? ctx.checkpoint.last_output_refs
        : ctx.input_refs;

    let index = 0;
    while (index < workflow.steps.length) {
      const step = workflow.steps[index]!;
      if (completed.has(step.step_id)) {
        index += 1;
        continue;
      }

      const group = step.parallel_group;
      if (group) {
        const batch: WorkflowStepEntry[] = [];
        let j = index;
        while (
          j < workflow.steps.length &&
          workflow.steps[j]!.parallel_group === group &&
          !completed.has(workflow.steps[j]!.step_id)
        ) {
          batch.push(workflow.steps[j]!);
          j += 1;
        }
        // Deterministic order within parallel group
        const ordered = [...batch].sort((a, b) =>
          a.step_id.localeCompare(b.step_id),
        );

        const batchOutputs: {
          step_id: string;
          refs: readonly ArtifactReference[];
          execRef: ArtifactReference;
        }[] = [];

        for (const parallelStep of ordered) {
          try {
            const ran = await this.runSingleStep(parallelStep, {
              input_refs: stepInputs,
              state: ctx.state,
              nesting_depth: ctx.nesting_depth,
            });
            batchOutputs.push({
              step_id: parallelStep.step_id,
              refs: ran.output_refs,
              execRef: ran.execution_ref,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new WorkflowStepError(message, {
              workflow_id: workflow.artifact_id,
              completed_step_ids: Object.freeze([...execution_order]),
              execution_refs: Object.freeze([...execution_refs]),
              last_output_refs: Object.freeze([...stepInputs]),
              failed_step_id: parallelStep.step_id,
            });
          }
        }

        for (const out of batchOutputs) {
          execution_refs.push(out.execRef);
          execution_order.push(out.step_id);
          completed.add(out.step_id);
        }
        stepInputs = batchOutputs.flatMap((o) => o.refs);
        index = j;
        continue;
      }

      try {
        const ran = await this.runSingleStep(step, {
          input_refs: stepInputs,
          state: ctx.state,
          nesting_depth: ctx.nesting_depth,
        });
        execution_refs.push(ran.execution_ref);
        execution_order.push(step.step_id);
        completed.add(step.step_id);
        stepInputs = ran.output_refs;
      } catch (err) {
        if (err instanceof WorkflowStepError) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new WorkflowStepError(message, {
          workflow_id: workflow.artifact_id,
          completed_step_ids: Object.freeze([...execution_order]),
          execution_refs: Object.freeze([...execution_refs]),
          last_output_refs: Object.freeze([...stepInputs]),
          failed_step_id: step.step_id,
        });
      }
      index += 1;
    }

    return this.sealExecution(workflow, execution_refs, execution_order);
  }

  private async runSingleStep(
    step: WorkflowStepEntry,
    ctx: {
      readonly input_refs: readonly ArtifactReference[];
      readonly state: RuntimeState;
      readonly nesting_depth: number;
    },
  ): Promise<{
    readonly execution_ref: ArtifactReference;
    readonly output_refs: readonly ArtifactReference[];
  }> {
    const hasCap = Boolean(step.capability_ref);
    const hasWf = Boolean(step.workflow_ref);
    if (hasCap === hasWf) {
      throw new Error(
        `Workflow step '${step.step_id}' must set exactly one of capability_ref or workflow_ref`,
      );
    }

    if (step.workflow_ref) {
      const nested = await this.runWorkflow(step.workflow_ref.artifact_id, {
        input_refs: ctx.input_refs,
        state: ctx.state,
        checkpoint: null,
        nesting_depth: ctx.nesting_depth + 1,
      });
      return {
        execution_ref: {
          artifact_id: nested.artifact_id,
          artifact_type: "WORKFLOW_EXECUTION",
        },
        // Nested outputs = last capability outputs are not on FrozenWorkflowExecutionArtifact;
        // expose nested execution as a single synthetic output ref for piping.
        output_refs: [
          {
            artifact_id: nested.artifact_id,
            artifact_type: "WORKFLOW_EXECUTION",
          },
        ],
      };
    }

    const capability = this.registry.resolveCapabilityByRef(
      step.capability_ref!.artifact_id,
    );
    if (!capability) {
      throw new Error(
        `Workflow step '${step.step_id}' capability not in registry: ${step.capability_ref!.artifact_id}`,
      );
    }

    const capExec = await this.capabilityExecutor.execute({
      capability_ref: {
        artifact_id: capability.artifact_id,
        artifact_type: "CAPABILITY_DEFINITION",
      },
      input_refs: ctx.input_refs,
      state: ctx.state,
    });

    return {
      execution_ref: {
        artifact_id: capExec.artifact_id,
        artifact_type: "CAPABILITY_EXECUTION",
      },
      output_refs: capExec.output_refs,
    };
  }

  private sealExecution(
    workflow: {
      readonly artifact_id: string;
      readonly workflow_key: string;
      readonly steps: readonly WorkflowStepEntry[];
    },
    execution_refs: readonly ArtifactReference[],
    execution_order: readonly string[],
  ): FrozenWorkflowExecutionArtifact {
    const workflow_definition_hash = sha256ContentHash({
      workflow_id: workflow.artifact_id,
      workflow_key: workflow.workflow_key,
      steps: workflow.steps.map((s) => ({
        step_id: s.step_id,
        capability_id: s.capability_ref?.artifact_id ?? null,
        workflow_id: s.workflow_ref?.artifact_id ?? null,
        parallel_group: s.parallel_group ?? null,
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
}
