import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn().mockResolvedValue({ id: 'audit-eidas-1' }),
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Module under test ─────────────────────────────────────────────────────────

import { signDocumentEidas } from '../../server/services/eidasSignatureService';
import { appendDomainAudit } from '../../server/security/auditTrail';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseRequest() {
  return {
    documentId: 'doc-1',
    signerPersonalNumber: '19900101-1234',
    signerName: 'Anna Svensson',
    signatureText: 'Jag bekräftar detta dokument',
    format: 'PAdES' as const,
    level: 'ADVANCED' as const,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.EIDAS_QTSP_ENDPOINT;
  delete process.env.EIDAS_QTSP_API_KEY;
});

describe('eidasSignatureService', () => {

  // ── ADVANCED signature (no QTSP) ──────────────────────────────────────────

  describe('signDocumentEidas – ADVANCED (no QTSP configured)', () => {
    it('returns a result with correct structure', async () => {
      const result = await signDocumentEidas(baseRequest(), 'user-1');

      expect(result.signatureId).toBeTruthy();
      expect(result.documentId).toBe('doc-1');
      expect(result.signerName).toBe('Anna Svensson');
      expect(result.level).toBe('ADVANCED');
      expect(result.format).toBe('PAdES');
      expect(result.status).toBe('SIGNED');
      expect(result.auditId).toBe('audit-eidas-1');
    });

    it('returns a 64-character hex signatureHash', async () => {
      const result = await signDocumentEidas(baseRequest(), 'user-1');
      expect(result.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces a different hash for a different documentId', async () => {
      const req1 = { ...baseRequest(), documentId: 'doc-aaa' };
      const req2 = { ...baseRequest(), documentId: 'doc-bbb' };
      const r1 = await signDocumentEidas(req1, 'user-1');
      const r2 = await signDocumentEidas(req2, 'user-1');
      expect(r1.signatureHash).not.toBe(r2.signatureHash);
    });

    it('sets signedAt to a valid ISO timestamp', async () => {
      const result = await signDocumentEidas(baseRequest(), 'user-1');
      expect(new Date(result.signedAt).getTime()).not.toBeNaN();
    });

    it('defaults format to PAdES when not specified', async () => {
      const req = { ...baseRequest() };
      delete (req as Partial<typeof req>).format;
      const result = await signDocumentEidas(req, 'user-1');
      expect(result.format).toBe('PAdES');
    });

    it('defaults level to ADVANCED when not specified', async () => {
      const req = { ...baseRequest() };
      delete (req as Partial<typeof req>).level;
      const result = await signDocumentEidas(req, 'user-1');
      expect(result.level).toBe('ADVANCED');
    });

    it('does not set qtspRef when no QTSP is configured', async () => {
      const result = await signDocumentEidas(baseRequest(), 'user-1');
      expect(result.qtspRef).toBeUndefined();
    });
  });

  // ── Audit trail ───────────────────────────────────────────────────────────

  describe('audit trail', () => {
    it('calls appendDomainAudit with DOCUMENT_SIGNED_EIDAS action', async () => {
      await signDocumentEidas(baseRequest(), 'user-audit');

      expect(appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DOCUMENT_SIGNED_EIDAS',
          entityType: 'EIDAS_SIGNATURE',
          userId: 'user-audit',
          payload: expect.objectContaining({
            documentId: 'doc-1',
            signerName: 'Anna Svensson',
          }),
        }),
      );
    });

    it('includes signatureHash in audit payload', async () => {
      await signDocumentEidas(baseRequest(), 'user-hash');
      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── QUALIFIED signature with QTSP endpoint ────────────────────────────────

  describe('signDocumentEidas – QUALIFIED with QTSP', () => {
    it('upgrades to QUALIFIED when QTSP returns 200', async () => {
      process.env.EIDAS_QTSP_ENDPOINT = 'https://qtsp.example.com/sign';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ref: 'QTSP-REF-001' }),
      } as Response);

      const req = { ...baseRequest(), level: 'QUALIFIED' as const };
      const result = await signDocumentEidas(req, 'user-qtsp');

      expect(result.level).toBe('QUALIFIED');
      expect(result.qtspRef).toBe('QTSP-REF-001');
      expect(result.status).toBe('SIGNED');

      fetchSpy.mockRestore();
    });

    it('falls back to ADVANCED when QTSP returns 4xx', async () => {
      process.env.EIDAS_QTSP_ENDPOINT = 'https://qtsp.example.com/sign';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({}),
      } as unknown as Response);

      const req = { ...baseRequest(), level: 'QUALIFIED' as const };
      const result = await signDocumentEidas(req, 'user-fallback');

      expect(result.level).toBe('ADVANCED');
      expect(result.status).toBe('SIGNED');

      fetchSpy.mockRestore();
    });

    it('falls back to ADVANCED when QTSP network error', async () => {
      process.env.EIDAS_QTSP_ENDPOINT = 'https://qtsp.example.com/sign';

      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network fail'));

      const req = { ...baseRequest(), level: 'QUALIFIED' as const };
      const result = await signDocumentEidas(req, 'user-neterr');

      expect(result.level).toBe('ADVANCED');
      expect(result.status).toBe('SIGNED');

      fetchSpy.mockRestore();
    });

    it('sends Authorization header when EIDAS_QTSP_API_KEY is set', async () => {
      process.env.EIDAS_QTSP_ENDPOINT = 'https://qtsp.example.com/sign';
      process.env.EIDAS_QTSP_API_KEY = 'test-api-key';

      let capturedHeaders: Record<string, string> = {};
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementationOnce(async (_url, opts) => {
        capturedHeaders = (opts?.headers ?? {}) as Record<string, string>;
        return { ok: true, json: async () => ({ ref: 'REF-123' }) } as Response;
      });

      const req = { ...baseRequest(), level: 'QUALIFIED' as const };
      await signDocumentEidas(req, 'user-key');

      expect(capturedHeaders['Authorization']).toBe('Bearer test-api-key');
      fetchSpy.mockRestore();
    });
  });
});
