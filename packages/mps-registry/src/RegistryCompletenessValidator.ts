import type { RegistrySnapshot } from "./RegistryTypes";

export class RegistryCompletenessValidator {
  validate(snapshot: RegistrySnapshot): void {
    if (snapshot.governance_profiles.length === 0) {
      throw new Error("Registry is incomplete: missing governance profiles");
    }
    if (snapshot.policy_sets.length === 0) {
      throw new Error("Registry is incomplete: missing policy sets");
    }
    if (snapshot.replay_profiles.length === 0) {
      throw new Error("Registry is incomplete: missing replay profiles");
    }
    if (snapshot.archive_profiles.length === 0) {
      throw new Error("Registry is incomplete: missing archive profiles");
    }
    if (snapshot.promotion_profiles.length === 0) {
      throw new Error("Registry is incomplete: missing promotion profiles");
    }
  }
}
