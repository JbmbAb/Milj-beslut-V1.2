import type {
  PolicyInput,
  PolicyDecisionArtifact,
} from "./PolicyTypes";
import type { PolicyRegistry } from "./PolicyRegistry";
import type { CanonicalHashEngine, UniqueIdGenerator, DecisionClock } from "@miljobeslut/mps-core";

export interface CanonicalPolicyInputSerializer {
  serialize(input: PolicyInput): Uint8Array;
}

export interface PolicyDecisionEngine {
  evaluate(input: PolicyInput): Promise<PolicyDecisionArtifact>;
}

export class DefaultPolicyDecisionEngine implements PolicyDecisionEngine {
  constructor(
    private readonly serializer: CanonicalPolicyInputSerializer,
    private readonly hashEngine: CanonicalHashEngine,
    private readonly registry: PolicyRegistry,
    private readonly idGen: UniqueIdGenerator,
    private readonly clock: DecisionClock
  ) {}

  async evaluate(input: PolicyInput): Promise<PolicyDecisionArtifact> {
    const input_bytes = this.serializer.serialize(input);
    const input_hash = this.hashEngine.hash(input_bytes).digest;

    const activePolicy = this.registry.policy_set.policies[0];
    const policy_content = activePolicy ? this.registry.getPolicyContent(activePolicy.policy_id) : null;

    let decision: "ALLOW" | "REVIEW" | "BLOCK" = "ALLOW";
    let reason = "Default allow";

    if (!activePolicy || !policy_content) {
      decision = "REVIEW";
      reason = "No active policy found, review required.";
    }

    const decision_id = this.idGen.generate();
    const evaluated_at = this.clock.now().toISOString();

    const decisionCore = {
      decision_id,
      runtime_id: input.runtime_id,
      policy_set_id: this.registry.policy_set.policy_set_id,
      policy_set_hash: this.registry.policy_set.policy_set_hash,
      policy_id: activePolicy?.policy_id || "none",
      policy_version: activePolicy?.policy_version || "none",
      policy_hash: activePolicy?.policy_hash || "none",
      decision,
      reason,
      input_hash,
      evaluated_at,
    };

    const decision_bytes = this.serializer.serialize(decisionCore as any);
    const decision_hash = this.hashEngine.hash(decision_bytes).digest;

    return {
      ...decisionCore,
      decision_hash,
    };
  }
}
