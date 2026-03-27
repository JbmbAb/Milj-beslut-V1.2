import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn().mockResolvedValue({ id: 'audit-lims-1' }),
}));

vi.mock('../../server/services/limsService', () => ({
  createLimsReport: vi.fn(),
}));

// ─── Module under test ─────────────────────────────────────────────────────────

import { autoFetchLimsReports } from '../../server/services/limsAutoFetchService';
import { appendDomainAudit } from '../../server/security/auditTrail';
import { createLimsReport } from '../../server/services/limsService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseParams() {
  return {
    projectId: 'proj-lims-1',
    actingUserId: 'user-lims-1',
  };
}

function makeReport(sampleId = 'S-001') {
  return {
    sampleId,
    labName: 'TestLab',
    analyzedAt: '2024-06-01T10:00:00Z',
    rawReference: 'REF-001',
    metrics: [{ key: 'pH', value: 7.2, unit: '-' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LIMS_API_ENDPOINT;
  delete process.env.LIMS_API_KEY;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('limsAutoFetchService – autoFetchLimsReports', () => {
  // ── NOT_CONFIGURED ────────────────────────────────────────────────────────

  describe('NOT_CONFIGURED (no LIMS_API_ENDPOINT)', () => {
    it('returns NOT_CONFIGURED status and 0 reports', async () => {
      const result = await autoFetchLimsReports(baseParams());

      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.reportsImported).toBe(0);
      expect(result.reports).toHaveLength(0);
    });

    it('still writes an audit record', async () => {
      await autoFetchLimsReports(baseParams());

      expect(appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIMS_AUTO_FETCH',
          entityId: 'proj-lims-1',
          userId: 'user-lims-1',
        }),
      );
    });

    it('includes projectId and auditId in the result', async () => {
      const result = await autoFetchLimsReports(baseParams());
      expect(result.projectId).toBe('proj-lims-1');
      expect(result.auditId).toBe('audit-lims-1');
    });

    it('includes a fetchedAt ISO timestamp', async () => {
      const result = await autoFetchLimsReports(baseParams());
      expect(new Date(result.fetchedAt).getTime()).not.toBeNaN();
    });
  });

  // ── SUCCESS (API returns reports) ─────────────────────────────────────────

  describe('API configured – successful fetch', () => {
    it('returns SUCCESS when API returns reports', async () => {
      process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api';

      const rawReport = makeReport('S-100');
      const savedReport = { id: 'lr-1', sampleId: 'S-100' } as any;

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reports: [rawReport] }),
      } as Response);

      (createLimsReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce(savedReport);

      const result = await autoFetchLimsReports(baseParams());

      expect(result.status).toBe('SUCCESS');
      expect(result.reportsImported).toBe(1);
      expect(result.reports[0]).toBe(savedReport);
    });

    it('passes sampleId and labName to createLimsReport', async () => {
      process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api';

      const rawReport = makeReport('S-200');
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reports: [rawReport] }),
      } as Response);

      (createLimsReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'lr-2' });

      await autoFetchLimsReports(baseParams());

      expect(createLimsReport).toHaveBeenCalledWith(
        expect.objectContaining({ sampleId: 'S-200', labName: 'TestLab', source: 'API' }),
      );
    });

    it('includes Authorization header when LIMS_API_KEY is set', async () => {
      process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api';
      process.env.LIMS_API_KEY = 'my-lims-key';

      let capturedHeaders: Record<string, string> = {};
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (_url, opts) => {
        capturedHeaders = (opts?.headers ?? {}) as Record<string, string>;
        return { ok: true, json: async () => ({ reports: [] }) } as Response;
      });

      await autoFetchLimsReports(baseParams());

      expect(capturedHeaders['Authorization']).toBe('Bearer my-lims-key');
    });

    it('adds since param to URL when provided', async () => {
      process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api';

      let calledUrl = '';
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (url) => {
        calledUrl = url as string;
        return { ok: true, json: async () => ({ reports: [] }) } as Response;
      });

      await autoFetchLimsReports({ ...baseParams(), since: '2024-01-01' });

      expect(calledUrl).toContain('since=2024-01-01');
    });
  });

  // ── NO_NEW_REPORTS ────────────────────────────────────────────────────────

  describe('API configured – empty reports array', () => {
    it('returns NO_NEW_REPORTS when API returns empty array', async () => {
      process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api';

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reports: [] }),
      } as Response);

      const result = await autoFetchLimsReports(baseParams());

      expect(result.status).toBe('NO_NEW_REPORTS');
      expect(result.reportsImported).toBe(0);
    });
  });

  // ── FAILED (HTTP error) ───────────────────────────────────────────────────

  describe('API configured – HTTP error', () => {
    it('returns FAILED on non-OK response', async () => {
      process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api';

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const result = await autoFetchLimsReports(baseParams());

      expect(result.status).toBe('FAILED');
      expect(result.errorMessages.length).toBeGreaterThan(0);
      expect(result.errorMessages[0]).toContain('503');
    });

    it('returns FAILED on network error', async () => {
      process.env.LIMS_API_ENDPOINT = 'https://lims.example.com/api';

      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await autoFetchLimsReports(baseParams());

      expect(result.status).toBe('FAILED');
      expect(result.errorMessages[0]).toContain('ECONNREFUSED');
    });
  });

  // ── Audit payload ─────────────────────────────────────────────────────────

  describe('audit trail', () => {
    it('includes status and reportsImported in audit payload', async () => {
      await autoFetchLimsReports(baseParams());

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload).toHaveProperty('status');
      expect(call.payload).toHaveProperty('reportsImported');
    });

    it('includes apiEndpointConfigured in audit payload', async () => {
      await autoFetchLimsReports(baseParams());

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.apiEndpointConfigured).toBe(false);
    });
  });
});
