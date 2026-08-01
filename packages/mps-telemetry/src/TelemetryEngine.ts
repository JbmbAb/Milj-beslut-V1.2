import type { ObservationContext, TelemetrySpan, TelemetryMetric, TelemetryLog } from "./TelemetryTypes";
import type { TelemetryExporter } from "./TelemetryExporter";
import type { UniqueIdGenerator } from "@miljobeslut/mps-core";

export class TelemetryEngine {
  constructor(
    private readonly exporter: TelemetryExporter,
    private readonly idGen: UniqueIdGenerator,
  ) {}

  async recordSpan(
    name: string,
    context: ObservationContext,
    start: Date,
    end: Date,
    parentSpanId?: string,
    traceId?: string,
  ): Promise<void> {
    const duration_ms = end.getTime() - start.getTime();

    const span: TelemetrySpan = {
      trace_id: traceId ?? context.runtime_id,
      span_id: this.idGen.generate(),
      parent_span_id: parentSpanId,

      name,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      duration_ms,

      context,
    };

    try {
      await this.exporter.exportSpan(span);
    } catch {
      // Telemetry får aldrig bryta runtime
    }
  }

  async recordMetric(
    name: string,
    value: number,
    labels: Record<string, string>
  ): Promise<void> {
    const metric: TelemetryMetric = { name, value, labels };

    try {
      await this.exporter.exportMetric(metric);
    } catch {
      // Best effort
    }
  }

  async recordLog(
    level: TelemetryLog["level"],
    message: string,
    context: ObservationContext
  ): Promise<void> {
    const log: TelemetryLog = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
    };

    try {
      await this.exporter.exportLog(log);
    } catch {
      // Best effort
    }
  }
}
