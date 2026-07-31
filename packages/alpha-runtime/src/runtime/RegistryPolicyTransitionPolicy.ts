import { TransitionPolicy } from "./TransitionPolicy";
import { RegistryResolver } from "../registry/RegistryResolver";
import { TransitionEvent, ExecutionState } from "./TransitionTypes";

export class RegistryPolicyTransitionPolicy implements TransitionPolicy {
  constructor(private resolver: RegistryResolver) {}

  async evaluate(current: ExecutionState, event: TransitionEvent) {
    if (!event.policy_ref) {
      return {
        allowed: false,
        errors: ["missing_transition_policy"]
      };
    }

    const policy = await this.resolver.resolve(event.policy_ref);

    const artifact = policy.payload as any;
    const rules = artifact.rules ?? artifact.criteria ?? [];

    const errors: string[] = [];

    for (const rule of rules) {
      // placeholder for real rule evaluation
    }

    return {
      allowed: errors.length === 0,
      errors
    };
  }
}
