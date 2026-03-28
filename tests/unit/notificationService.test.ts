import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendDomainAudit: vi.fn(),
  findManyProjectMembers: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    projectMember: {
      findMany: mocks.findManyProjectMembers,
    },
  },
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('nodemailer', () => ({
  createTransport: mocks.createTransport.mockReturnValue({
    sendMail: mocks.sendMail,
  }),
}));

describe('notificationService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function loadModule() {
    return import('../../server/services/notificationService');
  }

  describe('sendProjectNotification', () => {
    const mockNotif = {
      projectId: 'proj-1',
      event: 'STAGE_GATE_PASSED' as any,
      actingUserId: 'user-1',
      message: 'Hello world',
    };

    it('always logs to audit trail and returns 0 emails if SMTP is not configured', async () => {
      mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
      delete process.env.SMTP_HOST;

      const { sendProjectNotification } = await loadModule();
      const result = await sendProjectNotification(mockNotif);

      expect(result.auditId).toBe('audit-1');
      expect(result.emailsSent).toBe(0);
    });

    it('sends emails to members with valid addresses when SMTP is configured', async () => {
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';

      mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
      mocks.findManyProjectMembers.mockResolvedValue([{ user: { bankidId: 'test@example.com' } }]);
      mocks.sendMail.mockResolvedValue({ messageId: 'msg-1' });

      const { sendProjectNotification } = await loadModule();
      const result = await sendProjectNotification(mockNotif);

      expect(result.emailsSent).toBe(1);
    });

    it('handles SMTP send errors gracefully', async () => {
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';

      mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
      mocks.findManyProjectMembers.mockResolvedValue([{ user: { bankidId: 'error@example.com' } }]);
      mocks.sendMail.mockRejectedValue(new Error('SMTP Down'));

      const { sendProjectNotification } = await loadModule();
      const result = await sendProjectNotification(mockNotif);

      expect(result.emailsSent).toBe(0);
    });
  });

  describe('notifyStageGate', () => {
    it('maps statuses correctly', async () => {
      mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
      const { notifyStageGate } = await loadModule();

      await notifyStageGate({
        projectId: 'p1',
        gateId: 'g1',
        status: 'PASSED',
        actingUserId: 'u1',
      });

      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ event: 'STAGE_GATE_PASSED' }),
        }),
      );
    });
  });
});
