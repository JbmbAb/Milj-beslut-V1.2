import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka beroenden HOISTED
const lantmaterietMock = vi.hoisted(() => ({
  getLantmaterietOpenMapStatus: vi.fn(),
}));
const sluMock = vi.hoisted(() => ({
  getSluProductStatus: vi.fn().mockReturnValue([]),
  pingSluProduct: vi.fn(),
}));
const openDataMock = vi.hoisted(() => ({
  fetchImmediateOpenSources: vi.fn().mockResolvedValue([]),
}));
const transportMock = vi.hoisted(() => ({
  getDispatchProviderRuntimeStatus: vi.fn().mockReturnValue({
    activeProvider: 'NONE',
    credentials: { timocomConfigured: false, transEuConfigured: false },
  }),
}));

vi.mock('../../server/services/lantmaterietService', () => lantmaterietMock);
vi.mock('../../server/services/sluService', () => sluMock);
vi.mock('../../server/services/openDataSourceService', () => openDataMock);
vi.mock('../../server/services/transportDispatchService', () => transportMock);

// Mocka env (isLantmaterietOpenMode)
vi.mock('../../server/security/env', () => ({
  isLantmaterietOpenMode: vi.fn().mockReturnValue(false),
}));

// Mocka fetch globalt
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  summarizeExternalHealthReport,
  getExternalHealthReport,
} from '../../server/services/externalHealthService';

describe('externalHealthService unit tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    openDataMock.fetchImmediateOpenSources.mockResolvedValue([]);
    lantmaterietMock.getLantmaterietOpenMapStatus.mockResolvedValue({ ok: true, endpoint: 'url' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('summarizeExternalHealthReport', () => {
    it('should mark overall status as error if any check has error', () => {
      const checks: any[] = [
        { key: 'a', status: 'healthy', category: 'C1', label: 'A', configured: true },
        { key: 'b', status: 'error', category: 'C1', label: 'B', configured: true },
      ];
      const report = summarizeExternalHealthReport(checks);
      expect(report.overall).toBe('error');
      expect(report.totals.error).toBe(1);
    });

    it('should mark overall status as degraded if no error but not_configured exists', () => {
      const checks: any[] = [
        { key: 'a', status: 'healthy', category: 'C1', label: 'A', configured: true },
        { key: 'b', status: 'not_configured', category: 'C1', label: 'B', configured: false },
      ];
      const report = summarizeExternalHealthReport(checks);
      expect(report.overall).toBe('degraded');
    });

    it('should mark overall as ok when all checks are healthy', () => {
      const checks: any[] = [
        { key: 'a', status: 'healthy', category: 'C1', label: 'A', configured: true },
        { key: 'b', status: 'healthy', category: 'C2', label: 'B', configured: true },
      ];
      const report = summarizeExternalHealthReport(checks);
      expect(report.overall).toBe('ok');
      expect(report.totals.healthy).toBe(2);
      expect(report.totals.error).toBe(0);
    });

    it('should mark overall as degraded when degraded > 0 and no error', () => {
      const checks: any[] = [
        { key: 'a', status: 'degraded', category: 'C1', label: 'A', configured: true },
        { key: 'b', status: 'healthy', category: 'C1', label: 'B', configured: true },
      ];
      const report = summarizeExternalHealthReport(checks);
      expect(report.overall).toBe('degraded');
      expect(report.totals.degraded).toBe(1);
    });

    it('should build categories map correctly', () => {
      const checks: any[] = [
        { key: 'a', status: 'healthy', category: 'AI', label: 'A', configured: true },
        { key: 'b', status: 'error', category: 'AI', label: 'B', configured: true },
        { key: 'c', status: 'healthy', category: 'GIS', label: 'C', configured: true },
      ];
      const report = summarizeExternalHealthReport(checks);
      expect(report.categories.length).toBe(2);
      const ai = report.categories.find((cat) => cat.name === 'AI');
      expect(ai?.total).toBe(2);
      expect(ai?.error).toBe(1);
    });

    it('should use provided checkedAt timestamp', () => {
      const ts = '2026-01-01T00:00:00.000Z';
      const report = summarizeExternalHealthReport([], ts);
      expect(report.checkedAt).toBe(ts);
    });
  });

  describe('getExternalHealthReport (Integration Logic)', () => {
    it('rapporterar healthy Vertex när VERTEX_PROJECT_ID är satt', async () => {
      process.env.VERTEX_PROJECT_ID = 'p1';
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{"type":"service_account","fake":true}';
      delete process.env.VISS_API_KEY;
      delete process.env.LANTMATERIET_ACCESS_TOKEN;
      delete process.env.LANTMATERIET_CONSUMER_KEY;
      delete process.env.LANTMATERIET_CONSUMER_SECRET;
      delete process.env.LANTMATERIET_API_KEY;
      delete process.env.MARKET_INTEL_ENDPOINT;

      lantmaterietMock.getLantmaterietOpenMapStatus.mockResolvedValue({ ok: true, endpoint: 'url' });

      const report = await getExternalHealthReport();
      const vertex = report.checks.find((c) => c.key === 'vertex_ai');
      expect(vertex?.status).toBe('healthy');
    });

    it('reports not_configured when VERTEX_PROJECT_ID is missing', async () => {
      delete process.env.VERTEX_PROJECT_ID;

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('error'),
      });

      const report = await getExternalHealthReport();
      const vertex = report.checks.find((c) => c.key === 'vertex_ai');
      expect(vertex?.status).toBe('not_configured');
    });
  });
});
