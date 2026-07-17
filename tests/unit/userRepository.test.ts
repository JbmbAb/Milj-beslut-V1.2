import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpsert: vi.fn(),
  organisationUpsert: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      upsert: mocks.userUpsert,
    },
    organisation: {
      upsert: mocks.organisationUpsert,
    },
  },
}));

import { findAuthUserByBankId, ensureAdminConsoleUser } from '../../server/repositories/userRepository';

describe('userRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.ADMIN_ORG_NUMBER;
    delete process.env.ADMIN_ORG_NAME;
  });

  describe('findAuthUserByBankId', () => {
    it('returns AuthUser when user is found', async () => {
      const dbUser = {
        id: 'user-1',
        bankidId: 'bankid-abc',
        role: 'CONSULTANT',
        organisationId: 'org-1',
      };
      mocks.userFindUnique.mockResolvedValue(dbUser);

      const result = await findAuthUserByBankId('bankid-abc');

      expect(mocks.userFindUnique).toHaveBeenCalledWith({
        where: { bankidId: 'bankid-abc' },
        select: {
          id: true,
          bankidId: true,
          role: true,
          organisationId: true,
        },
      });
      expect(result).toEqual({
        id: 'user-1',
        bankidId: 'bankid-abc',
        role: 'CONSULTANT',
        organisationId: 'org-1',
      });
    });

    it('returns null when user is not found', async () => {
      mocks.userFindUnique.mockResolvedValue(null);

      const result = await findAuthUserByBankId('unknown-bankid');

      expect(result).toBeNull();
    });

    it('maps the role field correctly for ADMIN role', async () => {
      mocks.userFindUnique.mockResolvedValue({
        id: 'user-2',
        bankidId: 'bankid-admin',
        role: 'ADMIN',
        organisationId: 'org-admin',
      });

      const result = await findAuthUserByBankId('bankid-admin');

      expect(result?.role).toBe('ADMIN');
    });

    it('maps the role field correctly for AUDITOR role', async () => {
      mocks.userFindUnique.mockResolvedValue({
        id: 'user-3',
        bankidId: 'bankid-auditor',
        role: 'AUDITOR',
        organisationId: 'org-2',
      });

      const result = await findAuthUserByBankId('bankid-auditor');

      expect(result?.role).toBe('AUDITOR');
    });
  });

  describe('ensureAdminConsoleUser', () => {
    it('creates or updates org and user with default env values', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-default' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-admin',
        bankidId: 'admin:admin',
        role: 'ADMIN',
        organisationId: 'org-default',
      });

      const result = await ensureAdminConsoleUser('admin');

      expect(mocks.organisationUpsert).toHaveBeenCalledWith({
        where: { orgNumber: '999999-0001' },
        create: { name: 'Miljöbeslut Admin', orgNumber: '999999-0001' },
        update: { name: 'Miljöbeslut Admin' },
        select: { id: true },
      });
      expect(mocks.userUpsert).toHaveBeenCalledWith({
        where: { bankidId: 'admin:admin' },
        create: { bankidId: 'admin:admin', organisationId: 'org-default', role: 'ADMIN' },
        update: { organisationId: 'org-default', role: 'ADMIN' },
        select: { id: true, bankidId: true, role: true, organisationId: true },
      });
      expect(result).toEqual({
        id: 'user-admin',
        bankidId: 'admin:admin',
        role: 'ADMIN',
        organisationId: 'org-default',
      });
    });

    it('uses ADMIN_ORG_NUMBER and ADMIN_ORG_NAME env vars when set', async () => {
      process.env.ADMIN_ORG_NUMBER = '123456-7890';
      process.env.ADMIN_ORG_NAME = 'Custom Org';
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-custom' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-custom',
        bankidId: 'admin:superuser',
        role: 'ADMIN',
        organisationId: 'org-custom',
      });

      await ensureAdminConsoleUser('superuser');

      expect(mocks.organisationUpsert).toHaveBeenCalledWith({
        where: { orgNumber: '123456-7890' },
        create: { name: 'Custom Org', orgNumber: '123456-7890' },
        update: { name: 'Custom Org' },
        select: { id: true },
      });
      expect(mocks.userUpsert).toHaveBeenCalledWith({
        where: { bankidId: 'admin:superuser' },
        create: { bankidId: 'admin:superuser', organisationId: 'org-custom', role: 'ADMIN' },
        update: { organisationId: 'org-custom', role: 'ADMIN' },
        select: { id: true, bankidId: true, role: true, organisationId: true },
      });
    });

    it('trims and lowercases the username for bankidId', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-1' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-trim',
        bankidId: 'admin:john',
        role: 'ADMIN',
        organisationId: 'org-1',
      });

      await ensureAdminConsoleUser('  John  ');

      expect(mocks.userUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bankidId: 'admin:john' },
          create: expect.objectContaining({ bankidId: 'admin:john' }),
        }),
      );
    });

    it('falls back to "admin" username when empty string is provided', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-1' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-fallback',
        bankidId: 'admin:admin',
        role: 'ADMIN',
        organisationId: 'org-1',
      });

      await ensureAdminConsoleUser('');

      expect(mocks.userUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bankidId: 'admin:admin' },
        }),
      );
    });

    it('returns an AuthUser with role ADMIN', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-2' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-99',
        bankidId: 'admin:ops',
        role: 'ADMIN',
        organisationId: 'org-2',
      });

      const result = await ensureAdminConsoleUser('ops');

      expect(result.role).toBe('ADMIN');
      expect(result.id).toBe('user-99');
      expect(result.organisationId).toBe('org-2');
    });

    it('propagates database errors during organisation upsert', async () => {
      mocks.organisationUpsert.mockRejectedValue(new Error('constraint violation'));

      await expect(ensureAdminConsoleUser('admin')).rejects.toThrow('constraint violation');
    });

    it('propagates database errors during user upsert', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-1' });
      mocks.userUpsert.mockRejectedValue(new Error('upsert failed'));

      await expect(ensureAdminConsoleUser('admin')).rejects.toThrow('upsert failed');
    });
  });

  describe('error handling and edge cases', () => {
    it('propagates database errors during findAuthUserByBankId', async () => {
      mocks.userFindUnique.mockRejectedValue(new Error('query failed'));

      await expect(findAuthUserByBankId('bankid-1')).rejects.toThrow('query failed');
    });

    it('handles very long bankidId values', async () => {
      const longBankId = 'bankid-' + 'x'.repeat(10000);
      mocks.userFindUnique.mockResolvedValue(null);

      const result = await findAuthUserByBankId(longBankId);

      expect(result).toBeNull();
    });

    it('handles empty bankidId strings', async () => {
      mocks.userFindUnique.mockResolvedValue(null);

      const result = await findAuthUserByBankId('');

      expect(result).toBeNull();
    });

    it('handles special characters in bankidId', async () => {
      const specialBankId = 'bankid-!@#$%^&*()';
      mocks.userFindUnique.mockResolvedValue(null);

      const result = await findAuthUserByBankId(specialBankId);

      expect(result).toBeNull();
    });

    it('handles unicode characters in bankidId', async () => {
      const unicodeBankId = 'bankid-åäö©2026';
      mocks.userFindUnique.mockResolvedValue(null);

      const result = await findAuthUserByBankId(unicodeBankId);

      expect(result).toBeNull();
    });

    it('handles very long usernames in ensureAdminConsoleUser', async () => {
      const longUsername = 'user' + 'x'.repeat(10000);
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-1' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-1',
        bankidId: `admin:${longUsername.toLowerCase().trim().slice(0, 100)}`,
        role: 'ADMIN',
        organisationId: 'org-1',
      });

      await ensureAdminConsoleUser(longUsername);

      expect(mocks.userUpsert).toHaveBeenCalled();
    });

    it('handles multiple whitespace in username', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-1' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-1',
        bankidId: 'admin:john',
        role: 'ADMIN',
        organisationId: 'org-1',
      });

      await ensureAdminConsoleUser('   john   \n\t\r   ');

      expect(mocks.userUpsert).toHaveBeenCalled();
    });

    it('handles special characters in org number and name env vars', async () => {
      process.env.ADMIN_ORG_NUMBER = '123!@#$456';
      process.env.ADMIN_ORG_NAME = 'Org & Co. © 2026';

      mocks.organisationUpsert.mockResolvedValue({ id: 'org-special' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-special',
        bankidId: 'admin:user',
        role: 'ADMIN',
        organisationId: 'org-special',
      });

      await ensureAdminConsoleUser('user');

      expect(mocks.organisationUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgNumber: '123!@#$456' },
          create: expect.objectContaining({ name: 'Org & Co. © 2026', orgNumber: '123!@#$456' }),
        }),
      );
    });

    it('handles Swedish organisation names correctly', async () => {
      process.env.ADMIN_ORG_NUMBER = '556677-8899';
      process.env.ADMIN_ORG_NAME = 'Miljöverket i Stockholms län';

      mocks.organisationUpsert.mockResolvedValue({ id: 'org-swe' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-swe',
        bankidId: 'admin:användare',
        role: 'ADMIN',
        organisationId: 'org-swe',
      });

      await ensureAdminConsoleUser('användare');

      expect(mocks.organisationUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ name: 'Miljöverket i Stockholms län' }),
        }),
      );
    });

    it('handles very long organisation name in env var', async () => {
      const longOrgName = 'A'.repeat(50000);
      process.env.ADMIN_ORG_NAME = longOrgName;
      process.env.ADMIN_ORG_NUMBER = '123456-7890';

      mocks.organisationUpsert.mockResolvedValue({ id: 'org-long' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-long',
        bankidId: 'admin:admin',
        role: 'ADMIN',
        organisationId: 'org-long',
      });

      await ensureAdminConsoleUser('admin');

      expect(mocks.organisationUpsert).toHaveBeenCalled();
    });

    it('handles null/undefined env vars gracefully', async () => {
      delete process.env.ADMIN_ORG_NUMBER;
      delete process.env.ADMIN_ORG_NAME;

      mocks.organisationUpsert.mockResolvedValue({ id: 'org-default' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-default',
        bankidId: 'admin:admin',
        role: 'ADMIN',
        organisationId: 'org-default',
      });

      await ensureAdminConsoleUser('admin');

      expect(mocks.organisationUpsert).toHaveBeenCalled();
    });

    it('handles various role types in findAuthUserByBankId', async () => {
      const roles = ['ADMIN', 'CONSULTANT', 'AUDITOR', 'REVIEWER'];

      for (const role of roles) {
        mocks.userFindUnique.mockResolvedValueOnce({
          id: `user-${role}`,
          bankidId: `bankid-${role}`,
          role,
          organisationId: 'org-1',
        });

        const result = await findAuthUserByBankId(`bankid-${role}`);

        expect(result?.role).toBe(role);
      }
    });

    it('handles consecutive admin user creations', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-1' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-1',
        bankidId: 'admin:user',
        role: 'ADMIN',
        organisationId: 'org-1',
      });

      for (let i = 0; i < 10; i++) {
        await ensureAdminConsoleUser(`admin${i}`);
      }

      expect(mocks.userUpsert).toHaveBeenCalledTimes(10);
    });

    it('handles case insensitivity in username normalization', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-1' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-case',
        bankidId: 'admin:testuser',
        role: 'ADMIN',
        organisationId: 'org-1',
      });

      await ensureAdminConsoleUser('TESTUSER');

      const call = mocks.userUpsert.mock.calls[0][0];
      expect(call.where.bankidId).toBe('admin:testuser');
    });
  });
});
