import { logger } from '../logger';

export type CircuitBreakerOptions = {
  name?: string;
  failureThreshold: number;
  /** @deprecated alias for recoveryTimeoutMs */
  resetTimeoutMs?: number;
  recoveryTimeoutMs?: number;
};

type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Lightweight circuit breaker for outbound calls (e.g. Gemini).
 * States: CLOSED → OPEN after repeated failures → HALF_OPEN probe after timeout → CLOSED on success.
 */
export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private state: BreakerState = 'CLOSED';
  private failureCount = 0;
  private openedAt: number | null = null;

  constructor(nameOrOpts: string | CircuitBreakerOptions, maybeOpts?: Omit<CircuitBreakerOptions, 'name'>) {
    if (typeof nameOrOpts === 'string') {
      this.name = nameOrOpts;
      const o: Omit<CircuitBreakerOptions, 'name'> = maybeOpts ?? {
        failureThreshold: 5,
      };
      this.failureThreshold = o.failureThreshold;
      this.recoveryTimeoutMs = o.recoveryTimeoutMs ?? o.resetTimeoutMs ?? 60_000;
    } else {
      this.name = nameOrOpts.name ?? 'CircuitBreaker';
      this.failureThreshold = nameOrOpts.failureThreshold;
      this.recoveryTimeoutMs = nameOrOpts.recoveryTimeoutMs ?? nameOrOpts.resetTimeoutMs ?? 60_000;
    }
  }

  getState(): BreakerState {
    return this.state;
  }

  /** @alias execute — used by unit tests */
  fire<T>(action: () => Promise<T>): Promise<T> {
    return this.execute(action);
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.state === 'OPEN') {
      if (this.openedAt != null && now - this.openedAt >= this.recoveryTimeoutMs) {
        this.state = 'HALF_OPEN';
        logger.info(`CircuitBreaker ${this.name}: OPEN → HALF_OPEN (probe)`, {});
      } else {
        throw new Error(`${this.name} is OPEN. Request blocked`);
      }
    }

    try {
      const result = await action();
      this.failureCount = 0;
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.openedAt = null;
      }
      return result;
    } catch (error) {
      this.failureCount += 1;
      const errMsg = error instanceof Error ? error.message : String(error);
      if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = now;
        logger.warn(`CircuitBreaker ${this.name}: breaker OPEN after failure`, { errMsg });
      }
      throw error;
    }
  }
}
