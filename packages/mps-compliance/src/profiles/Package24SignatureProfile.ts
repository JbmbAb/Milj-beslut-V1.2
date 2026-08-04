import { ValidationProfileSnapshot } from "../conformance/ValidationProfileSnapshot";
import { ValidationProfileBuilder } from "../conformance/ValidationProfileBuilder";
import { RuleRegistrySnapshot } from "../conformance/RuleRegistrySnapshot";

export function createPackage24SignatureProfile(
  registry: RuleRegistrySnapshot
): ValidationProfileSnapshot {
  const builder = new ValidationProfileBuilder();

  builder.setIdentity("PACKAGE24-SIGNATURE", "v1");
  builder.bindRegistry(registry);

  builder.addRule("SIG-22-I1");
  builder.addRule("SIG-22-I2");
  builder.addRule("SIG-22-I3");
  builder.addRule("SIG-22-I4");
  builder.addRule("SIG-22-I5");

  return builder.freeze();
}
