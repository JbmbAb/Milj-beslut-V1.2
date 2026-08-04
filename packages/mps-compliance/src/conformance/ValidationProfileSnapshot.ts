import { RuleRegistrySnapshot } from "./RuleRegistrySnapshot";
import { ValidationProfile } from "./ValidationProfile";

export class ValidationProfileSnapshot implements ValidationProfile {
  readonly profile_id: string;
  readonly version: string;
  readonly registry: RuleRegistrySnapshot;
  readonly rule_ids: readonly string[];

  constructor(
    profile_id: string,
    version: string,
    registry: RuleRegistrySnapshot,
    rule_ids: readonly string[]
  ) {
    this.profile_id = profile_id;
    this.version = version;
    this.registry = registry;
    this.rule_ids = Object.freeze([...rule_ids]);
  }
}
