export interface MetricAttributes {
  readonly operation?: 'put' | 'get' | 'exists' | 'audit';
  readonly result?: 'success' | 'exists' | 'miss' | 'error' | 'collision' | 'fsync_failure';
  readonly algorithm?: 'sha256' | 'sha512';
}

export interface MetricsCollector {
  inc(name: string, value?: number, attributes?: MetricAttributes): void;
  gauge(name: string, value: number, attributes?: MetricAttributes): void;
  recordHistogram(name: string, value: number, attributes?: MetricAttributes): void;
}

export class InMemoryMetrics implements MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private timings = new Map<string, { count: number; sumMs: number; minMs: number; maxMs: number }>();

  private serializeKey(name: string, attr?: MetricAttributes): string {
    if (!attr) return name;
    return `${name}{op:${attr.operation || ''},res:${attr.result || ''},algo:${attr.algorithm || ''}}`;
  }

  inc(name: string, value = 1, attributes?: MetricAttributes): void {
    const key = this.serializeKey(name, attributes);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  gauge(name: string, value: number, attributes?: MetricAttributes): void {
    this.gauges.set(this.serializeKey(name, attributes), value);
  }

  recordHistogram(name: string, value: number, attributes?: MetricAttributes): void {
    const key = this.serializeKey(name, attributes);
    const existing = this.timings.get(key);
    if (!existing) {
      this.timings.set(key, { count: 1, sumMs: value, minMs: value, maxMs: value });
    } else {
      this.timings.set(key, {
        count: existing.count + 1,
        sumMs: existing.sumMs + value,
        minMs: Math.min(existing.minMs, value),
        maxMs: Math.max(existing.maxMs, value),
      });
    }
  }

  getCounter(name: string, attributes?: MetricAttributes): number {
    return this.counters.get(this.serializeKey(name, attributes)) || 0;
  }

  getHistogram(name: string, attributes?: MetricAttributes) {
    return this.timings.get(this.serializeKey(name, attributes));
  }
}
