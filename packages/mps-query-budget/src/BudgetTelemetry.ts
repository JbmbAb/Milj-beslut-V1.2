/**
 * BudgetTelemetry — soft-first events (MIMER-BUD-I03).
 * No blocking. Telemetry + decision log only.
 */

export type BudgetTelemetryEventType =
  | "QUERY_BUDGET_ESTIMATED"
  | "QUERY_BUDGET_WARNING"
  | "QUERY_BUDGET_EXCEEDED"
  | "QUERY_BUDGET_OVERRIDE";

export type BudgetTelemetryEvent = {
  readonly type: BudgetTelemetryEventType;
  readonly estimated_cost: number;
  readonly soft_limit: number;
  readonly hard_observe_limit: number;
  readonly policy_version: string;
  readonly detail?: string;
};

export type BudgetTelemetrySink = {
  emit(event: BudgetTelemetryEvent): void;
};

export class InMemoryBudgetTelemetry implements BudgetTelemetrySink {
  readonly events: BudgetTelemetryEvent[] = [];

  emit(event: BudgetTelemetryEvent): void {
    this.events.push(Object.freeze({ ...event }));
  }

  clear(): void {
    this.events.length = 0;
  }

  ofType(type: BudgetTelemetryEventType): readonly BudgetTelemetryEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}
