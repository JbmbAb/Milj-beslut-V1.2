import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * W3b -- C1 (MAP-2-SEMANTICS.md Delta 2026-09-28: "Bank-endpointen ska avvecklas; den ska inte
 * göras till governed beslutsmotor"). `generateBankComplianceIndex()` called
 * `evaluateComplianceRules([], [], {} as any, [])` with permanently hardcoded empty inputs --
 * structurally unable to ever raise a flag -- yet was live at
 * `GET /api/projects/:projectId/bank-compliance-index` with zero frontend consumers anywhere. The
 * route file is deleted outright (its only purpose was this one route); the underlying service
 * function and its own test are left in place as unreferenced, forward-only dead code, per the
 * no-drive-by-cleanup norm established in W3a.
 */
describe('W3b: the bank-compliance route has been retired (C1)', () => {
  it('server/routes/bankCompliance.routes.ts no longer exists on disk', () => {
    expect(existsSync('server/routes/bankCompliance.routes.ts')).toBe(false);
  });

  it('server/createApp.ts no longer imports or mounts bankComplianceRouter', () => {
    const source = readFileSync('server/createApp.ts', 'utf8');
    expect(source).not.toMatch(/bankComplianceRouter/);
  });

  it('the underlying service function is left in place as unreferenced dead code, per the no-drive-by-cleanup norm', () => {
    expect(existsSync('server/services/bankComplianceService.ts')).toBe(true);
  });
});
