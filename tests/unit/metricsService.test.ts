import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectCount: vi.fn(),
  documentRecordCount: vi.fn(),
  userCount: vi.fn(),
  organisationCount: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: { count: mocks.projectCount },
    documentRecord: { count: mocks.documentRecordCount },
    user: { count: mocks.userCount },
    organisation: { count: mocks.organisationCount },
  },
}));

describe('metricsService', () => {
  // Fresh module instance per test to reset in-process counters and histograms
  let recordRequest: (method: string, route: string, statusCode: number, durationMs: number) => void;
  let recordDbQuery: (operation: string, durationMs: number, failed?: boolean) => void;
  let recordError: (type: string) => void;
  let getMetricsText: () => Promise<string>;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();

    mocks.projectCount.mockResolvedValue(5);
    mocks.documentRecordCount.mockResolvedValue(20);
    mocks.userCount.mockResolvedValue(3);
    mocks.organisationCount.mockResolvedValue(2);

    const mod = await import('../../server/services/metricsService');
    recordRequest = mod.recordRequest;
    recordDbQuery = mod.recordDbQuery;
    recordError = mod.recordError;
    getMetricsText = mod.getMetricsText;
  });

  describe('recordRequest', () => {
    it('appears in http_requests_total output after being called', async () => {
      recordRequest('GET', '/api/projects', 200, 45);

      const text = await getMetricsText();

      expect(text).toContain('http_requests_total');
      expect(text).toContain('method="GET"');
      expect(text).toContain('route="/api/projects"');
      expect(text).toContain('status="200"');
    });

    it('accumulates multiple calls in the counter', async () => {
      recordRequest('GET', '/api/projects', 200, 10);
      recordRequest('GET', '/api/projects', 200, 20);

      const text = await getMetricsText();

      expect(text).toMatch(/http_requests_total\{[^}]*\} 2/);
    });

    it('tracks http request duration in summary output', async () => {
      recordRequest('POST', '/api/docs', 201, 100);

      const text = await getMetricsText();

      expect(text).toContain('http_request_duration_ms{quantile="0.5"}');
      expect(text).toContain('http_request_duration_ms_count 1');
    });
  });

  describe('recordDbQuery', () => {
    it('appears in db_queries_total output', async () => {
      recordDbQuery('findMany', 15);

      const text = await getMetricsText();

      expect(text).toContain('db_queries_total');
      expect(text).toContain('operation="findMany"');
      expect(text).toContain('failed="false"');
    });

    it('marks failed queries correctly', async () => {
      recordDbQuery('upsert', 5, true);

      const text = await getMetricsText();

      expect(text).toContain('failed="true"');
    });
  });

  describe('recordError', () => {
    it('appears in app_errors_total output', async () => {
      recordError('VALIDATION');

      const text = await getMetricsText();

      expect(text).toContain('app_errors_total');
      expect(text).toContain('type="VALIDATION"');
    });

    it('counts multiple errors of the same type', async () => {
      recordError('DB_ERROR');
      recordError('DB_ERROR');
      recordError('DB_ERROR');

      const text = await getMetricsText();

      expect(text).toMatch(/app_errors_total\{[^}]*type="DB_ERROR"[^}]*\} 3/);
    });
  });

  describe('getMetricsText', () => {
    it('always contains process uptime', async () => {
      const text = await getMetricsText();

      expect(text).toContain('process_uptime_seconds');
      expect(text).toMatch(/process_uptime_seconds \d+/);
    });

    it('always contains nodejs heap used bytes', async () => {
      const text = await getMetricsText();

      expect(text).toContain('nodejs_heap_used_bytes');
    });

    it('includes business metrics from the database', async () => {
      const text = await getMetricsText();

      expect(text).toContain('miljobeslut_projects_total 5');
      expect(text).toContain('miljobeslut_documents_total 20');
      expect(text).toContain('miljobeslut_users_total 3');
      expect(text).toContain('miljobeslut_organisations_total 2');
    });

    it('gracefully handles DB errors in business metrics', async () => {
      mocks.projectCount.mockRejectedValue(new Error('DB connection lost'));

      const text = await getMetricsText();

      expect(text).toContain('# ERROR could not collect business metrics from DB');
    });

    it('ends with a newline character', async () => {
      const text = await getMetricsText();

      expect(text.endsWith('\n')).toBe(true);
    });

    it('emits correct Prometheus HELP and TYPE headers', async () => {
      const text = await getMetricsText();

      expect(text).toContain('# HELP http_requests_total');
      expect(text).toContain('# TYPE http_requests_total counter');
      expect(text).toContain('# HELP db_queries_total Total DB queries');
      expect(text).toContain('# TYPE db_queries_total counter');
    });
  });
});
