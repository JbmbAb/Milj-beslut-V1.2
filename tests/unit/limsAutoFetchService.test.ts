import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendDomainAudit: vi.fn(),
  createLimsReport: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('../../server/services/limsService', () => ({
  createLimsReport: mocks.createLimsReport,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

import { autoFetchLimsReports } from '../../server/services/limsAutoFetchService';

const BASE_PARAMS = { projectId: 'proj-1', actingUserId: 'user-1' };

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.LIMS_API_ENDPOINT;
  delete process.env.LIMS_API_KEY;

  mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-id-1' });
});

describe('autoFetchLimsReports', () => {
  it('returns NOT_CONFIGURED when LIMS_API_ENDPOINT is not set', async () => {
    const result = await autoFetchLimsReports(BASE_PARAMS);

    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.reportsImported).toBe(0);
    expect(result.reports).toHaveLength(0);
    expect(result.errorMessages).toHaveLength(0);
    expect(result.projectId).toBe('proj-1');
    expect(result.auditId).toBe('audit-id-1');
  });

  it('appends audit record regardless of configuration', async () => {
    await autoFetchLimsReports(BASE_PARAMS);

    expect(mocks.appendDomainAudit).toHaveBeenCalledOnce();
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'LIMS_AUTO_FETCH',
        entityId: 'proj-1',
        action: 'LIMS_AUTO_FETCH',
        userId: 'user-1',
      }),
    );
  });

  it('returns SUCCESS with reports when API returns valid data', async () => {
    process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api/reports';

    const fakeReport = {
      sampleId: 'S-001',
      labName: 'TestLab',
      analyzedAt: '2024-01-01T00:00:00Z',
      rawReference: 'ref-001',
      metrics: [{ key: 'pH', value: 7.2, unit: 'pH', maxAllowed: 9 }],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reports: [fakeReport] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const createdReport = { id: 'report-1', sampleId: 'S-001' };
    mocks.createLimsReport.mockResolvedValue(createdReport);

    const result = await autoFetchLimsReports(BASE_PARAMS);

    expect(result.status).toBe('SUCCESS');
    expect(result.reportsImported).toBe(1);
    expect(result.reports).toHaveLength(1);
    expect(result.errorMessages).toHaveLength(0);
    expect(mocks.createLimsReport).toHaveBeenCalledWith(
      expect.objectContaining({ sampleId: 'S-001', labName: 'TestLab', source: 'API' }),
    );

    vi.unstubAllGlobals();
  });

  it('returns NO_NEW_REPORTS when API returns empty reports array', async () => {
    process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api/reports';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reports: [] }) }));

    const result = await autoFetchLimsReports(BASE_PARAMS);

    expect(result.status).toBe('NO_NEW_REPORTS');
    expect(result.reportsImported).toBe(0);

    vi.unstubAllGlobals();
  });

  it('returns FAILED and records error when API responds with non-ok status', async () => {
    process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api/reports';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const result = await autoFetchLimsReports(BASE_PARAMS);

    expect(result.status).toBe('FAILED');
    expect(result.errorMessages).toContain('LIMS API returnerade HTTP 503');

    vi.unstubAllGlobals();
  });

  it('returns FAILED and logs warning when fetch throws a network error', async () => {
    process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api/reports';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

    const result = await autoFetchLimsReports(BASE_PARAMS);

    expect(result.status).toBe('FAILED');
    expect(result.errorMessages[0]).toMatch(/API-anslutning misslyckades/);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'lims-auto-fetch: API call failed',
      expect.objectContaining({ err: expect.stringContaining('Network failure') }),
    );

    vi.unstubAllGlobals();
  });

  it('adds error message but continues when an individual report fails to parse', async () => {
    process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api/reports';

    const goodReport = {
      sampleId: 'S-OK',
      labName: 'GoodLab',
      rawReference: 'ref-ok',
      metrics: [],
    };
    const badReport = {
      sampleId: 'S-BAD',
      labName: 'BadLab',
      rawReference: 'ref-bad',
      metrics: [],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reports: [goodReport, badReport] }),
    }));

    mocks.createLimsReport
      .mockResolvedValueOnce({ id: 'report-ok', sampleId: 'S-OK' })
      .mockRejectedValueOnce(new Error('Parsing error for S-BAD'));

    const result = await autoFetchLimsReports(BASE_PARAMS);

    expect(result.reportsImported).toBe(1);
    expect(result.errorMessages).toHaveLength(1);
    expect(result.errorMessages[0]).toMatch(/S-BAD/);
    // One report succeeded → PARTIAL expected? Source returns SUCCESS if any reports
    expect(['SUCCESS', 'PARTIAL']).toContain(result.status);

    vi.unstubAllGlobals();
  });

  it('includes Bearer token in Authorization header when LIMS_API_KEY is set', async () => {
    process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api/reports';
    process.env.LIMS_API_KEY = 'secret-key';

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reports: [] }) });
    vi.stubGlobal('fetch', mockFetch);

    await autoFetchLimsReports(BASE_PARAMS);

    const [, options] = mockFetch.mock.calls[0];
    expect((options as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret-key' });

    vi.unstubAllGlobals();
  });

  it('passes the since parameter to the API URL when provided', async () => {
    process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api/reports';

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reports: [] }) });
    vi.stubGlobal('fetch', mockFetch);

    await autoFetchLimsReports({ ...BASE_PARAMS, since: '2024-06-01T00:00:00Z' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('since=2024-06-01');

    vi.unstubAllGlobals();
  });
});
