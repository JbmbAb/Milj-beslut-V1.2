/**
 * Vite-klientstub för `server/utils/circuitBreaker` (ingen `server/logger`-kedja).
 * Samma beteende som servervarianten; används bara så länge `services/geminiService`
 * bundlas i webben — serverGenerateText stänger körningen innan nätanrop.
 */

export type CircuitBreakerOptions = {
  name?: string;
  failureThreshold: number;
  resetTimeoutMs?: number;
  recoveryTimeoutMs?: number;
};

type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

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
      const o: Omit<CircuitBreakerOptions, 'name'> = maybeOpts ?? { failureThreshold: 5 };
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

  fire<T>(action: () => Promise<T>): Promise<T> {
    return this.execute(action);
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.state === 'OPEN') {
      if (this.openedAt != null && now - this.openedAt >= this.recoveryTimeoutMs) {
        this.state = 'HALF_OPEN';
         
        console.info(`[CircuitBreaker ${this.name}] OPEN → HALF_OPEN (probe)`);
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
         
        console.warn(`[CircuitBreaker ${this.name}] OPEN after failure`, errMsg);
      }
      throw error;
    }
  }
}
