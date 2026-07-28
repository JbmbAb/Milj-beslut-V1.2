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
  let recordCacheHit: (cache?: string) => void;
  let recordCacheMiss: (cache?: string) => void;
  let recordRetrievalDuration: (durationMs: number) => void;
  let recordRerankDuration: (durationMs: number) => void;
  let recordLlmDuration: (durationMs: number) => void;
  let recordTotalDuration: (durationMs: number) => void;
  let recordRetrievedDocuments: (count: number) => void;
  let recordRerankedDocuments: (count: number) => void;
  let recordLlmTokens: (inputTokens: number, outputTokens: number, costUsd: number) => void;
  let incrementActiveRequests: () => void;
  let decrementActiveRequests: () => void;
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
    recordCacheHit = mod.recordCacheHit;
    recordCacheMiss = mod.recordCacheMiss;
    recordRetrievalDuration = mod.recordRetrievalDuration;
    recordRerankDuration = mod.recordRerankDuration;
    recordLlmDuration = mod.recordLlmDuration;
    recordTotalDuration = mod.recordTotalDuration;
    recordRetrievedDocuments = mod.recordRetrievedDocuments;
    recordRerankedDocuments = mod.recordRerankedDocuments;
    recordLlmTokens = mod.recordLlmTokens;
    incrementActiveRequests = mod.incrementActiveRequests;
    decrementActiveRequests = mod.decrementActiveRequests;
    getMetricsText = mod.getMetricsText;
  });

  describe('recordRequest', () => {
    it('appears in http_requests_total and request_total output after being called', async () => {
      recordRequest('GET', '/api/projects', 200, 45);

      const text = await getMetricsText();

      expect(text).toContain('http_requests_total');
      expect(text).toContain('request_total');
      expect(text).toContain('method="GET"');
      expect(text).toContain('route="/api/projects"');
      expect(text).toContain('status="200"');
    });

    it('accumulates multiple calls in the counter', async () => {
      recordRequest('GET', '/api/projects', 200, 10);
      recordRequest('GET', '/api/projects', 200, 20);

      const text = await getMetricsText();

      expect(text).toMatch(/request_total\{[^}]*\} 2/);
    });

    it('tracks http request duration in summary output', async () => {
      recordRequest('POST', '/api/docs', 201, 100);

      const text = await getMetricsText();

      expect(text).toContain('http_request_duration_ms{quantile="0.5"}');
      expect(text).toContain('http_request_duration_ms_count 1');
    });
  });

  describe('recordDbQuery', () => {
    it('appears in db_queries_total and db_query_total output', async () => {
      recordDbQuery('findMany', 15);

      const text = await getMetricsText();

      expect(text).toContain('db_queries_total');
      expect(text).toContain('db_query_total');
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
    it('appears in app_errors_total and error_total output', async () => {
      recordError('VALIDATION');

      const text = await getMetricsText();

      expect(text).toContain('app_errors_total');
      expect(text).toContain('error_total');
      expect(text).toContain('type="VALIDATION"');
    });

    it('counts multiple errors of the same type', async () => {
      recordError('DB_ERROR');
      recordError('DB_ERROR');
      recordError('DB_ERROR');

      const text = await getMetricsText();

      expect(text).toMatch(/error_total\{[^}]*type="DB_ERROR"[^}]*\} 3/);
    });
  });

  describe('Cache Metrics', () => {
    it('tracks hits and misses with cache labels', async () => {
      recordCacheHit('legal-docs');
      recordCacheMiss('legal-docs');
      recordCacheMiss('legal-docs');

      const text = await getMetricsText();

      expect(text).toContain('cache_hits_total{cache="legal-docs"} 1');
      expect(text).toContain('cache_misses_total{cache="legal-docs"} 2');
    });
  });

  describe('Duration Histograms', () => {
    it('registers and percentilizes durations', async () => {
      recordRetrievalDuration(120);
      recordRerankDuration(45);
      recordLlmDuration(500);
      recordTotalDuration(850);

      const text = await getMetricsText();

      expect(text).toContain('retrieval_duration_ms{quantile="0.5"} 120');
      expect(text).toContain('rerank_duration_ms{quantile="0.5"} 45');
      expect(text).toContain('llm_duration_ms{quantile="0.5"} 500');
      expect(text).toContain('total_duration_ms{quantile="0.5"} 850');
    });
  });

  describe('Document and LLM Metrics', () => {
    it('tracks documents, tokens and costs correctly', async () => {
      recordRetrievedDocuments(12);
      recordRerankedDocuments(5);
      recordLlmTokens(1000, 250, 0.015);

      const text = await getMetricsText();

      expect(text).toContain('retrieved_documents 12');
      expect(text).toContain('reranked_documents 5');
      expect(text).toContain('input_tokens 1000');
      expect(text).toContain('output_tokens 250');
      expect(text).toContain('cost_usd 0.015');
    });
  });

  describe('Active Requests Gauge', () => {
    it('tracks concurrent requests up and down', async () => {
      incrementActiveRequests();
      incrementActiveRequests();
      expect(await getMetricsText()).toContain('active_requests 2');

      decrementActiveRequests();
      expect(await getMetricsText()).toContain('active_requests 1');
    });
  });

  describe('getMetricsText', () => {
    it('always contains process uptime', async () => {
      const text = await getMetricsText();

      expect(text).toContain('process_uptime_seconds');
      expect(text).toMatch(/process_uptime_seconds \d+/);
    });

    it('always contains V8 heap usage bytes', async () => {
      const text = await getMetricsText();

      expect(text).toContain('node_heap_used_bytes');
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

      expect(text).toContain('# HELP request_total');
      expect(text).toContain('# TYPE request_total counter');
      expect(text).toContain('# HELP db_query_total');
      expect(text).toContain('# TYPE db_query_total counter');
      expect(text).toContain('# HELP active_requests');
      expect(text).toContain('# TYPE active_requests gauge');
    });
  });
});
