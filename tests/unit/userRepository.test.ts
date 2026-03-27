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

import {
  findAuthUserByBankId,
  ensureAdminConsoleUser,
} from '../../server/repositories/userRepository';

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
        create: { name: 'Miljobeslut Admin', orgNumber: '999999-0001' },
        update: { name: 'Miljobeslut Admin' },
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
  });
});
