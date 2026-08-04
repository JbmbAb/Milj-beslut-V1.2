import { ValidationProfileSnapshot } from "../conformance/ValidationProfileSnapshot";
import { ValidationProfileBuilder } from "../conformance/ValidationProfileBuilder";
import { RuleRegistrySnapshot } from "../conformance/RuleRegistrySnapshot";

export function createPackage24RetentionProfile(
  registry: RuleRegistrySnapshot
): ValidationProfileSnapshot {
  const builder = new ValidationProfileBuilder();

  builder.setIdentity("PACKAGE24-RETENTION", "v1");
  builder.bindRegistry(registry);

  builder.addRule("RET-24-I1");
  builder.addRule("RET-24-I3");
  builder.addRule("RET-24-I5");

  return builder.freeze();
}
