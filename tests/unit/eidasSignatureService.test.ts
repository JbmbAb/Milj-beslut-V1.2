import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendDomainAudit: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

vi.stubGlobal('fetch', mocks.fetch);

import { signDocumentEidas } from '../../server/services/eidasSignatureService';
import type { EidasSignatureRequest } from '../../server/services/eidasSignatureService';

const baseRequest: EidasSignatureRequest = {
  documentId: 'doc-001',
  signerPersonalNumber: '196001011234',
  signerName: 'Test Testsson',
  signatureText: 'Signerat av Test',
  format: 'PAdES',
  level: 'ADVANCED',
};

const mockAuditRecord = { id: 'audit-abc-123' };

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.EIDAS_QTSP_ENDPOINT;
  delete process.env.EIDAS_QTSP_API_KEY;
  mocks.appendDomainAudit.mockResolvedValue(mockAuditRecord);
});

describe('signDocumentEidas', () => {
  it('returns a SIGNED ADVANCED result when no QTSP is configured', async () => {
    const result = await signDocumentEidas(baseRequest, 'user-1');

    expect(result.status).toBe('SIGNED');
    expect(result.level).toBe('ADVANCED');
    expect(result.documentId).toBe('doc-001');
    expect(result.signerName).toBe('Test Testsson');
    expect(result.format).toBe('PAdES');
    expect(result.signatureId).toBeTruthy();
    expect(result.signatureHash).toHaveLength(64);
    expect(result.auditId).toBe('audit-abc-123');
    expect(result.qtspRef).toBeUndefined();
  });

  it('uses default format PAdES and level ADVANCED when omitted', async () => {
    const req: EidasSignatureRequest = {
      documentId: 'doc-002',
      signerPersonalNumber: '196001011234',
      signerName: 'Anna Svensson',
    };

    const result = await signDocumentEidas(req, 'user-2');

    expect(result.format).toBe('PAdES');
    expect(result.level).toBe('ADVANCED');
    expect(result.status).toBe('SIGNED');
  });

  it('calls appendDomainAudit with correct payload', async () => {
    await signDocumentEidas(baseRequest, 'user-1');

    expect(mocks.appendDomainAudit).toHaveBeenCalledOnce();
    const call = mocks.appendDomainAudit.mock.calls[0][0];
    expect(call.entityType).toBe('EIDAS_SIGNATURE');
    expect(call.action).toBe('DOCUMENT_SIGNED_EIDAS');
    expect(call.userId).toBe('user-1');
    expect(call.payload.documentId).toBe('doc-001');
    expect(call.payload.level).toBe('ADVANCED');
    expect(call.payload.status).toBe('SIGNED');
  });

  it('logs info after signing', async () => {
    await signDocumentEidas(baseRequest, 'user-1');
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'eidas: document signed',
      expect.objectContaining({ level: 'ADVANCED', status: 'SIGNED' }),
    );
  });

  describe('QUALIFIED level with QTSP endpoint', () => {
    beforeEach(() => {
      process.env.EIDAS_QTSP_ENDPOINT = 'https://qtsp.example.com/sign';
      process.env.EIDAS_QTSP_API_KEY = 'test-key';
    });

    it('upgrades to QUALIFIED when QTSP responds ok', async () => {
      mocks.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ref: 'qtsp-ref-999' }),
      });

      const result = await signDocumentEidas({ ...baseRequest, level: 'QUALIFIED' }, 'user-1');

      expect(result.level).toBe('QUALIFIED');
      expect(result.status).toBe('SIGNED');
      expect(result.qtspRef).toBe('qtsp-ref-999');
    });

    it('falls back to ADVANCED when QTSP returns non-ok status', async () => {
      mocks.fetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await signDocumentEidas({ ...baseRequest, level: 'QUALIFIED' }, 'user-1');

      expect(result.level).toBe('ADVANCED');
      expect(result.status).toBe('SIGNED');
      expect(result.qtspRef).toBeUndefined();
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        'eidas: QTSP returned error',
        expect.objectContaining({ httpStatus: 500 }),
      );
    });

    it('falls back to ADVANCED when QTSP fetch throws', async () => {
      mocks.fetch.mockRejectedValue(new Error('network error'));

      const result = await signDocumentEidas({ ...baseRequest, level: 'QUALIFIED' }, 'user-1');

      expect(result.level).toBe('ADVANCED');
      expect(result.status).toBe('SIGNED');
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        'eidas: QTSP unreachable, falling back to Advanced',
        expect.objectContaining({ err: expect.stringContaining('network error') }),
      );
    });

    it('includes Authorization header when API key is set', async () => {
      mocks.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ref: 'ref-1' }),
      });

      await signDocumentEidas({ ...baseRequest, level: 'QUALIFIED' }, 'user-1');

      const [, options] = mocks.fetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-key');
    });

    it('does NOT call QTSP when level is ADVANCED even if endpoint is set', async () => {
      await signDocumentEidas({ ...baseRequest, level: 'ADVANCED' }, 'user-1');
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });

  it('generates unique signatureIds across calls', async () => {
    const r1 = await signDocumentEidas(baseRequest, 'user-1');
    const r2 = await signDocumentEidas(baseRequest, 'user-1');
    expect(r1.signatureId).not.toBe(r2.signatureId);
  });
});
