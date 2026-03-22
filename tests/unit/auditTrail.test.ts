import { describe, expect, it, vi } from 'vitest';

const auditRows: Array<{
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userId?: string | null;
  timestamp: Date;
  payloadHash: string;
  prevHash: string | null;
  chainHash: string;
}> = [];

vi.mock('../../server/repositories/auditRepository', () => {
  return {
    appendAuditTrailRow: vi.fn(async (row) => {
      auditRows.push({
        id: `audit-${auditRows.length + 1}`,
        ...row,
      });
    }),
    getLatestAuditRow: vi.fn(async () => auditRows.at(-1) ?? null),
    getAuditExportRows: vi.fn(async (limit?: number) => auditRows.slice(0, limit ?? auditRows.length)),
  };
});

import { appendDomainAudit, exportAuditTrail, verifyAuditTrail } from '../../server/security/auditTrail';

describe('auditTrail', () => {
  it('appends records and verifies hash chain integrity', async () => {
    auditRows.length = 0;

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

    const verification = await verifyAuditTrail();
    expect(verification.ok).toBe(true);
    expect((await exportAuditTrail()).length).toBeGreaterThanOrEqual(2);
  });

  it('detects tampering in chain hash', async () => {
    auditRows.length = 0;
    await appendDomainAudit({
      entityType: 'ProjectPlan',
      entityId: 'project-1:save',
      action: 'PLAN_SAVE',
      userId: 'user-1',
      payload: { projectId: 'project-1' },
    });

    const rows = (await exportAuditTrail()) as unknown as Array<{ chainHash: string }>;
    expect(rows.length).toBeGreaterThan(0);

    auditRows[0].chainHash = 'tampered-hash';
    const verification = await verifyAuditTrail();

    expect(verification.ok).toBe(false);
    expect(verification.invalidIndex).toBe(0);
  });
});
