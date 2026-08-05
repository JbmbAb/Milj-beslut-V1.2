import type { RetryDecision, RetryPolicy } from "./types.js";
import { DEFAULT_RETRY_POLICY } from "./types.js";

/**
 * Deterministic retry decisions — no I/O, no jitter.
 * `attempts_so_far` = number of failures recorded including the current one.
 */
export class RetryEngine {
  constructor(private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY) {}

  decide(input: {
    readonly attempts_so_far: number;
    readonly fail_reason: string;
  }): RetryDecision {
    if (input.attempts_so_far >= this.policy.max_attempts) {
      return {
        action: "give_up",
        attempts: input.attempts_so_far,
        reason: `max_attempts_${this.policy.max_attempts}`,
      };
    }

    const prefixes = this.policy.retryable_reason_prefixes;
    if (prefixes && prefixes.length > 0) {
      const ok = prefixes.some((p) => input.fail_reason.startsWith(p));
      if (!ok) {
        return {
          action: "give_up",
          attempts: input.attempts_so_far,
          reason: "non_retryable_reason",
        };
      }
    }

    return { action: "retry", next_attempt: input.attempts_so_far + 1 };
  }

  get delayMs(): number {
    return this.policy.delay_ms;
  }

  get maxAttempts(): number {
    return this.policy.max_attempts;
  }
}
