import type { MetricAttributes, MetricsCollector } from './MetricsCollector';
import { MIMERS_METRICS } from './contract';

type OtelMeter = {
  createCounter?(name: string, opts?: { description?: string }): { add(value: number, attrs?: object): void };
  createHistogram?(name: string, opts?: { description?: string }): { record(value: number, attrs?: object): void };
  createObservableGauge?(
    name: string,
    opts?: { description?: string },
  ): { addCallback(cb: (obs: { observe(value: number, attrs?: object): void }) => void): void };
};

/**
 * Thin OpenTelemetry adapter (P2D). No-ops when meter is missing.
 * Uses ObservableGauge for gauges — not UpDownCounter.
 */
export class OpenTelemetryMetricsAdapter implements MetricsCollector {
  private readonly counters = new Map<string, { add(value: number, attrs?: object): void }>();
  private readonly histograms = new Map<string, { record(value: number, attrs?: object): void }>();

  constructor(private readonly otelMeter?: OtelMeter | null) {}

  inc(name: string, value = 1, attributes?: MetricAttributes): void {
    if (!this.otelMeter?.createCounter) return;
    let counter = this.counters.get(name);
    if (!counter) {
      counter = this.otelMeter.createCounter(name, { description: `Mimers: ${name}` });
      this.counters.set(name, counter);
    }
    counter.add(value, attributes as object | undefined);
  }

  gauge(name: string, value: number, attributes?: MetricAttributes): void {
    if (!this.otelMeter?.createObservableGauge) return;
    // ObservableGauge: register a one-shot observation callback for the latest value.
    const gauge = this.otelMeter.createObservableGauge(name, { description: `Mimers gauge: ${name}` });
    gauge.addCallback((obs) => {
      obs.observe(value, attributes as object | undefined);
    });
  }

  recordHistogram(name: string, value: number, attributes?: MetricAttributes): void {
    if (!this.otelMeter?.createHistogram) return;
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = this.otelMeter.createHistogram(name, { description: `Mimers: ${name}` });
      this.histograms.set(name, histogram);
    }
    histogram.record(value, attributes as object | undefined);
  }
}

/** Helper to record a timed operation against the stable metrics contract. */
export async function withMetricDuration<T>(
  metrics: MetricsCollector,
  name: (typeof MIMERS_METRICS)[keyof typeof MIMERS_METRICS],
  fn: () => Promise<T>,
  attributes?: MetricAttributes,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    metrics.recordHistogram(name, performance.now() - start, attributes);
  }
}
