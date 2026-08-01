import { describe, expect, it } from "vitest";
import {
  TelemetryEngine,
  TelemetryMiddleware,
  ObservationContextBuilder,
  TelemetrySpan,
  TelemetryMetric,
  TelemetryLog,
} from "../index";
import type { UniqueIdGenerator } from "@miljobeslut/mps-core";

class MockExporter {
  readonly spans: TelemetrySpan[] = [];
  readonly metrics: TelemetryMetric[] = [];
  readonly logs: TelemetryLog[] = [];

  async exportSpan(span: TelemetrySpan): Promise<void> {
    this.spans.push(span);
  }

  async exportMetric(metric: TelemetryMetric): Promise<void> {
    this.metrics.push(metric);
  }

  async exportLog(log: TelemetryLog): Promise<void> {
    this.logs.push(log);
  }
}

describe("TelemetryEngine Suite", () => {
  it("should record metrics, logs and spans correctly", async () => {
    const exporter = new MockExporter();
    const idGen: UniqueIdGenerator = { generate: () => "span-abc" };
    const engine = new TelemetryEngine(exporter, idGen);

    const builder = new ObservationContextBuilder({
      runtime_id: "run-111",
      registry_snapshot_id: "snap-222",
      registry_hash: "hash-333",
      pipeline_version: "v1.0.0",
    });

    const ctx = builder.forStage("GOVERNANCE", "art-gov");

    await engine.recordMetric("test_metric", 42, { environment: "test" });
    await engine.recordLog("INFO", "Executing stage", ctx);

    expect(exporter.metrics).toHaveLength(1);
    expect(exporter.metrics[0].name).toBe("test_metric");
    expect(exporter.metrics[0].value).toBe(42);

    expect(exporter.logs).toHaveLength(1);
    expect(exporter.logs[0].message).toBe("Executing stage");
    expect(exporter.logs[0].context.stage).toBe("GOVERNANCE");
  });

  it("should measure performance and export span through middleware", async () => {
    const exporter = new MockExporter();
    const idGen: UniqueIdGenerator = { generate: () => "span-id-123" };
    const engine = new TelemetryEngine(exporter, idGen);
    const middleware = new TelemetryMiddleware(engine);

    const builder = new ObservationContextBuilder({
      runtime_id: "run-111",
      registry_snapshot_id: "snap-222",
      registry_hash: "hash-333",
      pipeline_version: "v1.0.0",
    });

    const ctx = builder.baseContext();

    const result = await middleware.withSpan("stage-exec", ctx, async () => {
      return "done";
    });

    expect(result).toBe("done");
    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0].name).toBe("stage-exec");
    expect(exporter.spans[0].span_id).toBe("span-id-123");
    expect(exporter.spans[0].duration_ms).toBeDefined();
  });
});
