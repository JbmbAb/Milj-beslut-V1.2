/**
 * BankID Persistent Anti-Replay Protection
 *
 * Uses database to track BankID sessions, nonces and signatures.
 * Prevents replay attacks in distributed environments.
 */

import crypto from 'node:crypto';
import { prisma } from '../db/prisma';
import { logger } from '../logger';

export interface BankIdSessionRecord {
  orderRef: string;
  nonce: string;
  ipAddress: string;
  status: string;
  bankidId?: string | null;
  signatureHash?: string | null;
  expiresAt: Date;
}

class PersistentReplayProtection {
  private readonly SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

  /**
   * Register a new BankID session with a challenge (nonce)
   */
  async registerSession(
    orderRef: string,
    ipAddress: string,
    identityEnvironment: 'MOCK' | 'TEST' | 'PRODUCTION',
  ): Promise<{ nonce: string }> {
    const nonce = crypto.randomBytes(32).toString('base64');
    const expiresAt = new Date(Date.now() + this.SESSION_TTL_MS);

    try {
      await prisma.bankIdSession.create({
        data: {
          orderRef,
          nonce,
          ipAddress,
          identityEnvironment,
          status: 'PENDING',
          expiresAt,
        },
      });
      return { nonce };
    } catch (error) {
      logger.error('Failed to register BankID session', { error, orderRef });
      throw new Error('Security initialization failed');
    }
  }

  /**
   * Validate session and mark as complete
   * Prevents reuse of the same orderRef
   */
  async validateAndComplete(params: {
    orderRef: string;
    ipAddress: string;
    bankidId: string;
    signature: string;
  }): Promise<void> {
    const session = await prisma.bankIdSession.findUnique({
      where: { orderRef: params.orderRef },
    });

    if (!session) {
      throw new Error(`Invalid BankID session: ${params.orderRef}`);
    }

    if (session.status !== 'PENDING') {
      throw new Error('BankID session already processed or failed (replay detected)');
    }

    if (session.expiresAt < new Date()) {
      throw new Error('BankID session expired');
    }

    // Optional: Heuristic check for IP change
    if (session.ipAddress !== params.ipAddress) {
      logger.warn('BankID collect from different IP', {
        orderRef: params.orderRef,
        initialIp: session.ipAddress,
        currentIp: params.ipAddress,
      });
    }

    // Generate signature hash to prevent global signature replay
    const signatureHash = crypto.createHash('sha256').update(params.signature).digest('hex');

    // Check if this signature has been used before (globally)
    const existingSignature = await prisma.bankIdSession.findUnique({
      where: { signatureHash },
    });

    if (existingSignature) {
      logger.error('BankID signature replay detected', {
        orderRef: params.orderRef,
        signatureHash,
      });
      throw new Error('Signature already used (security violation)');
    }

    try {
      await prisma.bankIdSession.update({
        where: { orderRef: params.orderRef },
        data: {
          status: 'COMPLETED',
          bankidId: params.bankidId,
          signatureHash,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to complete BankID session', { error, orderRef: params.orderRef });
      throw new Error('Security finalization failed');
    }
  }

  /**
   * Fail a session
   */
  async failSession(orderRef: string, _reason: string): Promise<void> {
    try {
      await prisma.bankIdSession
        .update({
          where: { orderRef },
          data: {
            status: 'FAILED',
            updatedAt: new Date(),
          },
        })
        .catch(() => {}); // Ignore if not found
    } catch {
      // Silent fail for cleanup
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanup(): Promise<number> {
    const result = await prisma.bankIdSession.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }
}

export const persistentReplayProtection = new PersistentReplayProtection();
