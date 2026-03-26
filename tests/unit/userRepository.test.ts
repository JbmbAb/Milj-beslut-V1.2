import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

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

import {
  ensureAdminConsoleUser,
  findAuthUserByBankId,
} from '../../server/repositories/userRepository';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('userRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findAuthUserByBankId', () => {
    it('returns mapped AuthUser when user exists', async () => {
      mocks.userFindUnique.mockResolvedValue({
        id: 'user-1',
        bankidId: 'bid-abc',
        role: 'CONSULTANT',
        organisationId: 'org-1',
      });

      const result = await findAuthUserByBankId('bid-abc');

      expect(result).toEqual({
        id: 'user-1',
        bankidId: 'bid-abc',
        role: 'CONSULTANT',
        organisationId: 'org-1',
      });
      expect(mocks.userFindUnique).toHaveBeenCalledWith({
        where: { bankidId: 'bid-abc' },
        select: { id: true, bankidId: true, role: true, organisationId: true },
      });
    });

    it('returns null when user is not found', async () => {
      mocks.userFindUnique.mockResolvedValue(null);

      const result = await findAuthUserByBankId('unknown-bid');

      expect(result).toBeNull();
    });

    it('propagates prisma errors', async () => {
      mocks.userFindUnique.mockRejectedValue(new Error('DB connection failed'));

      await expect(findAuthUserByBankId('bid-x')).rejects.toThrow('DB connection failed');
    });
  });

  describe('ensureAdminConsoleUser', () => {
    it('upserts org and user, returns AuthUser', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-42' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-42',
        bankidId: 'admin:superuser',
        role: 'ADMIN',
        organisationId: 'org-42',
      });

      const result = await ensureAdminConsoleUser('superuser');

      expect(mocks.organisationUpsert).toHaveBeenCalledOnce();
      expect(mocks.userUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bankidId: 'admin:superuser' },
          create: expect.objectContaining({ bankidId: 'admin:superuser', role: 'ADMIN' }),
          update: expect.objectContaining({ role: 'ADMIN' }),
        }),
      );
      expect(result).toEqual({
        id: 'user-42',
        bankidId: 'admin:superuser',
        role: 'ADMIN',
        organisationId: 'org-42',
      });
    });

    it('normalises empty/blank username to "admin"', async () => {
      mocks.organisationUpsert.mockResolvedValue({ id: 'org-1' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-1',
        bankidId: 'admin:admin',
        role: 'ADMIN',
        organisationId: 'org-1',
      });

      await ensureAdminConsoleUser('');

      expect(mocks.userUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { bankidId: 'admin:admin' } }),
      );
    });

    it('uses env variables for org number and name', async () => {
      process.env.ADMIN_ORG_NUMBER = 'TEST-ORG-999';
      process.env.ADMIN_ORG_NAME = 'Test Organisation';

      mocks.organisationUpsert.mockResolvedValue({ id: 'org-env' });
      mocks.userUpsert.mockResolvedValue({
        id: 'user-env',
        bankidId: 'admin:admin',
        role: 'ADMIN',
        organisationId: 'org-env',
      });

      await ensureAdminConsoleUser('admin');

      expect(mocks.organisationUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgNumber: 'TEST-ORG-999' },
          create: expect.objectContaining({ name: 'Test Organisation', orgNumber: 'TEST-ORG-999' }),
        }),
      );

      delete process.env.ADMIN_ORG_NUMBER;
      delete process.env.ADMIN_ORG_NAME;
    });
  });
});
