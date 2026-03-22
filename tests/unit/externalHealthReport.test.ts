import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchImmediateOpenSources: vi.fn(),
  getLantmaterietOpenMapStatus: vi.fn(),
  getSluProductStatus: vi.fn(),
  pingSluProduct: vi.fn(),
  getDispatchProviderRuntimeStatus: vi.fn(),
  isLantmaterietOpenMode: vi.fn(),
}));

vi.mock('../../server/services/openDataSourceService', () => ({
  fetchImmediateOpenSources: mocks.fetchImmediateOpenSources,
}));

vi.mock('../../server/services/lantmaterietService', () => ({
  getLantmaterietOpenMapStatus: mocks.getLantmaterietOpenMapStatus,
}));

vi.mock('../../server/services/sluService', () => ({
  getSluProductStatus: mocks.getSluProductStatus,
  pingSluProduct: mocks.pingSluProduct,
}));

vi.mock('../../server/services/transportDispatchService', () => ({
  getDispatchProviderRuntimeStatus: mocks.getDispatchProviderRuntimeStatus,
}));

vi.mock('../../server/security/env', () => ({
  isLantmaterietOpenMode: mocks.isLantmaterietOpenMode,
}));

import { getExternalHealthReport } from '../../server/services/externalHealthService';

const originalEnv = { ...process.env };

function restoreRelevantEnv() {
  const managedKeys = [
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'VISS_API_KEY',
    'VISS_API_BASE_URL',
    'LANTMATERIET_ACCESS_TOKEN',
    'LANTMATERIET_CONSUMER_KEY',
    'LANTMATERIET_CONSUMER_SECRET',
    'LANTMATERIET_API_KEY',
    'LANTMATERIET_BASE_URL',
    'LANTMATERIET_TOKEN_URL',
    'LANTMATERIET_LOOKUP_MODE',
    'LANTMATERIET_SCOPE',
    'SLU_API_BASE_URL',
    'MARKET_INTEL_ENDPOINT',
    'AUTHORITY_SUBMIT_ENDPOINT',
    'AUTHORITY_API_KEY',
    'BANKID_BASE_URL',
    'BANKID_CERT_PATH',
    'BANKID_KEY_PATH',
    'BANKID_PFX_PATH',
    'EIDAS_QTSP_ENDPOINT',
    'EIDAS_QTSP_API_KEY',
    'LIMS_API_ENDPOINT',
    'LIMS_API_KEY',
    'OCR_API_KEY',
  ];

  for (const key of managedKeys) {
    const originalValue = originalEnv[key];
    if (originalValue === undefined) delete process.env[key];
    else process.env[key] = originalValue;
  }
}

describe('getExternalHealthReport', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00.000Z'));
    restoreRelevantEnv();

    mocks.fetchImmediateOpenSources.mockResolvedValue([]);
    mocks.getLantmaterietOpenMapStatus.mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: 'https://maps.example.test',
      mode: 'open',
    });
    mocks.getSluProductStatus.mockReturnValue([]);
    mocks.pingSluProduct.mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: 'https://slu.example.test',
    });
    mocks.getDispatchProviderRuntimeStatus.mockReturnValue({
      activeProvider: 'mock',
      credentials: {
        timocomConfigured: false,
        transEuConfigured: false,
      },
    });
    mocks.isLantmaterietOpenMode.mockReturnValue(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreRelevantEnv();
  });

  it('builds a mixed external health report from live probes and config states', async () => {
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.VISS_API_KEY = 'viss-key';
    process.env.VISS_API_BASE_URL = 'https://viss.test/api';
    process.env.LANTMATERIET_CONSUMER_KEY = 'consumer';
    process.env.LANTMATERIET_CONSUMER_SECRET = 'secret';
    process.env.LANTMATERIET_BASE_URL = 'https://lant.test/ogc-features/v1';
    process.env.LANTMATERIET_LOOKUP_MODE = 'ogc';
    process.env.SLU_API_BASE_URL = 'https://slu.test';
    process.env.MARKET_INTEL_ENDPOINT = 'https://market.test/health';
    process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://authority.test/submit';
    process.env.AUTHORITY_API_KEY = 'authority-key';
    process.env.BANKID_BASE_URL = 'https://bankid.test';
    process.env.BANKID_CERT_PATH = 'cert.pem';
    process.env.BANKID_KEY_PATH = 'key.pem';
    process.env.EIDAS_QTSP_ENDPOINT = 'https://qtsp.test';
    process.env.EIDAS_QTSP_API_KEY = 'qtsp-key';
    process.env.OCR_API_KEY = 'ocr-key';

    mocks.fetchImmediateOpenSources.mockResolvedValue([
      {
        source: 'naturvardsverket',
        ok: true,
        status: 200,
        details: 'healthy',
        endpoint: 'https://nv.test',
      },
      {
        source: 'lantmateriet_open_ftp',
        ok: true,
        status: 200,
        details: 'ftp ready',
        endpoint: 'ftp://download-opendata.lantmateriet.se',
      },
      {
        source: 'sgu',
        ok: false,
        status: 503,
        details: 'upstream unavailable',
        endpoint: 'https://sgu.test',
      },
      {
        source: 'msb',
        ok: false,
        status: 401,
        details: 'API-nyckel saknas',
        endpoint: 'https://msb.test',
      },
    ]);
    mocks.getLantmaterietOpenMapStatus.mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: 'https://maps.example.test',
      mode: 'open',
    });
    mocks.isLantmaterietOpenMode.mockReturnValue(true);
    mocks.getSluProductStatus.mockReturnValue([
      { product: 'artfakta', hasApiKey: true, hasBasePath: true },
      { product: 'artportalen', hasApiKey: true, hasBasePath: true },
    ]);
    mocks.pingSluProduct.mockImplementation(async (product: string) => ({
      ok: true,
      status: 200,
      endpoint: `https://slu.test/${product}`,
    }));
    mocks.getDispatchProviderRuntimeStatus.mockReturnValue({
      activeProvider: 'timocom',
      credentials: {
        timocomConfigured: true,
        transEuConfigured: false,
      },
    });

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://api.openai.com/v1/models') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'gpt-5.4' }] }),
        } as Response;
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models')) {
        return {
          ok: false,
          status: 429,
          text: async () => 'rate limited',
        } as Response;
      }
      if (url.startsWith('https://viss.test/api?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ NearbyWaters: [{}, {}] }),
        } as Response;
      }
      if (url === 'https://lant.test/token') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ scope: 'ogc-features:fastighetsindelning.read' }),
        } as Response;
      }
      if (url === 'https://market.test/health') {
        return {
          ok: false,
          status: 503,
          text: async () => 'service unavailable',
        } as Response;
      }
      throw new Error(`Unhandled fetch URL: ${url}`);
    });

    const report = await getExternalHealthReport();
    const checksByKey = new Map(report.checks.map((check) => [check.key, check]));

    expect(report.checkedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(report.overall).toBe('error');
    expect(report.totals.total).toBe(report.checks.length);
    expect(report.totals.error).toBeGreaterThan(0);
    expect(report.totals.notConfigured).toBeGreaterThan(0);

    expect(checksByKey.get('naturvardsverket')).toMatchObject({
      status: 'healthy',
      mode: 'live',
      configured: true,
    });
    expect(checksByKey.get('lantmateriet_open_ftp')).toMatchObject({
      status: 'degraded',
      mode: 'derived',
      configured: true,
    });
    expect(checksByKey.get('sgu')).toMatchObject({
      status: 'error',
      mode: 'live',
      configured: true,
      responseCode: 503,
    });
    expect(checksByKey.get('msb')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
      configured: false,
      responseCode: 401,
    });
    expect(checksByKey.get('openai')).toMatchObject({
      status: 'healthy',
      mode: 'live',
      responseCode: 200,
    });
    expect(checksByKey.get('gemini')).toMatchObject({
      status: 'error',
      mode: 'live',
      responseCode: 429,
    });
    expect(checksByKey.get('viss')).toMatchObject({
      status: 'healthy',
      mode: 'live',
      responseCode: 200,
    });
    expect(checksByKey.get('lantmateriet_licensed')).toMatchObject({
      status: 'healthy',
      mode: 'live',
      responseCode: 200,
    });
    expect(checksByKey.get('lantmateriet_open_map')).toMatchObject({
      status: 'healthy',
      mode: 'live',
      responseCode: 200,
    });
    expect(checksByKey.get('slu')).toMatchObject({
      status: 'healthy',
      mode: 'live',
      configured: true,
      responseCode: 200,
    });
    expect(checksByKey.get('market_intel')).toMatchObject({
      status: 'error',
      mode: 'live',
      responseCode: 503,
    });
    expect(checksByKey.get('bankid')).toMatchObject({
      status: 'degraded',
      mode: 'config',
      configured: true,
    });
    expect(checksByKey.get('permit_authority')).toMatchObject({
      status: 'degraded',
      mode: 'config',
      configured: true,
    });
    expect(checksByKey.get('timocom')).toMatchObject({
      status: 'degraded',
      mode: 'derived',
      configured: true,
    });
    expect(checksByKey.get('trans_eu')).toMatchObject({
      status: 'not_configured',
      mode: 'derived',
      configured: false,
    });
    expect(checksByKey.get('eidas_qtsp')).toMatchObject({
      status: 'degraded',
      mode: 'config',
      configured: true,
    });
    expect(checksByKey.get('lims_api')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
      configured: false,
    });
    expect(checksByKey.get('ocr_api')).toMatchObject({
      status: 'degraded',
      mode: 'config',
      configured: true,
    });
  });

  it('marks integrations as not configured when credentials are missing', async () => {
    mocks.getLantmaterietOpenMapStatus.mockResolvedValue({
      ok: false,
      status: 503,
      endpoint: 'https://maps.example.test',
      mode: 'open',
    });
    mocks.getSluProductStatus.mockReturnValue([
      { product: 'artfakta', hasApiKey: false, hasBasePath: true },
      { product: 'artportalen', hasApiKey: true, hasBasePath: false },
    ]);
    mocks.getDispatchProviderRuntimeStatus.mockReturnValue({
      activeProvider: 'mock',
      credentials: {
        timocomConfigured: false,
        transEuConfigured: false,
      },
    });

    const report = await getExternalHealthReport();
    const checksByKey = new Map(report.checks.map((check) => [check.key, check]));

    expect(report.checkedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(report.overall).toBe('error');
    expect(checksByKey.get('openai')).toMatchObject({ status: 'not_configured', mode: 'config' });
    expect(checksByKey.get('gemini')).toMatchObject({ status: 'not_configured', mode: 'config' });
    expect(checksByKey.get('viss')).toMatchObject({ status: 'not_configured', mode: 'config' });
    expect(checksByKey.get('lantmateriet_licensed')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
    });
    expect(checksByKey.get('lantmateriet_open_map')).toMatchObject({
      status: 'error',
      mode: 'live',
      responseCode: 503,
    });
    expect(checksByKey.get('slu')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
      configured: false,
    });
    expect(checksByKey.get('market_intel')).toMatchObject({ status: 'not_configured', mode: 'config' });
    expect(checksByKey.get('bankid')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
      configured: false,
    });
    expect(checksByKey.get('permit_authority')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
      configured: false,
    });
    expect(checksByKey.get('timocom')).toMatchObject({
      status: 'not_configured',
      mode: 'derived',
      configured: false,
    });
    expect(checksByKey.get('trans_eu')).toMatchObject({
      status: 'not_configured',
      mode: 'derived',
      configured: false,
    });
    expect(checksByKey.get('eidas_qtsp')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
      configured: false,
    });
    expect(checksByKey.get('lims_api')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
      configured: false,
    });
    expect(checksByKey.get('ocr_api')).toMatchObject({
      status: 'not_configured',
      mode: 'config',
      configured: false,
    });
  });
});
