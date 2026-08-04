import { ValidationProfileSnapshot } from "../conformance/ValidationProfileSnapshot";
import { ValidationProfileBuilder } from "../conformance/ValidationProfileBuilder";
import { RuleRegistrySnapshot } from "../conformance/RuleRegistrySnapshot";

/**
 * PACKAGE24-CAPABILITY-v1
 *
 * Capability invariants for ADR-24-26.
 */
export function createPackage24CapabilityProfile(
  registry: RuleRegistrySnapshot
): ValidationProfileSnapshot {
  const builder = new ValidationProfileBuilder();

  builder.setIdentity("PACKAGE24-CAPABILITY", "v1");
  builder.bindRegistry(registry);

  builder.addRule("CAP-26-I1");
  builder.addRule("CAP-26-I2");
  builder.addRule("CAP-26-I3");
  builder.addRule("CAP-26-I5");

  return builder.freeze();
}
