import { ValidationProfileSnapshot } from "../conformance/ValidationProfileSnapshot";
import { ValidationProfileBuilder } from "../conformance/ValidationProfileBuilder";
import { RuleRegistrySnapshot } from "../conformance/RuleRegistrySnapshot";

export function createPackage24ActorTrustProfile(
  registry: RuleRegistrySnapshot
): ValidationProfileSnapshot {
  const builder = new ValidationProfileBuilder();

  builder.setIdentity("PACKAGE24-ACTOR-TRUST", "v1");
  builder.bindRegistry(registry);

  builder.addRule("ACT-21-I1");
  builder.addRule("ACT-21-I3");
  builder.addRule("ACT-21-I5");

  return builder.freeze();
}
