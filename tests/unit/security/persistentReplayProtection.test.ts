import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistentReplayProtection } from '../../../server/security/persistentReplayProtection';
import { prisma } from '../../../server/db/prisma';

vi.mock('../../../server/db/prisma', () => ({
  prisma: {
    bankIdSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('PersistentReplayProtection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a new session with a nonce', async () => {
    const orderRef = 'order-123';
    const ipAddress = '127.0.0.1';

    (prisma.bankIdSession.create as any).mockResolvedValue({});

    const { nonce } = await persistentReplayProtection.registerSession(orderRef, ipAddress);

    expect(nonce).toBeDefined();
    expect(nonce.length).toBeGreaterThan(20);
    expect(prisma.bankIdSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderRef,
        ipAddress,
        status: 'PENDING',
      }),
    });
  });

  it('completes a valid session', async () => {
    const orderRef = 'order-123';
    const signature = 'base64-sig-data';
    const session = {
      orderRef,
      nonce: 'nonce-123',
      ipAddress: '127.0.0.1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 10000),
    };

    (prisma.bankIdSession.findUnique as any)
      .mockResolvedValueOnce(session) // For session lookup
      .mockResolvedValueOnce(null); // For global signature replay check

    (prisma.bankIdSession.update as any).mockResolvedValue({});

    await expect(
      persistentReplayProtection.validateAndComplete({
        orderRef,
        ipAddress: '127.0.0.1',
        bankidId: 'user-123',
        signature,
      }),
    ).resolves.not.toThrow();

    expect(prisma.bankIdSession.update).toHaveBeenCalledWith({
      where: { orderRef },
      data: expect.objectContaining({
        status: 'COMPLETED',
        bankidId: 'user-123',
      }),
    });
  });

  it('detects replay of processed orderRef', async () => {
    const orderRef = 'order-123';
    const session = {
      orderRef,
      status: 'COMPLETED',
      expiresAt: new Date(Date.now() + 10000),
    };

    (prisma.bankIdSession.findUnique as any).mockResolvedValue(session);

    await expect(
      persistentReplayProtection.validateAndComplete({
        orderRef,
        ipAddress: '127.0.0.1',
        bankidId: 'user-123',
        signature: 'sig',
      }),
    ).rejects.toThrow('replay detected');
  });

  it('detects global signature replay', async () => {
    const orderRef = 'order-new';
    const signature = 'reused-signature';
    const session = {
      orderRef,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 10000),
    };

    // First call: session exists
    // Second call: signatureHash already exists in another session
    (prisma.bankIdSession.findUnique as any)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ orderRef: 'order-old' });

    await expect(
      persistentReplayProtection.validateAndComplete({
        orderRef,
        ipAddress: '127.0.0.1',
        bankidId: 'user-123',
        signature,
      }),
    ).rejects.toThrow('Signature already used');
  });

  it('detects expired sessions', async () => {
    const orderRef = 'order-expired';
    const session = {
      orderRef,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 10000),
    };

    (prisma.bankIdSession.findUnique as any).mockResolvedValue(session);

    await expect(
      persistentReplayProtection.validateAndComplete({
        orderRef,
        ipAddress: '127.0.0.1',
        bankidId: 'user-123',
        signature: 'sig',
      }),
    ).rejects.toThrow('expired');
  });
});
