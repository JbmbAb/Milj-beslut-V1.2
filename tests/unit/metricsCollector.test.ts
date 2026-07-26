import { describe, expect, it } from 'vitest';
import { MetricsCollector } from '../../server/lib/metricsCollector';

describe('MetricsCollector', () => {
  it('records elapsed ms on stop', () => {
    const metrics = new MetricsCollector();
    metrics.start('exact');
    metrics.stop('exact');
    const exported = metrics.export();
    expect(typeof exported.exactMs).toBe('number');
    expect(exported.exactMs).toBeGreaterThanOrEqual(0);
  });

  it('ignores stop when start was not called', () => {
    const metrics = new MetricsCollector();
    metrics.stop('missing');
    expect(metrics.export()).toEqual({});
  });

  it('supports inc and set', () => {
    const metrics = new MetricsCollector();
    metrics.inc('hits', 2);
    metrics.inc('hits');
    metrics.set('engine', 'gemini');
    expect(metrics.export()).toEqual({ hits: 3, engine: 'gemini' });
  });

  it('export returns a shallow copy', () => {
    const metrics = new MetricsCollector();
    metrics.set('count', 1);
    const first = metrics.export();
    first.count = 99;
    expect(metrics.export().count).toBe(1);
  });
});
