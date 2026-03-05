import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/repositories/auditRepository', () => {
  return {
    appendAuditTrailRow: vi.fn(async () => undefined),
  };
});

import { appendDomainAudit, exportAuditTrail, verifyAuditTrail } from '../../server/security/auditTrail';

describe('auditTrail', () => {
  it('appends records and verifies hash chain integrity', async () => {
    await appendDomainAudit({
      entityType: 'ProjectPlan',
      entityId: 'project-1:save',
      action: 'PLAN_SAVE',
      userId: 'user-1',
      payload: { projectId: 'project-1' },
    });

    await appendDomainAudit({
      entityType: 'ProjectPlan',
      entityId: 'project-1:template',
      action: 'TEMPLATE_APPLY',
      userId: 'user-1',
      payload: { projectId: 'project-1', templateId: 'ENV_PERMIT_CORE' },
    });

    const verification = verifyAuditTrail();
    expect(verification.ok).toBe(true);
    expect(exportAuditTrail().length).toBeGreaterThanOrEqual(2);
  });

  it('detects tampering in chain hash', () => {
    const rows = exportAuditTrail() as unknown as Array<{ chainHash: string }>;
    expect(rows.length).toBeGreaterThan(0);

    rows[0].chainHash = 'tampered-hash';
    const verification = verifyAuditTrail();

    expect(verification.ok).toBe(false);
    expect(verification.invalidIndex).toBe(0);
  });
});
