/**
 * Shared Epoch II verification harness — domain-agnostic composition root.
 * Used by Architecture Invariants and Generality Proof suites.
 */

import type { FrozenExecutionManifestIdentity } from "../../contracts/freeze/FrozenIdentities.js";
import {
  ExecutionKernel,
  sha256ContentHash,
  type CapabilityExecutorPort,
} from "../../kernel/ExecutionKernel.js";
import { createEmptyRuntimeState } from "../../kernel/RuntimeState.js";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
} from "../../repository/CasBackedArtifactRepository.js";
import { DefaultReplayEngine } from "../../replay/DefaultReplayEngine.js";
import { createRegistryRuntime, type RegistryRuntime } from "../../registry/index.js";
import { CapabilityRuntime, type CapabilityInvokeHandler } from "../../capability/index.js";
import { WorkflowRuntime } from "../../workflow/index.js";
import { SecurityRuntime } from "../../security/index.js";
import { ObservabilityRuntime } from "../../observability/index.js";

export const HARNESS_PRINCIPAL = "verification.principal" as const;

export type HarnessCapability = {
  readonly artifact_id: string;
  readonly capability_key: string;
  readonly implementation_id: string;
  readonly input_types?: readonly string[];
  readonly output_types?: readonly string[];
  readonly handler: CapabilityInvokeHandler;
};

export type HarnessWorkflowStep = {
  readonly step_id: string;
  readonly capability_id?: string;
  readonly workflow_id?: string;
  readonly parallel_group?: string;
};

export type HarnessWorkflow = {
  readonly artifact_id: string;
  readonly workflow_key: string;
  readonly steps: readonly HarnessWorkflowStep[];
};

export type PlatformHarness = {
  readonly registry: RegistryRuntime;
  readonly capabilityRuntime: CapabilityRuntime;
  readonly workflowRuntime: WorkflowRuntime;
  readonly security: SecurityRuntime;
  readonly repo: CasBackedArtifactRepository;
  readonly kernel: ExecutionKernel;
};

export function createPlatformHarness(input: {
  readonly snapshot_id: string;
  readonly release_id: string;
  readonly capabilities: readonly HarnessCapability[];
  readonly workflows?: readonly HarnessWorkflow[];
  readonly seed: string;
}): PlatformHarness {
  const registry = createRegistryRuntime({
    snapshot_id: input.snapshot_id,
    release_id: input.release_id,
    capabilities: input.capabilities.map((c) => ({
      artifact_id: c.artifact_id,
      artifact_type: "CAPABILITY_DEFINITION" as const,
      capability_key: c.capability_key,
      capability_version: "1.0.0",
      implementation_ref: { artifact_id: c.implementation_id },
      input_types: c.input_types ?? ["IN"],
      output_types: c.output_types ?? ["OUT"],
    })),
    workflows: (input.workflows ?? []).map((w) => ({
      artifact_id: w.artifact_id,
      artifact_type: "WORKFLOW_DEFINITION" as const,
      workflow_key: w.workflow_key,
      workflow_version: "1.0.0",
      steps: w.steps.map((s) => ({
        step_id: s.step_id,
        ...(s.capability_id
          ? { capability_ref: { artifact_id: s.capability_id } }
          : {}),
        ...(s.workflow_id
          ? { workflow_ref: { artifact_id: s.workflow_id } }
          : {}),
        ...(s.parallel_group ? { parallel_group: s.parallel_group } : {}),
      })),
    })),
  });

  const handlers = new Map(
    input.capabilities.map((c) => [c.implementation_id, c.handler] as const),
  );
  const capabilityRuntime = CapabilityRuntime.create({ registry, handlers });
  const workflowRuntime = WorkflowRuntime.create({
    registry,
    capabilityRuntime,
  });

  const security = SecurityRuntime.create({
    bootstrapAdmit: true,
    bindSeed: input.seed,
    grants: input.capabilities.map((c) => ({
      principal_id: HARNESS_PRINCIPAL,
      capability_id: c.artifact_id,
    })),
  });
  security.bindPrincipal(HARNESS_PRINCIPAL);

  const repo = new CasBackedArtifactRepository(new MemoryByteStorageBackend());
  const executor: CapabilityExecutorPort =
    security.asAuthorizedExecutorPort(capabilityRuntime.asExecutorPort());

  const kernel = new ExecutionKernel({
    admission: security.asAdmissionPort(),
    capabilityExecutor: executor,
    artifactRepository: repo,
    replayEngine: new DefaultReplayEngine(repo),
    registrySnapshot: registry.toSnapshotView(),
    nowIso: () => input.seed,
  });

  return {
    registry,
    capabilityRuntime,
    workflowRuntime,
    security,
    repo,
    kernel,
  };
}

export function buildManifest(input: {
  readonly manifest_id: string;
  readonly capability_id: string;
  readonly seed: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}): FrozenExecutionManifestIdentity {
  return {
    manifest_id: input.manifest_id,
    artifact_type: "execution_manifest",
    execution_identity_ref: {
      artifact_id: `id-${input.manifest_id}`,
      artifact_type: "execution_identity",
    },
    capability_resolution_ref: {
      artifact_id: input.capability_id,
      artifact_type: "CAPABILITY_DEFINITION",
    },
    parameters: {
      deterministic_seed: input.seed,
      ...(input.parameters ?? {}),
    },
    content_hash: sha256ContentHash({
      manifest_id: input.manifest_id,
      capability_id: input.capability_id,
      seed: input.seed,
      parameters: input.parameters ?? {},
    }),
  };
}

export async function runCapabilityOnce(
  harness: PlatformHarness,
  manifest: FrozenExecutionManifestIdentity,
) {
  await harness.repo.put({
    artifact_id: manifest.manifest_id,
    content_hash: manifest.content_hash,
    body: manifest,
  });
  const result = await harness.kernel.execute(manifest);
  const obs = ObservabilityRuntime.create().collectFromRuntimeState({
    state: result.state,
    outcome_ref: result.outcome
      ? {
          artifact_id: result.outcome.outcome_id,
          artifact_type: "execution_outcome",
        }
      : null,
    capability_execution_refs: result.capability_executions.map((e) => ({
      artifact_id: e.artifact_id,
      artifact_type: "CAPABILITY_EXECUTION",
    })),
  });
  return { result, obs };
}

export async function runWorkflowOnce(
  harness: PlatformHarness,
  workflow_id: string,
  input_refs: readonly { artifact_id: string; artifact_type: string }[] = [],
) {
  const state = createEmptyRuntimeState();
  state.registry_snapshot = harness.registry.toSnapshotView();
  const execution = await harness.workflowRuntime.execute({
    workflow_definition_ref: {
      artifact_id: workflow_id,
      artifact_type: "WORKFLOW_DEFINITION",
    },
    input_refs,
    state,
  });
  return { execution, state };
}

export { sha256ContentHash };
