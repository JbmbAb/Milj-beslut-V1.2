import { describe, it, expect } from 'vitest';
import { generateBankComplianceIndex } from '../../server/services/bankComplianceService';
import { SecureError } from '../../server/security/secureErrors';

/**
 * HD-01 (A9 sweep, 2026-09-29). The service used to call
 * evaluateComplianceRules([], [], {} as any, []) — no real project data — and still returned a
 * report claiming a specific score (always 100, taxonomyAligned: true) for any project. These
 * tests replace the old ones, which asserted that fabricated scoring behaviour as if it were
 * correct. The service must now refuse explicitly until a real data source is wired.
 */
describe('generateBankComplianceIndex (HD-01: no fabricated score)', () => {
  it('refuses with an explicit, typed error instead of returning a report', async () => {
    await expect(generateBankComplianceIndex('proj-1')).rejects.toMatchObject({
      name: 'SecureError',
      statusCode: 501,
      code: 'BANK_COMPLIANCE_NOT_IMPLEMENTED',
    });
  });

  it('is not a silent failure: the error is a SecureError with a clear public message', async () => {
    try {
      await generateBankComplianceIndex('proj-2');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SecureError);
      const secure = error as SecureError;
      expect(secure.publicMessage.toLowerCase()).toContain('not available');
      expect(secure.message).toContain('proj-2');
    }
  });

  it('never returns a fabricated score for any project id', async () => {
    for (const id of ['proj-a', 'proj-b', 'nonexistent-project', '']) {
      await expect(generateBankComplianceIndex(id)).rejects.toBeInstanceOf(SecureError);
    }
  });
});
