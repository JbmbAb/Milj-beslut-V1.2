import { ValidationProfileSnapshot } from "../conformance/ValidationProfileSnapshot";
import { ValidationProfileBuilder } from "../conformance/ValidationProfileBuilder";
import { RuleRegistrySnapshot } from "../conformance/RuleRegistrySnapshot";

export function createPackage24ExecutionProfile(
  registry: RuleRegistrySnapshot
): ValidationProfileSnapshot {
  const builder = new ValidationProfileBuilder();

  builder.setIdentity("PACKAGE24-EXECUTION", "v1");
  builder.bindRegistry(registry);

  builder.addRule("EXE-25-I1");
  builder.addRule("EXE-25-I3");
  builder.addRule("EXE-25-I5");
  builder.addRule("EXE-25-I7");

  return builder.freeze();
}
