import { createHash } from "node:crypto";
import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { RegistrySnapshotView } from "../kernel/RuntimeState.js";
import type {
  CapabilityRegistryEntry,
  ProviderRegistryEntry,
  RegistryReleaseSnapshot,
  RegistrySeedInput,
  RuleRegistryEntry,
  WorkflowRegistryEntry,
} from "./RegistryContracts.js";

function sha256ContentHash(payload: unknown): ContentHash {
  return {
    algorithm: "sha256",
    value: createHash("sha256")
      .update(Buffer.from(JSON.stringify(payload), "utf8"))
      .digest("hex"),
  };
}

/**
 * Sole runtime resolve surface for Execution Platform.
 * Returns registry metadata / refs only — never concrete implementations.
 */
export interface RegistryRuntime {
  getReleaseSnapshot(): RegistryReleaseSnapshot;
  resolveCapabilityByKey(key: string): CapabilityRegistryEntry | null;
  resolveCapabilityByRef(artifact_id: string): CapabilityRegistryEntry | null;
  resolveWorkflowByKey(key: string): WorkflowRegistryEntry | null;
  resolveWorkflowByRef(artifact_id: string): WorkflowRegistryEntry | null;
  resolveRuleByKey(key: string): RuleRegistryEntry | null;
  resolveProviderByKey(key: string): ProviderRegistryEntry | null;
  toSnapshotView(): RegistrySnapshotView;
}

class InMemoryRegistryRuntime implements RegistryRuntime {
  private readonly snapshot: RegistryReleaseSnapshot;
  private readonly capabilitiesByKey: ReadonlyMap<string, CapabilityRegistryEntry>;
  private readonly capabilitiesById: ReadonlyMap<string, CapabilityRegistryEntry>;
  private readonly workflowsByKey: ReadonlyMap<string, WorkflowRegistryEntry>;
  private readonly workflowsById: ReadonlyMap<string, WorkflowRegistryEntry>;
  private readonly rulesByKey: ReadonlyMap<string, RuleRegistryEntry>;
  private readonly providersByKey: ReadonlyMap<string, ProviderRegistryEntry>;

  constructor(snapshot: RegistryReleaseSnapshot) {
    this.snapshot = Object.freeze(snapshot);
    this.capabilitiesByKey = new Map(
      snapshot.capabilities.map((c) => [c.capability_key, c]),
    );
    this.capabilitiesById = new Map(
      snapshot.capabilities.map((c) => [c.artifact_id, c]),
    );
    this.workflowsByKey = new Map(
      snapshot.workflows.map((w) => [w.workflow_key, w]),
    );
    this.workflowsById = new Map(
      snapshot.workflows.map((w) => [w.artifact_id, w]),
    );
    this.rulesByKey = new Map(snapshot.rules.map((r) => [r.rule_key, r]));
    this.providersByKey = new Map(
      snapshot.providers.map((p) => [p.provider_key, p]),
    );
  }

  getReleaseSnapshot(): RegistryReleaseSnapshot {
    return this.snapshot;
  }

  resolveCapabilityByKey(key: string): CapabilityRegistryEntry | null {
    return this.capabilitiesByKey.get(key) ?? null;
  }

  resolveCapabilityByRef(artifact_id: string): CapabilityRegistryEntry | null {
    return this.capabilitiesById.get(artifact_id) ?? null;
  }

  resolveWorkflowByKey(key: string): WorkflowRegistryEntry | null {
    return this.workflowsByKey.get(key) ?? null;
  }

  resolveWorkflowByRef(artifact_id: string): WorkflowRegistryEntry | null {
    return this.workflowsById.get(artifact_id) ?? null;
  }

  resolveRuleByKey(key: string): RuleRegistryEntry | null {
    return this.rulesByKey.get(key) ?? null;
  }

  resolveProviderByKey(key: string): ProviderRegistryEntry | null {
    return this.providersByKey.get(key) ?? null;
  }

  toSnapshotView(): RegistrySnapshotView {
    return {
      snapshot_id: this.snapshot.snapshot_id,
      registry_hash: this.snapshot.registry_hash.value,
    };
  }
}

/**
 * Build an immutable RegistryRuntime from a release seed.
 * Fail-closed on duplicate keys / empty capability set.
 */
export function createRegistryRuntime(seed: RegistrySeedInput): RegistryRuntime {
  const capabilities = Object.freeze([...seed.capabilities]);
  const workflows = Object.freeze([...seed.workflows]);
  const rules = Object.freeze([...(seed.rules ?? [])]);
  const providers = Object.freeze([...(seed.providers ?? [])]);

  if (capabilities.length === 0) {
    throw new Error("RegistryRuntime: release must register at least one capability");
  }

  assertUniqueKeys(
    capabilities.map((c) => c.capability_key),
    "capability_key",
  );
  assertUniqueKeys(
    capabilities.map((c) => c.artifact_id),
    "capability artifact_id",
  );
  assertUniqueKeys(
    workflows.map((w) => w.workflow_key),
    "workflow_key",
  );
  assertUniqueKeys(
    rules.map((r) => r.rule_key),
    "rule_key",
  );
  assertUniqueKeys(
    providers.map((p) => p.provider_key),
    "provider_key",
  );

  const registry_hash = sha256ContentHash({
    capabilities: capabilities.map((c) => c.artifact_id),
    workflows: workflows.map((w) => w.artifact_id),
    rules: rules.map((r) => r.artifact_id),
    providers: providers.map((p) => p.artifact_id),
  });

  const release = Object.freeze({
    release_id: seed.release_id,
    snapshot_id: seed.snapshot_id,
    registry_hash,
    capability_ids: Object.freeze(capabilities.map((c) => c.artifact_id)),
    workflow_ids: Object.freeze(workflows.map((w) => w.artifact_id)),
    rule_ids: Object.freeze(rules.map((r) => r.artifact_id)),
    provider_ids: Object.freeze(providers.map((p) => p.artifact_id)),
  });

  const content_hash = sha256ContentHash({
    release,
    capabilities,
    workflows,
    rules,
    providers,
  });

  const snapshot: RegistryReleaseSnapshot = Object.freeze({
    snapshot_id: seed.snapshot_id,
    registry_hash,
    content_hash,
    release,
    capabilities,
    workflows,
    rules,
    providers,
  });

  return new InMemoryRegistryRuntime(snapshot);
}

function assertUniqueKeys(keys: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(`RegistryRuntime: duplicate ${label}: ${key}`);
    }
    seen.add(key);
  }
}
