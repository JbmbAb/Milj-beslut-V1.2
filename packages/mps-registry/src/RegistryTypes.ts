import type {
  ContentReference,
  VerificationResult,
} from "@miljobeslut/mps-core";

export type RegistryKind =
  | "governance-profile"
  | "policy-set"
  | "replay-profile"
  | "archive-profile"
  | "promotion-profile";

export interface RegistryEntry {
  readonly reference: ContentReference;
  readonly kind: RegistryKind;
  readonly schema_version: string;
  readonly verification: VerificationResult;
}

export interface RegistrySnapshot {
  readonly snapshot_id: string;
  readonly registry_hash: string;
  readonly created_at: string;
  readonly governance_profiles: readonly RegistryEntry[];
  readonly policy_sets: readonly RegistryEntry[];
  readonly replay_profiles: readonly RegistryEntry[];
  readonly archive_profiles: readonly RegistryEntry[];
  readonly promotion_profiles: readonly RegistryEntry[];
}
