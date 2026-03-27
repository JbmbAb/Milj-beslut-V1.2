import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const prismaMocks = vi.hoisted(() => ({
  projectCount: vi.fn().mockResolvedValue(10),
  documentCount: vi.fn().mockResolvedValue(50),
  userCount: vi.fn().mockResolvedValue(5),
  orgCount: vi.fn().mockResolvedValue(2),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: { count: prismaMocks.projectCount },
    documentRecord: { count: prismaMocks.documentCount },
    user: { count: prismaMocks.userCount },
    organisation: { count: prismaMocks.orgCount },
  },
}));

// ─── Module under test ────────────────────────────────────────────────────────

// Use resetModules so each test starts with fresh in-process counters.
let svc: typeof import('../../server/services/metricsService');

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  svc = await import('../../server/services/metricsService');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('metricsService', () => {
  // ── recordRequest ──────────────────────────────────────────────────────────

  describe('recordRequest', () => {
    it('does not throw for valid inputs', () => {
      expect(() => svc.recordRequest('GET', '/api/test', 200, 100)).not.toThrow();
    });

    it('accepts any HTTP method, route and status code', () => {
      expect(() => svc.recordRequest('POST', '/api/items', 201, 45)).not.toThrow();
      expect(() => svc.recordRequest('DELETE', '/api/items/1', 404, 5)).not.toThrow();
    });
  });

  // ── recordDbQuery ──────────────────────────────────────────────────────────

  describe('recordDbQuery', () => {
    it('does not throw for normal query', () => {
      expect(() => svc.recordDbQuery('findMany', 15)).not.toThrow();
    });

    it('accepts a failed flag', () => {
      expect(() => svc.recordDbQuery('create', 200, true)).not.toThrow();
    });
  });

  // ── recordError ────────────────────────────────────────────────────────────

  describe('recordError', () => {
    it('does not throw for any error type string', () => {
      expect(() => svc.recordError('VALIDATION')).not.toThrow();
      expect(() => svc.recordError('UNHANDLED')).not.toThrow();
    });
  });

  // ── getMetricsText ─────────────────────────────────────────────────────────

  describe('getMetricsText', () => {
    it('returns a non-empty string ending with newline', async () => {
      const text = await svc.getMetricsText();
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
      expect(text.endsWith('\n')).toBe(true);
    });

    it('contains process uptime metric', async () => {
      const text = await svc.getMetricsText();
      expect(text).toContain('# HELP process_uptime_seconds');
      expect(text).toContain('# TYPE process_uptime_seconds gauge');
      expect(text).toMatch(/process_uptime_seconds \d+/);
    });

    it('contains nodejs heap metric', async () => {
      const text = await svc.getMetricsText();
      expect(text).toContain('# HELP nodejs_heap_used_bytes');
      expect(text).toContain('# TYPE nodejs_heap_used_bytes gauge');
    });

    it('includes http_requests_total counter after recordRequest', async () => {
      svc.recordRequest('GET', '/api/projects', 200, 50);
      const text = await svc.getMetricsText();
      expect(text).toContain('# HELP http_requests_total');
      expect(text).toContain('http_requests_total{');
      expect(text).toContain('method="GET"');
    });

    it('includes http_request_duration_ms summary', async () => {
      svc.recordRequest('GET', '/api/health', 200, 12);
      svc.recordRequest('POST', '/api/projects', 201, 200);
      const text = await svc.getMetricsText();
      expect(text).toContain('http_request_duration_ms{quantile="0.5"}');
      expect(text).toContain('http_request_duration_ms{quantile="0.9"}');
      expect(text).toContain('http_request_duration_ms{quantile="0.99"}');
      expect(text).toContain('http_request_duration_ms_count 2');
    });

    it('includes db_queries_total counter after recordDbQuery', async () => {
      svc.recordDbQuery('findMany', 10);
      const text = await svc.getMetricsText();
      expect(text).toContain('# HELP db_queries_total');
      expect(text).toContain('db_queries_total{');
    });

    it('includes app_errors_total counter after recordError', async () => {
      svc.recordError('VALIDATION');
      const text = await svc.getMetricsText();
      expect(text).toContain('# HELP app_errors_total');
      expect(text).toContain('app_errors_total{');
      expect(text).toContain('type="VALIDATION"');
    });

    it('includes business metrics from DB', async () => {
      const text = await svc.getMetricsText();
      expect(text).toContain('# HELP miljobeslut_projects_total');
      expect(text).toContain('miljobeslut_projects_total 10');
      expect(text).toContain('miljobeslut_documents_total 50');
      expect(text).toContain('miljobeslut_users_total 5');
      expect(text).toContain('miljobeslut_organisations_total 2');
    });

    it('emits error comment when DB is unavailable', async () => {
      prismaMocks.projectCount.mockRejectedValueOnce(new Error('DB unavailable'));
      const text = await svc.getMetricsText();
      expect(text).toContain('# ERROR could not collect business metrics from DB');
    });

    it('multiple recordRequest calls accumulate correctly', async () => {
      svc.recordRequest('GET', '/api/test', 200, 30);
      svc.recordRequest('GET', '/api/test', 200, 60);
      svc.recordRequest('GET', '/api/test', 500, 5);
      const text = await svc.getMetricsText();
      // Two 200 calls to same route
      expect(text).toContain('status="200"');
      expect(text).toContain('status="500"');
    });
  });
});
