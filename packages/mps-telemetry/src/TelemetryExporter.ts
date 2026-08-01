import type { TelemetrySpan, TelemetryMetric, TelemetryLog } from "./TelemetryTypes";

export interface TelemetryExporter {
  exportSpan(span: TelemetrySpan): Promise<void>;
  exportMetric(metric: TelemetryMetric): Promise<void>;
  exportLog(log: TelemetryLog): Promise<void>;
}
