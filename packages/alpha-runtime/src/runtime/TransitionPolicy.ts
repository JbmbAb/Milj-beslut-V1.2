import { TransitionEvent, ExecutionState } from "./TransitionTypes";

export interface TransitionPolicy {
  evaluate(
    current: ExecutionState,
    event: TransitionEvent
  ): Promise<{ allowed: boolean; errors: string[] }>;
}
