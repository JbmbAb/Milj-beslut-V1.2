import { ValidationProfileSnapshot } from "./ValidationProfileSnapshot";
import { RuleRegistrySnapshot } from "./RuleRegistrySnapshot";
import { ComplianceError } from "../errors/ComplianceError";

export class ValidationProfileBuilder {
  private profile_id?: string;
  private version?: string;
  private rule_ids: string[] = [];
  private registry?: RuleRegistrySnapshot;

  setIdentity(profile_id: string, version: string): void {
    this.profile_id = profile_id;
    this.version = version;
  }

  bindRegistry(registry: RuleRegistrySnapshot): void {
    this.registry = registry;
  }

  addRule(rule_id: string): void {
    this.rule_ids.push(rule_id);
  }

  freeze(): ValidationProfileSnapshot {
    if (!this.profile_id || !this.version) {
      throw new ComplianceError(
        "PROFILE_IDENTITY_REQUIRED",
        "Validation profile requires identity"
      );
    }

    if (!this.registry) {
      throw new ComplianceError(
        "PROFILE_REGISTRY_REQUIRED",
        "Validation profile requires registry snapshot"
      );
    }

    return new ValidationProfileSnapshot(
      this.profile_id,
      this.version,
      this.registry,
      this.rule_ids
    );
  }
}
