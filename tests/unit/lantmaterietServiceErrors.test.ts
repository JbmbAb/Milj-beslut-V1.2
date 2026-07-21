import { beforeEach, describe, expect, it, vi } from 'vitest';

const auditMock = vi.hoisted(() => ({ appendPropertyAudit: vi.fn() }));
const auditRepoMock = vi.hoisted(() => ({ writePropertyAccessLog: vi.fn() }));
const authRepoMock = vi.hoisted(() => ({ assertProjectMembership: vi.fn() }));
const securityMock = vi.hoisted(() => ({
  assertPermission: vi.fn(),
  validatePropertyLookupInput: vi.fn(),
}));
const envMock = vi.hoisted(() => ({
  isLantmaterietOpenMode: vi.fn().mockReturnValue(false),
  hasLantmaterietAuth: vi.fn().mockReturnValue(true),
}));
const hybridGeoMock = vi.hoisted(() => ({
  tryFetchLocalPropertyGeometry: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../server/security/auditTrail', () => auditMock);
vi.mock('../../server/repositories/auditRepository', () => auditRepoMock);
vi.mock('../../server/repositories/projectAccessRepository', () => authRepoMock);
vi.mock('../../server/security/projectAccess', () => securityMock);
vi.mock('../../server/security/env', () => envMock);
vi.mock('../../server/services/hybridGeoService', () => hybridGeoMock);
vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.hoisted(() => {
  process.env.LANTMATERIET_CONSUMER_KEY = 'test-key';
  process.env.LANTMATERIET_CONSUMER_SECRET = 'test-secret';
  process.env.LANTMATERIET_LOOKUP_MODE = 'ogc';
  process.env.LANTMATERIET_BASE_URL = 'https://api.lantmateriet.test';
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

async function loadService() {
  return import('../../server/services/lantmaterietService');
}

const mockUser = {
  id: 'u1',
  organisationId: 'org-1',
  bankidId: 'bankid-u1',
  role: 'CONSULTANT',
} as const;

const mockInput = {
  projectId: 'p1',
  propertyDesignation: 'GAVLE BRYNAS 1:1',
  purpose: 'Inspection',
} as const;

function stubToken() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ access_token: 'bearer-token', expires_in: 3600 }),
  });
}

function stubOgcSuccess(designation = 'GAVLE BRYNAS 1:1') {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        features: [{ properties: { etikett: designation }, geometry: { type: 'Polygon', coordinates: [] } }],
      }),
  });
}

describe('lantmaterietService errors and live policy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock.mockReset();
    auditMock.appendPropertyAudit.mockResolvedValue(undefined);
    auditRepoMock.writePropertyAccessLog.mockResolvedValue(undefined);
    authRepoMock.assertProjectMembership.mockResolvedValue(undefined);
    securityMock.assertPermission.mockReturnValue(undefined);
    securityMock.validatePropertyLookupInput.mockReturnValue(undefined);
    envMock.hasLantmaterietAuth.mockReturnValue(true);
    envMock.isLantmaterietOpenMode.mockReturnValue(false);
    hybridGeoMock.tryFetchLocalPropertyGeometry.mockResolvedValue(null);
    delete process.env.LANTMATERIET_DEMO_MODE;
    process.env.LANTMATERIET_BASE_URL = 'https://api.lantmateriet.test';
    process.env.LANTMATERIET_LOOKUP_MODE = 'ogc';
    process.env.LANTMATERIET_CONSUMER_KEY = 'test-key';
    process.env.LANTMATERIET_CONSUMER_SECRET = 'test-secret';
    delete process.env.LANTMATERIET_TOKEN_URL;
    delete process.env.LANTMATERIET_ACCESS_TOKEN;
    delete process.env.LANTMATERIET_API_KEY;
    delete process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY;
  });

  it('throws a scope message for HTTP 403 with scope in body', async () => {
    stubToken();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Missing scope ogc-features:fastighetsindelning.read'),
    });

    const { lookupPropertyByDesignation } = await loadService();
    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow(/scope/i);
  });

  it('throws an FAPI product message for HTTP 404 on fapi base url', async () => {
    process.env.LANTMATERIET_BASE_URL = 'https://api.lantmateriet.test/fapi/v1';
    stubToken();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('not found'),
    });

    const { lookupPropertyByDesignation } = await loadService();
    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow(/FAPI/);
  });

  it('throws generic missing product message for non-FAPI 404 responses', async () => {
    process.env.LANTMATERIET_BASE_URL = 'https://api.lantmateriet.test/ogc-features/v1';
    stubToken();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('not found'),
    });

    const { lookupPropertyByDesignation } = await loadService();
    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow(/Uppslagsendpoint hittades inte/);
  });

  it('throws a generic HTTP error for HTTP 500', async () => {
    stubToken();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const { lookupPropertyByDesignation } = await loadService();
    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow(/500/);
  });

  it('throws not found when the OGC collection is empty', async () => {
    stubToken();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: [] }),
    });

    const { lookupPropertyByDesignation } = await loadService();
    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow(/Fastighet hittades inte/);
  });

  it('normalizes parenprojekt notation to the OGC > suffix and returns live metadata', async () => {
    stubToken();
    stubOgcSuccess('3:12>2');

    const { lookupPropertyByDesignation } = await loadService();
    const result = await lookupPropertyByDesignation(
      { ...mockInput, propertyDesignation: 'ORSA STACKMORA 3:12 (2)' },
      mockUser,
    );

    expect(result.designation).toBe('3:12>2');
    expect(result.requestedDesignation).toBe('ORSA STACKMORA 3:12 (2)');
    expect(result.normalizedDesignation).toBe('ORSA STACKMORA 3:12>2');
    expect(result.source).toBe('live');
    expect(result.geometryStatus).toBe('present');
    expect(typeof result.fetchedAt).toBe('string');
    expect(String(fetchMock.mock.calls[1]?.[0] || '')).toContain("etikett%20%3D%20'3%3A12%3E2'");
  });

  it('throws when token fetch returns an HTTP error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid_client'),
    });

    const { lookupPropertyByDesignation } = await loadService();
    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow(
      /Failed to fetch Lantmateriet Access Token/,
    );
  });

  it('throws when token endpoint is unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { lookupPropertyByDesignation } = await loadService();
    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow();
  });

  it('throws when live credentials are missing outside open mode', async () => {
    delete process.env.LANTMATERIET_CONSUMER_KEY;
    delete process.env.LANTMATERIET_CONSUMER_SECRET;
    envMock.isLantmaterietOpenMode.mockReturnValue(false);

    const { getLantmaterietAccessToken } = await loadService();

    await expect(getLantmaterietAccessToken()).rejects.toThrow(/Missing env variables/);
  });

  it('uses direct access token without calling token endpoint', async () => {
    process.env.LANTMATERIET_ACCESS_TOKEN = 'direct-token';
    stubOgcSuccess();

    const { getLantmaterietAccessToken, lookupPropertyByDesignation } = await loadService();

    await expect(getLantmaterietAccessToken()).resolves.toBe('direct-token');
    await lookupPropertyByDesignation(mockInput, mockUser);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] || '')).toContain('/fastighetsindelning/');
  });

  it('uses legacy API key as bearer token without token fetch', async () => {
    delete process.env.LANTMATERIET_ACCESS_TOKEN;
    process.env.LANTMATERIET_API_KEY = 'legacy-token';
    stubOgcSuccess();

    const { getLantmaterietAccessToken } = await loadService();

    await expect(getLantmaterietAccessToken()).resolves.toBe('legacy-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a configured token endpoint when fetching OAuth token', async () => {
    process.env.LANTMATERIET_TOKEN_URL = 'https://auth.lantmateriet.test/oauth/token';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'configured-token', expires_in: 3600 }),
    });

    const { getLantmaterietAccessToken } = await loadService();

    await expect(getLantmaterietAccessToken()).resolves.toBe('configured-token');
    expect(String(fetchMock.mock.calls[0]?.[0] || '')).toBe('https://auth.lantmateriet.test/oauth/token');
  });

  it('throws open-mode credential guidance when consumer keys are missing', async () => {
    delete process.env.LANTMATERIET_CONSUMER_KEY;
    delete process.env.LANTMATERIET_CONSUMER_SECRET;
    envMock.isLantmaterietOpenMode.mockReturnValue(true);

    const { getLantmaterietAccessToken } = await loadService();

    await expect(getLantmaterietAccessToken()).rejects.toThrow(/Open mode supports map\/WMS testing only/);
  });

  it('reuses cached token for a second lookup', async () => {
    stubToken();
    stubOgcSuccess('GAVLE BRYNAS 1:1');

    const { lookupPropertyByDesignation } = await loadService();
    await lookupPropertyByDesignation(mockInput, mockUser);

    const callCountAfterFirst = fetchMock.mock.calls.length;

    stubOgcSuccess('GAVLE BRYNAS 1:2');
    await lookupPropertyByDesignation({ ...mockInput, propertyDesignation: 'GAVLE BRYNAS 1:2' }, mockUser);

    const callCountAfterSecond = fetchMock.mock.calls.length;
    expect(callCountAfterFirst).toBe(2);
    expect(callCountAfterSecond - callCountAfterFirst).toBe(1);
  });

  it('uses open OGC subscription before OAuth token flow when available', async () => {
    process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY = 'open-key';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          features: [{ properties: { etikett: 'GAVLE BRYNAS 1:1' }, geometry: { type: 'Polygon', coordinates: [] } }],
        }),
    });

    const { lookupPropertyByDesignation } = await loadService();
    const result = await lookupPropertyByDesignation(mockInput, mockUser);

    expect(result.source).toBe('open-ogc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] || '')).toContain('subscription-key=open-key');
  });

  it('falls back to OAuth lookup when open OGC subscription returns HTTP error', async () => {
    process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY = 'open-key';
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve('temporary issue'),
    });
    stubToken();
    stubOgcSuccess('GAVLE BRYNAS 2:1');

    const { lookupPropertyByDesignation } = await loadService();
    const result = await lookupPropertyByDesignation({ ...mockInput, propertyDesignation: 'GAVLE BRYNAS 2:1' }, mockUser);

    expect(result.source).toBe('live');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('falls back to OAuth lookup when open OGC subscription returns no match', async () => {
    process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY = 'open-key';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: [] }),
    });
    stubToken();
    stubOgcSuccess('GAVLE BRYNAS 2:1');

    const { lookupPropertyByDesignation } = await loadService();
    const result = await lookupPropertyByDesignation({ ...mockInput, propertyDesignation: 'GAVLE BRYNAS 2:1' }, mockUser);

    expect(result.source).toBe('live');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('supports distribution lookup mode without OGC collection path', async () => {
    process.env.LANTMATERIET_LOOKUP_MODE = 'distribution';
    process.env.LANTMATERIET_BASE_URL = 'https://api.lantmateriet.test/distribution';
    stubToken();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          designation: 'GAVLE BRYNAS 1:1',
          geometry: null,
          boundaries: { id: 'boundary-1' },
          ownership: { ownerType: 'PERSON', share: '1/1', name: 'Redacted' },
        }),
    });

    const { lookupPropertyByDesignation } = await loadService();
    const result = await lookupPropertyByDesignation(mockInput, mockUser);

    expect(result.source).toBe('live');
    expect(result.geometryStatus).toBe('missing');
    expect(result.ownership).toEqual({ ownerType: 'PERSON', share: '1/1' });
    expect(String(fetchMock.mock.calls[1]?.[0] || '')).toContain('/distribution/produkter/fastighet/');
  });

  it('LANTMATERIET_DEMO_MODE är avvecklad — enbart auth-check gäller numera', async () => {
    // Tidigare kunde DEMO_MODE=true spärra lookups även med auth. Efter
    // avvecklingen (spår 7a) är det endast `hasLantmaterietAuth()` som styr.
    process.env.LANTMATERIET_DEMO_MODE = 'true';
    envMock.hasLantmaterietAuth.mockReturnValue(false);

    const { lookupPropertyByDesignation } = await loadService();

    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow(
      /LIVE_LANTMATERIET_REQUIRED/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auditMock.appendPropertyAudit).not.toHaveBeenCalled();
    expect(auditRepoMock.writePropertyAccessLog).not.toHaveBeenCalled();
  });

  it('blocks live lookup when Lantmateriet auth is missing', async () => {
    envMock.hasLantmaterietAuth.mockReturnValue(false);

    const { lookupPropertyByDesignation } = await loadService();

    await expect(lookupPropertyByDesignation(mockInput, mockUser)).rejects.toThrow(
      /LIVE_LANTMATERIET_REQUIRED/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auditMock.appendPropertyAudit).not.toHaveBeenCalled();
    expect(auditRepoMock.writePropertyAccessLog).not.toHaveBeenCalled();
  });

  it('testLantmaterietConnection reports non-live configuration when credentials are missing', async () => {
    envMock.hasLantmaterietAuth.mockReturnValue(false);

    const { testLantmaterietConnection } = await loadService();
    const report = await testLantmaterietConnection();

    expect(report.ok).toBe(false);
    // Tidigare "demo" — efter demo-mode-avveckling (spår 7a) är läget
    // alltid "not_configured" när credentials saknas.
    expect(report.mode).toBe('not_configured');
    expect(report.setupGuide).toBeInstanceOf(Array);
    expect(report.setupGuide.length).toBeGreaterThan(0);
  });

  it('testLantmaterietConnection succeeds when token and OGC lookup work', async () => {
    stubToken();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          features: [{ geometry: { type: 'Point', coordinates: [18.0, 59.3] } }],
        }),
    });

    const { testLantmaterietConnection } = await loadService();
    const report = await testLantmaterietConnection();

    expect(report.ok).toBe(true);
    expect(report.mode).toBe('real');
    expect(report.tokenFetched).toBe(true);
    expect(report.sampleLookupOk).toBe(true);
    expect(report.error).toBeNull();
  });

  it('testLantmaterietConnection reports token fetch failures with setup guide', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid_client'),
    });

    const { testLantmaterietConnection } = await loadService();
    const report = await testLantmaterietConnection();

    expect(report.ok).toBe(false);
    expect(report.mode).toBe('real');
    expect(report.tokenFetched).toBe(false);
    expect(report.error).toMatch(/Token-hämtning misslyckades/);
    expect(report.setupGuide.length).toBeGreaterThan(0);
  });

  it('testLantmaterietConnection reports direct token auth method', async () => {
    delete process.env.LANTMATERIET_CONSUMER_KEY;
    delete process.env.LANTMATERIET_CONSUMER_SECRET;
    process.env.LANTMATERIET_ACCESS_TOKEN = 'direct-token';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: [] }),
    });

    const { testLantmaterietConnection } = await loadService();
    const report = await testLantmaterietConnection();

    expect(report.authMethod).toMatch(/Direkttoken/);
    expect(report.ok).toBe(true);
    expect(report.sampleLookupOk).toBe(false);
    expect(report.error).toMatch(/hittades inte/);
  });

  it('testLantmaterietConnection reports legacy API key auth method', async () => {
    delete process.env.LANTMATERIET_CONSUMER_KEY;
    delete process.env.LANTMATERIET_CONSUMER_SECRET;
    process.env.LANTMATERIET_API_KEY = 'legacy-token';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: [{ geometry: { type: 'Point', coordinates: [18.0, 59.3] } }] }),
    });

    const { testLantmaterietConnection } = await loadService();
    const report = await testLantmaterietConnection();

    expect(report.authMethod).toMatch(/Legacy API-nyckel/);
    expect(report.tokenFetched).toBe(true);
    expect(report.sampleLookupOk).toBe(true);
  });

  it('testLantmaterietConnection reports failed lookup for HTTP 403 on OGC', async () => {
    stubToken();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('scope error'),
    });

    const { testLantmaterietConnection } = await loadService();
    const report = await testLantmaterietConnection();

    expect(report.ok).toBe(false);
    expect(report.tokenFetched).toBe(true);
    expect(report.sampleLookupOk).toBe(false);
    expect(report.error).toMatch(/scope|uppslagsendpoint/i);
  });

  it('testLantmaterietConnection reports thrown lookup errors', async () => {
    stubToken();
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { testLantmaterietConnection } = await loadService();
    const report = await testLantmaterietConnection();

    expect(report.ok).toBe(false);
    expect(report.tokenFetched).toBe(true);
    expect(report.error).toMatch(/OGC-uppslag misslyckades/);
  });

  it('getLantmaterietOpenMapStatus uses base endpoint without subscription key', async () => {
    process.env.LANTMATERIET_OPEN_WMS_URL = 'https://open.lantmateriet.test/wmts?request=GetCapabilities';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<Capabilities>ok</Capabilities>'),
    });

    const { getLantmaterietOpenMapStatus } = await loadService();
    const result = await getLantmaterietOpenMapStatus();

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('licensed');
    expect(result.endpoint).toBe('https://open.lantmateriet.test/wmts?request=GetCapabilities');
    expect(result.sample).toContain('Capabilities');
  });

  it('getLantmaterietOpenMapStatus appends subscription key and reports open mode', async () => {
    process.env.LANTMATERIET_OPEN_WMS_URL = 'https://open.lantmateriet.test/wmts';
    process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY = 'sub-key';
    envMock.isLantmaterietOpenMode.mockReturnValue(true);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service unavailable'),
    });

    const { getLantmaterietOpenMapStatus } = await loadService();
    const result = await getLantmaterietOpenMapStatus();

    expect(result.ok).toBe(false);
    expect(result.mode).toBe('open');
    expect(result.status).toBe(503);
    expect(result.endpoint).toBe('https://open.lantmateriet.test/wmts?subscription-key=sub-key');
    expect(result.sample).toContain('Service unavailable');
  });
});
