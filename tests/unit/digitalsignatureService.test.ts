import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/services/bankIdService', () => ({
  initiateBankIdSign: vi.fn(),
  collectBankIdSign: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { initiateBankIdSign, collectBankIdSign } from '../../server/services/bankIdService';
import {
  initiateBankIDSignature,
  completeBankIDSignature,
  verifySignature,
  recordSignatureAction,
  generateApplicationSignatureHash,
} from '../../server/services/digitalsignatureService';
import type { DigitalSignature } from '../../server/services/digitalsignatureService';

const baseSignature: DigitalSignature = {
  id: 'sig-1',
  referenceNumber: 'AVLOPP-2024-001',
  documentId: 'doc-1',
  documentHash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  signatureType: 'BANKID',
  reason: 'APPLICATION_SUBMISSION',
  signedBy: '190001010000',
  signedAt: new Date().toISOString(),
  signatureData: 'base64signature==',
  verified: true,
  chainOfCustody: [{ timestamp: new Date().toISOString(), action: 'CREATED', actor: '190001010000' }],
};

describe('digitalsignatureService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initiateBankIDSignature', () => {
    it('returnerar orderRef och autoStartToken', async () => {
      vi.mocked(initiateBankIdSign).mockResolvedValue({
        orderRef: 'order-123',
        autoStartToken: 'token-abc',
        qrStartToken: 'qr-xyz',
      } as any);

      const result = await initiateBankIDSignature(
        'AVLOPP-2024-001',
        'doc-1',
        'Dokument för signering',
        '192.168.1.1',
      );

      expect(result.orderRef).toBe('order-123');
      expect(result.autoStartToken).toBe('token-abc');
      expect(result.message).toContain('BankID');
    });

    it('anropar initiateBankIdSign med userVisibleData', async () => {
      vi.mocked(initiateBankIdSign).mockResolvedValue({
        orderRef: 'order-1',
        autoStartToken: 'token-1',
      } as any);

      await initiateBankIDSignature('AVLOPP-2024-001', 'doc-1', 'Innehåll', '10.0.0.1');

      expect(initiateBankIdSign).toHaveBeenCalledOnce();
      const args = vi.mocked(initiateBankIdSign).mock.calls[0][0];
      expect(args.userVisibleData).toContain('AVLOPP-2024-001');
    });

    it('kastar vid BankID-fel', async () => {
      vi.mocked(initiateBankIdSign).mockRejectedValue(new Error('BankID timeout'));

      await expect(
        initiateBankIDSignature('AVLOPP-2024-001', 'doc-1', 'Innehåll', '10.0.0.1'),
      ).rejects.toThrow('BankID timeout');
    });
  });

  describe('completeBankIDSignature', () => {
    it('returnerar DigitalSignature vid lyckad signering', async () => {
      vi.mocked(collectBankIdSign).mockResolvedValue({
        status: 'complete',
        completionData: {
          user: {
            personalNumber: '190001010000',
            givenName: 'Test',
            surname: 'Testsson',
          },
          signature: 'base64sig==',
          ocspResponse: 'ocsp==',
        },
      } as any);

      const result = await completeBankIDSignature(
        'order-123',
        'hashvalue123',
        'AVLOPP-2024-001',
        '10.0.0.1',
      );

      expect(result.signedBy).toBe('190001010000');
      expect(result.signatureType).toBe('BANKID');
      expect(result.verified).toBe(true);
      expect(result.chainOfCustody).toHaveLength(1);
    });

    it('kastar om status inte är complete', async () => {
      vi.mocked(collectBankIdSign).mockResolvedValue({
        status: 'pending',
        hintCode: 'outstandingTransaction',
      } as any);

      await expect(completeBankIDSignature('order-1', 'hash', 'AVLOPP-001', '10.0.0.1')).rejects.toThrow(
        'not complete',
      );
    });
  });

  describe('verifySignature', () => {
    it('returnerar valid:true när dokumenthash stämmer', async () => {
      const content = 'Dokument att signera';
      const { createHash } = await import('node:crypto');
      const hash = createHash('sha256').update(content).digest('hex');

      const sig: DigitalSignature = { ...baseSignature, documentHash: hash };
      const result = await verifySignature(sig, content);

      expect(result.valid).toBe(true);
    });

    it('returnerar valid:false när dokumenthash skiljer sig', async () => {
      const sig: DigitalSignature = { ...baseSignature, documentHash: 'oldhash' };
      const result = await verifySignature(sig, 'Nytt innehåll');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('ändrats');
    });
  });

  describe('recordSignatureAction', () => {
    it('lägger till åtgärd i chainOfCustody', async () => {
      const sig = { ...baseSignature, chainOfCustody: [...baseSignature.chainOfCustody] };

      const updated = await recordSignatureAction(sig, 'VERIFIED', 'validator-1');

      expect(updated.chainOfCustody).toHaveLength(2);
      expect(updated.chainOfCustody[1].action).toBe('VERIFIED');
      expect(updated.chainOfCustody[1].actor).toBe('validator-1');
    });
  });

  describe('generateApplicationSignatureHash', () => {
    it('returnerar deterministisk hash', () => {
      const app = {
        id: 'app-1',
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        pe: 5,
        selectedSystemType: 'INFILTRATION',
        status: 'DRAFT',
        submittedDate: null,
      } as any;

      const hash1 = generateApplicationSignatureHash(app);
      const hash2 = generateApplicationSignatureHash(app);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it('returnerar olika hash för olika ansökningar', () => {
      const app1 = {
        id: 'app-1',
        propertyDesignation: 'GÄVLE 1:1',
        pe: 5,
        selectedSystemType: 'INFILTRATION',
        status: 'DRAFT',
        submittedDate: null,
      } as any;
      const app2 = {
        id: 'app-2',
        propertyDesignation: 'STOCKHOLM 2:2',
        pe: 10,
        selectedSystemType: 'MINI_RENINGSVERK',
        status: 'SUBMITTED',
        submittedDate: '2025-01-01',
      } as any;

      expect(generateApplicationSignatureHash(app1)).not.toBe(generateApplicationSignatureHash(app2));
    });
  });
});
