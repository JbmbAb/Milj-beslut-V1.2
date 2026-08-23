import { describe, it, expect, beforeEach, vi } from 'vitest';
import { persistentReplayProtection } from '../../server/security/persistentReplayProtection';
import { prisma } from '../../server/db/prisma';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    bankIdSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('Persistent Replay Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerSession()', () => {
    it('should register a new BankID session with a nonce', async () => {
      (prisma.bankIdSession.create as any).mockResolvedValue({});

      const { nonce } = await persistentReplayProtection.registerSession('order-123', '192.168.1.1', 'PRODUCTION');

      expect(nonce).toBeDefined();
      expect(nonce.length).toBeGreaterThan(30);
      expect(prisma.bankIdSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderRef: 'order-123',
          ipAddress: '192.168.1.1',
          status: 'PENDING',
        }),
      });
    });
  });

  describe('validateAndComplete()', () => {
    it('should validate and complete a pending session', async () => {
      const session = {
        orderRef: 'order-123',
        ipAddress: '192.168.1.1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
      };

      (prisma.bankIdSession.findUnique as any)
        .mockResolvedValueOnce(session) // Initial lookup
        .mockResolvedValueOnce(null); // Global signature check

      await persistentReplayProtection.validateAndComplete({
        orderRef: 'order-123',
        ipAddress: '192.168.1.1',
        bankidId: 'user-123',
        signature: 'valid-sig',
      });

      expect(prisma.bankIdSession.update).toHaveBeenCalledWith({
        where: { orderRef: 'order-123' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          bankidId: 'user-123',
        }),
      });
    });

    it('should throw error if session not found', async () => {
      (prisma.bankIdSession.findUnique as any).mockResolvedValue(null);

      await expect(
        persistentReplayProtection.validateAndComplete({
          orderRef: 'unknown',
          ipAddress: '1.1.1.1',
          bankidId: 'u',
          signature: 's',
        }),
      ).rejects.toThrow('Invalid BankID session');
    });

    it('should prevent replay of already completed session', async () => {
      const session = {
        orderRef: 'order-123',
        status: 'COMPLETED',
        expiresAt: new Date(Date.now() + 60000),
      };

      (prisma.bankIdSession.findUnique as any).mockResolvedValue(session);

      await expect(
        persistentReplayProtection.validateAndComplete({
          orderRef: 'order-123',
          ipAddress: '1.1.1.1',
          bankidId: 'u',
          signature: 's',
        }),
      ).rejects.toThrow('replay detected');
    });

    it('should prevent global signature replay', async () => {
      const session = {
        orderRef: 'order-new',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
      };

      (prisma.bankIdSession.findUnique as any)
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce({ orderRef: 'order-old' }); // Signature already used elsewhere

      await expect(
        persistentReplayProtection.validateAndComplete({
          orderRef: 'order-new',
          ipAddress: '1.1.1.1',
          bankidId: 'u',
          signature: 'reused-sig',
        }),
      ).rejects.toThrow('Signature already used');
    });

    it('should detect expired sessions', async () => {
      const session = {
        orderRef: 'order-old',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
      };

      (prisma.bankIdSession.findUnique as any).mockResolvedValue(session);

      await expect(
        persistentReplayProtection.validateAndComplete({
          orderRef: 'order-old',
          ipAddress: '1.1.1.1',
          bankidId: 'u',
          signature: 's',
        }),
      ).rejects.toThrow('expired');
    });
  });

  describe('cleanup()', () => {
    it('should delete expired sessions from database', async () => {
      (prisma.bankIdSession.deleteMany as any).mockResolvedValue({ count: 5 });

      const count = await persistentReplayProtection.cleanup();

      expect(count).toBe(5);
      expect(prisma.bankIdSession.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });
  });
});
