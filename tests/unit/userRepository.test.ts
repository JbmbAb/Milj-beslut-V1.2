import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  organisation: {
    upsert: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma }));

import { ensureAdminConsoleUser, findAuthUserByBankId } from '../../server/repositories/userRepository';

describe('userRepository', () => {
  const originalAdminOrgNumber = process.env.ADMIN_ORG_NUMBER;
  const originalAdminOrgName = process.env.ADMIN_ORG_NAME;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_ORG_NUMBER;
    delete process.env.ADMIN_ORG_NAME;
  });

  afterEach(() => {
    process.env.ADMIN_ORG_NUMBER = originalAdminOrgNumber;
    process.env.ADMIN_ORG_NAME = originalAdminOrgName;
  });

  it('returns null when no auth user matches the supplied BankID', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(findAuthUserByBankId('bankid-1')).resolves.toBeNull();
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { bankidId: 'bankid-1' },
      select: {
        id: true,
        bankidId: true,
        role: true,
        organisationId: true,
      },
    });
  });

  it('maps a found auth user to the safe auth shape', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      bankidId: 'bankid-2',
      role: 'CONSULTANT',
      organisationId: 'org-1',
    });

    await expect(findAuthUserByBankId('bankid-2')).resolves.toEqual({
      id: 'user-1',
      bankidId: 'bankid-2',
      role: 'CONSULTANT',
      organisationId: 'org-1',
    });
  });

  it('ensures an admin console user using defaults and normalized username', async () => {
    prisma.organisation.upsert.mockResolvedValue({ id: 'org-admin' });
    prisma.user.upsert.mockResolvedValue({
      id: 'user-admin',
      bankidId: 'admin:alice',
      role: 'ADMIN',
      organisationId: 'org-admin',
    });

    await expect(ensureAdminConsoleUser('  Alice  ')).resolves.toEqual({
      id: 'user-admin',
      bankidId: 'admin:alice',
      role: 'ADMIN',
      organisationId: 'org-admin',
    });

    expect(prisma.organisation.upsert).toHaveBeenCalledWith({
      where: { orgNumber: '999999-0001' },
      create: {
        name: 'Miljobeslut Admin',
        orgNumber: '999999-0001',
      },
      update: {
        name: 'Miljobeslut Admin',
      },
      select: { id: true },
    });

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { bankidId: 'admin:alice' },
      create: {
        bankidId: 'admin:alice',
        organisationId: 'org-admin',
        role: 'ADMIN',
      },
      update: {
        organisationId: 'org-admin',
        role: 'ADMIN',
      },
      select: {
        id: true,
        bankidId: true,
        role: true,
        organisationId: true,
      },
    });
  });

  it('uses configured admin organisation values and falls back to admin username', async () => {
    process.env.ADMIN_ORG_NUMBER = '556677-8899';
    process.env.ADMIN_ORG_NAME = 'Configured Admin Org';

    prisma.organisation.upsert.mockResolvedValue({ id: 'org-configured' });
    prisma.user.upsert.mockResolvedValue({
      id: 'user-configured',
      bankidId: 'admin:admin',
      role: 'ADMIN',
      organisationId: 'org-configured',
    });

    await ensureAdminConsoleUser('   ');

    expect(prisma.organisation.upsert).toHaveBeenCalledWith({
      where: { orgNumber: '556677-8899' },
      create: {
        name: 'Configured Admin Org',
        orgNumber: '556677-8899',
      },
      update: {
        name: 'Configured Admin Org',
      },
      select: { id: true },
    });
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bankidId: 'admin:admin' },
      }),
    );
  });

  it('falls back to admin when username is missing entirely', async () => {
    prisma.organisation.upsert.mockResolvedValue({ id: 'org-missing' });
    prisma.user.upsert.mockResolvedValue({
      id: 'user-missing',
      bankidId: 'admin:admin',
      role: 'ADMIN',
      organisationId: 'org-missing',
    });

    await ensureAdminConsoleUser(undefined as unknown as string);

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bankidId: 'admin:admin' },
      }),
    );
  });
});
