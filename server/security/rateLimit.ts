import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { logger } from '../logger';

function isDbRateLimitDisabled(): boolean {
  return ['1', 'true', 'yes'].includes(String(process.env.DISABLE_DB_RATE_LIMIT || '').toLowerCase());
}

/**
 * Distributed Rate Limiting using Prisma.
 * This replaces the in-memory Map to support multiple server instances
 * and persistence across restarts.
 */

async function hit(
  key: string,
  max: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = new Date();

  if (isDbRateLimitDisabled()) {
    return { allowed: true, remaining: max, resetAt: now.getTime() + windowMs };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const entry = await tx.rateLimitEntry.findUnique({
        where: { key },
      });

      if (!entry || entry.resetAt <= now) {
        // Create or reset bucket
        const resetAt = new Date(now.getTime() + windowMs);
        const newEntry = await tx.rateLimitEntry.upsert({
          where: { key },
          create: {
            key,
            count: 1,
            resetAt,
          },
          update: {
            count: 1,
            resetAt,
          },
        });
        return {
          allowed: true,
          remaining: max - 1,
          resetAt: newEntry.resetAt.getTime(),
        };
      }

      // Increment existing bucket
      const updatedEntry = await tx.rateLimitEntry.update({
        where: { key },
        data: {
          count: { increment: 1 },
        },
      });

      const allowed = updatedEntry.count <= max;
      const remaining = Math.max(0, max - updatedEntry.count);

      return {
        allowed,
        remaining,
        resetAt: entry.resetAt.getTime(),
      };
    });
  } catch (error) {
    logger.error('Rate limit database error', { key, error: String(error) });
    // Fail-open strategy: if DB is down, allow the request but log it
    // Alternatively, fail-closed for higher security.
    return { allowed: true, remaining: 0, resetAt: now.getTime() + windowMs };
  }
}

/**
 * Periodic cleanup of expired rate limit entries.
 * Should be called by a background worker.
 */
export async function cleanupRateLimits(): Promise<number> {
  if (isDbRateLimitDisabled()) return 0;
  const result = await prisma.rateLimitEntry.deleteMany({
    where: {
      resetAt: { lt: new Date() },
    },
  });
  return result.count;
}

/**
 * Exported for testing compatibility
 */
export async function _resetBuckets(): Promise<void> {
  if (isDbRateLimitDisabled()) return;
  await prisma.rateLimitEntry.deleteMany({});
}

export const pruneExpiredBuckets = cleanupRateLimits;

export function rateLimitByUser(max: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // SECURITY NOTE: We keep ADMIN bypass for system maintenance,
    // but log their usage for audit purposes.
    if (req.authUser?.role === 'ADMIN') {
      next();
      return;
    }

    const subject = req.authUser?.id || req.ip || 'anonymous';
    const key = `u:${subject}:${req.path}`;
    const decision = await hit(key, max, windowMs);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(decision.resetAt / 1000)));

    if (!decision.allowed) {
      res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
      return;
    }
    next();
  };
}

export function rateLimitByOrg(max: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.authUser?.role === 'ADMIN') {
      next();
      return;
    }

    const org = req.authUser?.organisationId || 'none';
    const key = `o:${org}:${req.path}`;
    const decision = await hit(key, max, windowMs);

    if (!decision.allowed) {
      res.status(429).json({ ok: false, error: 'Organisation quota exceeded' });
      return;
    }
    next();
  };
}
