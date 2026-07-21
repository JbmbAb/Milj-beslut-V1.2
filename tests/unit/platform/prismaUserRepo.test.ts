import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaUserRepository } from '../../../src/infrastructure/prisma-user-repository';
import { prisma } from '../../../db.server';

vi.mock('../../../db.server', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    organisation: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('PrismaUserRepository', () => {
  let repo: PrismaUserRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaUserRepository();
  });

  describe('findByBankId', () => {
    it('should return null if user not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce(null);
      const result = await repo.findByBankId('123');
      expect(result).toBeNull();
    });

    it('should return user info if found', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'u1',
        role: 'ADMIN',
        organisationId: 'o1',
        bankidId: '123',
      });
      const result = await repo.findByBankId('123');
      expect(result?.id).toBe('u1');
    });
  });

  describe('ensureMockUser', () => {
    it('should create mock user with existing org', async () => {
      (prisma.organisation.findFirst as any).mockResolvedValueOnce({ id: 'o1' });
      (prisma.user.upsert as any).mockResolvedValueOnce({
        id: 'u1',
        role: 'ADMIN',
        organisationId: 'o1',
        bankidId: '123',
      });

      const result = await repo.ensureMockUser('123');
      expect(result.organisationId).toBe('o1');
      expect(prisma.organisation.create).not.toHaveBeenCalled();
    });

    it('should create mock user and org if org missing', async () => {
      (prisma.organisation.findFirst as any).mockResolvedValueOnce(null);
      (prisma.organisation.create as any).mockResolvedValueOnce({ id: 'new-org' });
      (prisma.user.upsert as any).mockResolvedValueOnce({
        id: 'u1',
        role: 'ADMIN',
        organisationId: 'new-org',
        bankidId: '123',
      });

      const result = await repo.ensureMockUser('123');
      expect(result.organisationId).toBe('new-org');
      expect(prisma.organisation.create).toHaveBeenCalled();
    });
  });
});
