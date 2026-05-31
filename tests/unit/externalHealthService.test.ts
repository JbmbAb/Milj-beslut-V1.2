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

    it('reports healthy live/config checks when integrations are configured', async () => {
      process.env.VERTEX_PROJECT_ID = 'p1';
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{"type":"service_account","fake":true}';
      process.env.VISS_API_KEY = 'viss-key';
      process.env.VISS_API_BASE_URL = 'https://viss.test/api';
      process.env.LANTMATERIET_CONSUMER_KEY = 'lm-key';
      process.env.LANTMATERIET_CONSUMER_SECRET = 'lm-secret';
      process.env.LANTMATERIET_LOOKUP_MODE = 'ogc';
      process.env.LANTMATERIET_BASE_URL = 'https://lm.test/ogc-features/v1';
      process.env.MARKET_INTEL_ENDPOINT = 'https://market.test/health';
      process.env.BANKID_PFX_PATH = 'bankid.pfx';
      process.env.BANKID_BASE_URL = 'https://bankid.test/rp/v6.0';
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://authority.test/submit';
      process.env.AUTHORITY_API_KEY = 'authority-key';
      process.env.EIDAS_QTSP_ENDPOINT = 'https://qtsp.test';
      process.env.EIDAS_QTSP_API_KEY = 'qtsp-key';
      process.env.LIMS_API_ENDPOINT = 'https://lims.test';
      process.env.LIMS_API_KEY = 'lims-key';
      process.env.OCR_API_KEY = 'ocr-key';

      sluMock.getSluProductStatus.mockReturnValue([
        { product: 'artdata', hasApiKey: true, hasBasePath: true },
      ]);
      sluMock.pingSluProduct.mockResolvedValue({
        ok: true,
        status: 200,
        endpoint: 'https://slu.test/ping',
      });
      transportMock.getDispatchProviderRuntimeStatus.mockReturnValue({
        activeProvider: 'TIMOCOM',
        credentials: { timocomConfigured: true, transEuConfigured: true },
      });
      openDataMock.fetchImmediateOpenSources.mockResolvedValue([
        { source: 'naturvardsverket', ok: true, status: 200, endpoint: 'https://nv.test', details: 'ok' },
      ]);
      lantmaterietMock.getLantmaterietOpenMapStatus.mockResolvedValue({
        ok: true,
        status: 200,
        endpoint: 'https://lm.test/open',
        mode: 'open',
      });
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ NearbyWaters: [{ id: 1 }] }),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ scope: 'ogc-features:fastighetsindelning.read' }),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true }),
          text: () => Promise.resolve('ok'),
        });

      const report = await getExternalHealthReport();

      expect(report.checks.find((c) => c.key === 'viss')?.status).toBe('healthy');
      expect(report.checks.find((c) => c.key === 'lantmateriet_licensed')?.status).toBe('healthy');
      expect(report.checks.find((c) => c.key === 'lantmateriet_open_map')?.status).toBe('healthy');
      expect(report.checks.find((c) => c.key === 'slu')?.status).toBe('healthy');
      expect(report.checks.find((c) => c.key === 'market_intel')?.status).toBe('healthy');
      expect(report.checks.find((c) => c.key === 'bankid')?.status).toBe('degraded');
      expect(report.checks.find((c) => c.key === 'permit_authority')?.status).toBe('degraded');
      expect(report.checks.find((c) => c.key === 'timocom')?.configured).toBe(true);
      expect(report.checks.find((c) => c.key === 'trans_eu')?.configured).toBe(true);
      expect(report.checks.find((c) => c.key === 'eidas_qtsp')?.configured).toBe(true);
      expect(report.checks.find((c) => c.key === 'lims_api')?.configured).toBe(true);
      expect(report.checks.find((c) => c.key === 'ocr_api')?.configured).toBe(true);
    });

    it('maps failing live probes and missing credentials to error or not_configured', async () => {
      delete process.env.VERTEX_PROJECT_ID;
      process.env.VISS_API_KEY = 'viss-key';
      process.env.LANTMATERIET_CONSUMER_KEY = 'lm-key';
      process.env.LANTMATERIET_CONSUMER_SECRET = 'lm-secret';
      process.env.LANTMATERIET_BASE_URL = 'https://lm.test/ogc-features/v1';
      process.env.MARKET_INTEL_ENDPOINT = 'https://market.test/health';

      sluMock.getSluProductStatus.mockReturnValue([
        { product: 'artdata', hasApiKey: false, hasBasePath: true },
      ]);
      openDataMock.fetchImmediateOpenSources.mockResolvedValue([
        {
          source: 'lantmateriet_open_ftp',
          ok: false,
          status: 503,
          endpoint: 'ftp://download-opendata.lantmateriet.se',
          details: 'temporarily unavailable',
        },
      ]);
      lantmaterietMock.getLantmaterietOpenMapStatus.mockResolvedValue({
        ok: false,
        status: 502,
        endpoint: 'https://lm.test/open',
        mode: 'licensed',
      });
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('forbidden'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('bad credentials'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('market down'),
        });

      const report = await getExternalHealthReport();

      expect(report.checks.find((c) => c.key === 'viss')?.status).toBe('error');
      expect(report.checks.find((c) => c.key === 'lantmateriet_licensed')?.status).toBe('error');
      expect(report.checks.find((c) => c.key === 'lantmateriet_open_map')?.status).toBe('error');
      expect(report.checks.find((c) => c.key === 'lantmateriet_open_ftp')?.status).toBe('degraded');
      expect(report.checks.find((c) => c.key === 'slu')?.status).toBe('not_configured');
      expect(report.checks.find((c) => c.key === 'market_intel')?.status).toBe('error');
      expect(report.checks.find((c) => c.key === 'permit_authority')?.status).toBe('not_configured');
      expect(report.overall).toBe('error');
    });

    it('maps config-only degradations and missing-credential open probes correctly', async () => {
      process.env.VERTEX_PROJECT_ID = 'p1';
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{"type":"service_account","fake":true}';
      delete process.env.VISS_API_KEY;
      process.env.LANTMATERIET_ACCESS_TOKEN = 'direct-token';
      delete process.env.LANTMATERIET_CONSUMER_KEY;
      delete process.env.LANTMATERIET_CONSUMER_SECRET;
      delete process.env.LANTMATERIET_API_KEY;
      process.env.LANTMATERIET_BASE_URL = 'https://lm.test/ogc-features/v1';
      process.env.BANKID_CERT_PATH = 'bankid-cert.pem';
      process.env.BANKID_KEY_PATH = 'bankid-key.pem';
      process.env.BANKID_BASE_URL = 'https://bankid.test/rp/v6.0';
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://authority.test/submit';

      openDataMock.fetchImmediateOpenSources.mockResolvedValue([
        {
          source: 'smhi',
          ok: false,
          status: 401,
          endpoint: 'https://smhi.test',
          details: 'API-nyckel saknas för SMHI',
        },
      ]);
      lantmaterietMock.getLantmaterietOpenMapStatus.mockResolvedValue({
        ok: false,
        status: 503,
        endpoint: 'https://lm.test/open',
        mode: 'licensed',
      });
      sluMock.getSluProductStatus.mockReturnValue([
        { product: 'artportalen', hasApiKey: true, hasBasePath: true },
      ]);
      sluMock.pingSluProduct.mockRejectedValue(new Error('timeout'));

      const report = await getExternalHealthReport();

      expect(report.checks.find((c) => c.key === 'vertex_ai')?.status).toBe('healthy');
      expect(report.checks.find((c) => c.key === 'viss')?.status).toBe('not_configured');
      expect(report.checks.find((c) => c.key === 'lantmateriet_licensed')?.status).toBe('degraded');
      expect(report.checks.find((c) => c.key === 'lantmateriet_open_map')?.status).toBe('error');
      expect(report.checks.find((c) => c.key === 'slu')?.status).toBe('error');
      expect(report.checks.find((c) => c.key === 'bankid')?.configured).toBe(true);
      expect(report.checks.find((c) => c.key === 'permit_authority')?.status).toBe('degraded');
      expect(report.checks.find((c) => c.key === 'smhi')?.status).toBe('not_configured');
      expect(report.checks.find((c) => c.key === 'market_intel')?.status).toBe('not_configured');
    });

    it('maps API-key Lantmateriet and configured optional integrations as degraded', async () => {
      delete process.env.VISS_API_KEY;
      delete process.env.LANTMATERIET_ACCESS_TOKEN;
      delete process.env.LANTMATERIET_CONSUMER_KEY;
      delete process.env.LANTMATERIET_CONSUMER_SECRET;
      process.env.LANTMATERIET_API_KEY = 'legacy-key';
      process.env.LANTMATERIET_BASE_URL = 'https://lm.test/ogc-features/v1';
      process.env.MARKET_INTEL_ENDPOINT = 'https://market.test/health';
      process.env.EIDAS_QTSP_API_KEY = 'qtsp-key';
      process.env.OCR_API_KEY = 'ocr-key';

      transportMock.getDispatchProviderRuntimeStatus.mockReturnValue({
        activeProvider: 'TRANS_EU',
        credentials: { timocomConfigured: false, transEuConfigured: true },
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
        text: () => Promise.resolve('ok'),
      });

      const report = await getExternalHealthReport();

      expect(report.checks.find((c) => c.key === 'lantmateriet_licensed')?.status).toBe('degraded');
      expect(report.checks.find((c) => c.key === 'market_intel')?.status).toBe('healthy');
      expect(report.checks.find((c) => c.key === 'eidas_qtsp')?.status).toBe('degraded');
      expect(report.checks.find((c) => c.key === 'ocr_api')?.status).toBe('degraded');
      expect(report.checks.find((c) => c.key === 'timocom')?.status).toBe('not_configured');
      expect(report.checks.find((c) => c.key === 'trans_eu')?.status).toBe('degraded');
    });
  });
});
