/**
 * Capability Runtime — Epoch II §2.5.
 *
 * Generic invoke: RegistryRuntime → implementation_ref → registered handler
 * → FrozenCapabilityExecutionArtifact.
 *
 * Domain packages register handlers at the composition root.
 * This module MUST NOT import domain (LU, RuleEngines, providers).
 */

import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { FrozenCapabilityExecutionArtifact } from "../contracts/freeze/FrozenIdentities.js";
import {
  sha256ContentHash,
  type CapabilityExecutorPort,
} from "../kernel/ExecutionKernel.js";
import type { RuntimeState } from "../kernel/RuntimeState.js";
import type { RegistryRuntime } from "../registry/RegistryRuntime.js";

export const CAPABILITY_RUNTIME_VERSION = "1.0.0" as const;

/** Domain-registered invoke — inputs/outputs are artifact id refs only. */
export type CapabilityInvokeHandler = (
  inputs: readonly { readonly artifact_id: string }[],
) => Promise<readonly { readonly artifact_id: string }[]>;

export type CapabilityRuntimeOptions = {
  readonly registry: RegistryRuntime;
  /**
   * Map implementation_ref.artifact_id → invoke handler.
   * Composition root registers domain implementations here.
   */
  readonly handlers: ReadonlyMap<string, CapabilityInvokeHandler>;
};

/**
 * Sole platform surface for capability invoke used by ExecutionKernel.
 */
export class CapabilityRuntime {
  private readonly registry: RegistryRuntime;
  private readonly handlers: ReadonlyMap<string, CapabilityInvokeHandler>;

  private constructor(options: CapabilityRuntimeOptions) {
    this.registry = options.registry;
    this.handlers = options.handlers;
  }

  static create(options: CapabilityRuntimeOptions): CapabilityRuntime {
    if (options.handlers.size === 0) {
      throw new Error(
        "CapabilityRuntime: at least one implementation handler must be registered",
      );
    }
    return new CapabilityRuntime(options);
  }

  /** Port consumed by ExecutionKernel — domain-agnostic. */
  asExecutorPort(): CapabilityExecutorPort {
    return {
      execute: (args) => this.execute(args),
    };
  }

  async execute(args: {
    readonly capability_ref: ArtifactReference;
    readonly input_refs: readonly ArtifactReference[];
    readonly state: RuntimeState;
  }): Promise<FrozenCapabilityExecutionArtifact> {
    const resolved = this.registry.resolveCapabilityByRef(
      args.capability_ref.artifact_id,
    );
    if (!resolved) {
      throw new Error(
        `Capability not in registry: ${args.capability_ref.artifact_id}`,
      );
    }

    const implementationId = resolved.implementation_ref.artifact_id;
    const handler = this.handlers.get(implementationId);
    if (!handler) {
      throw new Error(
        `No invoke handler registered for implementation: ${implementationId}`,
      );
    }

    const outputs = await handler(
      args.input_refs.map((r) => ({ artifact_id: r.artifact_id })),
    );

    const outputArtifactType =
      resolved.output_types[0] ?? "capability_output";

    const payload = {
      capability: resolved.artifact_id,
      implementation: implementationId,
      outputs: outputs.map((o) => o.artifact_id),
    };
    const content_hash = sha256ContentHash(payload);

    return {
      artifact_id: `exec-${resolved.artifact_id}-${content_hash.value.slice(0, 12)}`,
      artifact_type: "CAPABILITY_EXECUTION",
      capability_ref: {
        artifact_id: resolved.artifact_id,
        artifact_type: "CAPABILITY_DEFINITION",
      },
      input_refs: args.input_refs,
      output_refs: outputs.map((o) => ({
        artifact_id: o.artifact_id,
        artifact_type: outputArtifactType,
      })),
      content_hash,
    };
  }
}
