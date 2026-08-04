import { RuleRegistrySnapshot } from "./RuleRegistrySnapshot";

export interface ValidationProfile {
  readonly profile_id: string;
  readonly version: string;
  readonly registry: RuleRegistrySnapshot;
  readonly rule_ids: readonly string[];
}
