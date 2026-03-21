import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: { count: vi.fn(async () => 5) },
    document: { count: vi.fn(async () => 12) },
    searchJob: { count: vi.fn(async () => 3) },
    $queryRaw: vi.fn(async () => []),
  },
}));

import {
  recordRequest,
  recordDbQuery,
  recordError,
  getMetricsText,
} from '../../server/services/metricsService';

describe('metricsService', () => {
  it('recordRequest increments counter without throwing', () => {
    expect(() => recordRequest('GET', '/api/projects', 200, 45)).not.toThrow();
    expect(() => recordRequest('POST', '/api/documents', 201, 120)).not.toThrow();
    expect(() => recordRequest('GET', '/api/projects', 404, 10)).not.toThrow();
  });

  it('recordDbQuery increments counter without throwing', () => {
    expect(() => recordDbQuery('findMany', 25)).not.toThrow();
    expect(() => recordDbQuery('create', 80)).not.toThrow();
    expect(() => recordDbQuery('delete', 15, true)).not.toThrow();
  });

  it('recordError increments counter without throwing', () => {
    expect(() => recordError('UNHANDLED_EXCEPTION')).not.toThrow();
    expect(() => recordError('DB_CONNECTION_FAILED')).not.toThrow();
  });

  it('getMetricsText returns Prometheus-formatted text', async () => {
    recordRequest('GET', '/api/health', 200, 5);
    const text = await getMetricsText();
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    // Should contain standard Prometheus exposition format markers
    expect(text).toMatch(/# HELP|# TYPE|http_requests_total/);
  });

  it('getMetricsText includes uptime gauge', async () => {
    const text = await getMetricsText();
    expect(text).toMatch(/process_uptime_seconds/);
  });
});
