import type { ObservationContext } from "./TelemetryTypes";
import type { TelemetryEngine } from "./TelemetryEngine";

export class TelemetryMiddleware {
  constructor(private readonly telemetry: TelemetryEngine) {}

  async withSpan<T>(
    name: string,
    context: ObservationContext,
    fn: () => Promise<T>,
    parentSpanId?: string,
    traceId?: string,
  ): Promise<T> {
    const start = new Date();

    try {
      const result = await fn();
      const end = new Date();

      await this.telemetry.recordSpan(name, context, start, end, parentSpanId, traceId);
      return result;

    } catch (err) {
      const end = new Date();

      await this.telemetry.recordSpan(`${name}.error`, context, start, end, parentSpanId, traceId);
      throw err;
    }
  }
}
