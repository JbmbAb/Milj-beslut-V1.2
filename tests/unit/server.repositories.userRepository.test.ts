import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  findAuthUserByBankId,
  ensureAdminConsoleUser,
  ensureMockAuthUser,
} from '../../server/repositories/userRepository';
import { prisma } from '../../server/db/prisma';
import type { AuthUser } from '../../server/security/types';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    organisation: {
      upsert: vi.fn(),
    },
  },
}));

describe('server/repositories/userRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ADMIN_ORG_NUMBER', '999999-0001');
    vi.stubEnv('ADMIN_ORG_NAME', 'Miljöbeslut Admin');
    vi.stubEnv('BANKID_MOCK_ORG_NUMBER', 'MOCK-0001');
    vi.stubEnv('BANKID_MOCK_ORG_NAME', 'Mock BankID Organisation');
    vi.stubEnv('BANKID_MOCK_USER_ROLE', 'ADMIN');
  });

  describe('findAuthUserByBankId', () => {
    it('returns user when found', async () => {
      const bankidId = '199001011234';
      const mockUser = {
        id: 'user1',
        bankidId,
        role: 'CONSULTANT',
        organisationId: 'org1',
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

      const result = await findAuthUserByBankId(bankidId);

      expect(result).toEqual(mockUser as AuthUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { bankidId },
        select: {
          id: true,
          bankidId: true,
          role: true,
          organisationId: true,
        },
      });
    });

    it('returns null when user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await findAuthUserByBankId('nonexistent');

      expect(result).toBeNull();
    });

    it('handles different user roles', async () => {
      const roles: AuthUser['role'][] = ['ADMIN', 'CONSULTANT', 'AUDITOR', 'BANK'];

      for (const role of roles) {
        vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
          id: `user_${role}`,
          bankidId: `bid_${role}`,
          role,
          organisationId: 'org1',
        } as any);

        const result = await findAuthUserByBankId(`bid_${role}`);
        expect(result?.role).toBe(role);
      }
    });

    it('handles database errors', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('DB error'));

      await expect(findAuthUserByBankId('bid1')).rejects.toThrow('DB error');
    });
  });

  describe('ensureAdminConsoleUser', () => {
    it('creates admin user when not exists', async () => {
      const org = { id: 'org_admin' };
      const adminUser = {
        id: 'admin1',
        bankidId: 'admin:testadmin',
        role: 'ADMIN',
        organisationId: 'org_admin',
      };

      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockResolvedValue(adminUser as any);

      const result = await ensureAdminConsoleUser('testadmin');

      expect(result.role).toBe('ADMIN');
      expect(result.bankidId).toContain('admin:');
      expect(prisma.organisation.upsert).toHaveBeenCalled();
      expect(prisma.user.upsert).toHaveBeenCalled();
    });

    it('normalizes username to lowercase', async () => {
      const org = { id: 'org_admin' };
      const adminUser = {
        id: 'admin1',
        bankidId: 'admin:testadmin',
        role: 'ADMIN',
        organisationId: 'org_admin',
      };

      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockResolvedValue(adminUser as any);

      await ensureAdminConsoleUser('TestAdmin');

      const callArgs = vi.mocked(prisma.user.upsert).mock.calls[0][0];
      expect(callArgs.where.bankidId).toBe('admin:testadmin');
    });

    it('defaults to "admin" when username is empty', async () => {
      const org = { id: 'org_admin' };
      const adminUser = {
        id: 'admin1',
        bankidId: 'admin:admin',
        role: 'ADMIN',
        organisationId: 'org_admin',
      };

      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockResolvedValue(adminUser as any);

      await ensureAdminConsoleUser('');

      const callArgs = vi.mocked(prisma.user.upsert).mock.calls[0][0];
      expect(callArgs.where.bankidId).toContain('admin');
    });

    it('uses environment variables for org', async () => {
      vi.stubEnv('ADMIN_ORG_NUMBER', 'CUSTOM-ORG');
      vi.stubEnv('ADMIN_ORG_NAME', 'Custom Admin Org');

      const org = { id: 'org_custom' };
      const adminUser = {
        id: 'admin1',
        bankidId: 'admin:test',
        role: 'ADMIN',
        organisationId: 'org_custom',
      };

      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockResolvedValue(adminUser as any);

      await ensureAdminConsoleUser('test');

      const orgCall = vi.mocked(prisma.organisation.upsert).mock.calls[0][0];
      expect(orgCall.where.orgNumber).toBe('CUSTOM-ORG');
    });
  });

  describe('ensureMockAuthUser', () => {
    it('creates mock user with default role', async () => {
      const org = { id: 'org_mock' };
      const mockUser = {
        id: 'mock_user1',
        bankidId: 'mock_bid_001',
        role: 'ADMIN',
        organisationId: 'org_mock',
      };

      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockResolvedValue(mockUser as any);

      const result = await ensureMockAuthUser('mock_bid_001');

      expect(result.role).toBe('ADMIN');
      expect(result.bankidId).toBe('mock_bid_001');
    });

    it('respects environment variable for mock user role', async () => {
      vi.stubEnv('BANKID_MOCK_USER_ROLE', 'CONSULTANT');

      const org = { id: 'org_mock' };
      const mockUser = {
        id: 'mock_user1',
        bankidId: 'mock_bid_001',
        role: 'CONSULTANT',
        organisationId: 'org_mock',
      };

      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockResolvedValue(mockUser as any);

      const result = await ensureMockAuthUser('mock_bid_001');

      expect(result.role).toBe('CONSULTANT');
    });

    it('uses mock org environment variables', async () => {
      vi.stubEnv('BANKID_MOCK_ORG_NUMBER', 'CUSTOM-MOCK-ORG');
      vi.stubEnv('BANKID_MOCK_ORG_NAME', 'Custom Mock Org');

      const org = { id: 'org_custom_mock' };
      const mockUser = {
        id: 'mock_user1',
        bankidId: 'mock_bid_001',
        role: 'ADMIN',
        organisationId: 'org_custom_mock',
      };

      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockResolvedValue(mockUser as any);

      await ensureMockAuthUser('mock_bid_001');

      const orgCall = vi.mocked(prisma.organisation.upsert).mock.calls[0][0];
      expect(orgCall.where.orgNumber).toBe('CUSTOM-MOCK-ORG');
    });

    it('returns valid AuthUser object', async () => {
      const org = { id: 'org_mock' };
      const mockUser = {
        id: 'mock_user1',
        bankidId: 'mock_bid_001',
        role: 'AUDITOR',
        organisationId: 'org_mock',
      };

      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockResolvedValue(mockUser as any);

      const result = await ensureMockAuthUser('mock_bid_001');

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('bankidId');
      expect(result).toHaveProperty('role');
      expect(result).toHaveProperty('organisationId');
    });

    it('handles database errors during org creation', async () => {
      vi.mocked(prisma.organisation.upsert).mockRejectedValue(new Error('Org creation failed'));

      await expect(ensureMockAuthUser('mock_bid_001')).rejects.toThrow('Org creation failed');
    });

    it('handles database errors during user creation', async () => {
      const org = { id: 'org_mock' };
      vi.mocked(prisma.organisation.upsert).mockResolvedValue(org as any);
      vi.mocked(prisma.user.upsert).mockRejectedValue(new Error('User creation failed'));

      await expect(ensureMockAuthUser('mock_bid_001')).rejects.toThrow('User creation failed');
    });
  });
});
