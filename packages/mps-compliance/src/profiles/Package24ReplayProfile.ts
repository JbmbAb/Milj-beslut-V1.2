import { ValidationProfileSnapshot } from "../conformance/ValidationProfileSnapshot";
import { ValidationProfileBuilder } from "../conformance/ValidationProfileBuilder";
import { RuleRegistrySnapshot } from "../conformance/RuleRegistrySnapshot";

export function createPackage24ReplayProfile(
  registry: RuleRegistrySnapshot
): ValidationProfileSnapshot {
  const builder = new ValidationProfileBuilder();

  builder.setIdentity("PACKAGE24-REPLAY", "v1");
  builder.bindRegistry(registry);

  builder.addRule("REPLAY-23-I1");
  builder.addRule("REPLAY-23-I3");
  builder.addRule("REPLAY-23-I5");

  return builder.freeze();
}
