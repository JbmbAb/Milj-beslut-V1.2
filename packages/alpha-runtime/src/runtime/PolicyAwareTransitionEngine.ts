import { TransitionEvent, ExecutionState, TransitionResult } from "./TransitionTypes";
import { TransitionPolicy } from "./TransitionPolicy";

export interface TransitionEngine {
  apply(current: ExecutionState, event: TransitionEvent): Promise<TransitionResult>;
}

export class PolicyAwareTransitionEngine implements TransitionEngine {
  constructor(private policy: TransitionPolicy) {}

  async apply(current: ExecutionState, event: TransitionEvent): Promise<TransitionResult> {
    const evaluation = await this.policy.evaluate(current, event);

    if (!evaluation.allowed) {
      return {
        allowed: false,
        new_state: current,
        provenance_operation: event.operation,
        errors: evaluation.errors
      };
    }

    return {
      allowed: true,
      new_state: {
        ...current,
        status: event.to_state
      },
      provenance_operation: event.operation,
      errors: []
    };
  }
}
