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

vi.mock('../../server/security/auditTrail', () => auditMock);
vi.mock('../../server/repositories/auditRepository', () => auditRepoMock);
vi.mock('../../server/repositories/projectAccessRepository', () => authRepoMock);
vi.mock('../../server/security/projectAccess', () => securityMock);
vi.mock('../../server/security/env', () => envMock);
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
    auditMock.appendPropertyAudit.mockResolvedValue(undefined);
    auditRepoMock.writePropertyAccessLog.mockResolvedValue(undefined);
    authRepoMock.assertProjectMembership.mockResolvedValue(undefined);
    securityMock.assertPermission.mockReturnValue(undefined);
    securityMock.validatePropertyLookupInput.mockReturnValue(undefined);
    envMock.hasLantmaterietAuth.mockReturnValue(true);
    envMock.isLantmaterietOpenMode.mockReturnValue(false);
    delete process.env.LANTMATERIET_DEMO_MODE;
    process.env.LANTMATERIET_BASE_URL = 'https://api.lantmateriet.test';
    delete process.env.LANTMATERIET_ACCESS_TOKEN;
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
    expect(report.error).toMatch(/scope/i);
  });
});
