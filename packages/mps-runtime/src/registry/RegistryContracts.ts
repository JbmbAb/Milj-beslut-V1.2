/**
 * Registry Runtime — sole resolve surface (Epoch II §2.3).
 * Domain-agnostic entry types; no LU / provider imports.
 */

import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";

export const REGISTRY_RUNTIME_VERSION = "1.0.0" as const;

export const REGISTRY_KIND_NAMES = [
  "CapabilityRegistry",
  "WorkflowRegistry",
  "RuleRegistry",
  "ProviderRegistry",
  "ReleaseRegistry",
] as const;

export type RegistryKind = (typeof REGISTRY_KIND_NAMES)[number];

export type ArtifactIdRef = {
  readonly artifact_id: string;
};

export type CapabilityRegistryEntry = {
  readonly artifact_id: string;
  readonly artifact_type: "CAPABILITY_DEFINITION";
  readonly capability_key: string;
  readonly capability_version: string;
  readonly implementation_ref: ArtifactIdRef;
  readonly input_types: readonly string[];
  readonly output_types: readonly string[];
};

export type WorkflowStepEntry = {
  readonly step_id: string;
  readonly capability_ref: ArtifactIdRef;
};

export type WorkflowRegistryEntry = {
  readonly artifact_id: string;
  readonly artifact_type: "WORKFLOW_DEFINITION";
  readonly workflow_key: string;
  readonly workflow_version: string;
  readonly steps: readonly WorkflowStepEntry[];
};

/** Domain / conformance rule binding — not Package24 matrix itself. */
export type RuleRegistryEntry = {
  readonly artifact_id: string;
  readonly artifact_type: "RULE_BINDING";
  readonly rule_key: string;
  readonly binding_ref: ArtifactIdRef;
};

export type ProviderKind = "spatial" | "document" | "external";

export type ProviderRegistryEntry = {
  readonly artifact_id: string;
  readonly artifact_type: "PROVIDER_BINDING";
  readonly provider_key: string;
  readonly provider_kind: ProviderKind;
  readonly implementation_ref: ArtifactIdRef;
};

/** Release-bound snapshot binding the five registries. */
export type ReleaseRegistryEntry = {
  readonly release_id: string;
  readonly snapshot_id: string;
  readonly registry_hash: ContentHash;
  readonly capability_ids: readonly string[];
  readonly workflow_ids: readonly string[];
  readonly rule_ids: readonly string[];
  readonly provider_ids: readonly string[];
};

export type RegistryReleaseSnapshot = {
  readonly snapshot_id: string;
  readonly registry_hash: ContentHash;
  readonly content_hash: ContentHash;
  readonly release: ReleaseRegistryEntry;
  readonly capabilities: readonly CapabilityRegistryEntry[];
  readonly workflows: readonly WorkflowRegistryEntry[];
  readonly rules: readonly RuleRegistryEntry[];
  readonly providers: readonly ProviderRegistryEntry[];
};

export type RegistrySeedInput = {
  readonly snapshot_id: string;
  readonly release_id: string;
  readonly capabilities: readonly CapabilityRegistryEntry[];
  readonly workflows: readonly WorkflowRegistryEntry[];
  readonly rules?: readonly RuleRegistryEntry[];
  readonly providers?: readonly ProviderRegistryEntry[];
};
