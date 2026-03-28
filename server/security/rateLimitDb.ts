import { prisma } from "../db/prisma";

/**
 * Database-backed rate limiting for distributed deployments.
 * Replaces in-memory tracking which doesn't work across multiple server instances.
 */

interface RateLimitEntry {
  id: string;
  key: string; // "user:{userId}" or "org:{orgId}"
  count: number;
  resetAt: Date;
}

/**
 * Check rate limit for a user or organization.
 * Returns { allowed, remainingAttempts, resetAt }
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  resetAt: Date;
}> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  // Clean up old entries first
  await cleanupExpiredRateLimits();

  // Try to fetch existing entry
  const entry = await getRateLimitEntry(key);

  if (!entry) {
    // Create new entry
    await createRateLimitEntry(key, resetAt);
    return {
      allowed: true,
      remainingAttempts: maxAttempts - 1,
      resetAt,
    };
  }

  // Check if window has passed
  if (entry.resetAt < now) {
    // Reset the entry
    await resetRateLimitEntry(key, resetAt);
    return {
      allowed: true,
      remainingAttempts: maxAttempts - 1,
      resetAt,
    };
  }

  // Check if limit exceeded
  if (entry.count >= maxAttempts) {
    return {
      allowed: false,
      remainingAttempts: 0,
      resetAt: entry.resetAt,
    };
  }

  // Increment counter
  await incrementRateLimitCount(key);

  return {
    allowed: true,
    remainingAttempts: maxAttempts - entry.count - 1,
    resetAt: entry.resetAt,
  };
}

/**
 * Internal: fetch current rate limit entry
 */
async function getRateLimitEntry(key: string): Promise<RateLimitEntry | null> {
  const entry = await prisma.rateLimitEntry.findUnique({
    where: { key },
  });

  if (!entry) return null;

  return {
    id: entry.id,
    key: entry.key,
    count: entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Internal: create new rate limit entry
 */
async function createRateLimitEntry(key: string, resetAt: Date): Promise<void> {
  await prisma.rateLimitEntry.create({
    data: {
      key,
      count: 1,
      resetAt,
    },
  });
}

/**
 * Internal: increment rate limit counter
 */
async function incrementRateLimitCount(key: string): Promise<void> {
  await prisma.rateLimitEntry.update({
    where: { key },
    data: {
      count: {
        increment: 1,
      },
    },
  });
}

/**
 * Internal: reset rate limit entry
 */
async function resetRateLimitEntry(key: string, resetAt: Date): Promise<void> {
  await prisma.rateLimitEntry.update({
    where: { key },
    data: {
      count: 1,
      resetAt,
    },
  });
}

/**
 * Clean up expired rate limit entries (periodic maintenance)
 */
async function cleanupExpiredRateLimits(): Promise<number> {
  const result = await prisma.rateLimitEntry.deleteMany({
    where: {
      resetAt: {
        lt: new Date(),
      },
    },
  });

  return result.count;
}

/**
 * Manual reset for testing or admin override
 */
export async function resetRateLimitForKey(key: string): Promise<void> {
  await prisma.rateLimitEntry.delete({
    where: { key },
  }).catch(() => {
    // Ignore if not found
  });
}

/**
 * Get all active rate limits (for monitoring/debugging)
 */
export async function getActiveRateLimits(): Promise<RateLimitEntry[]> {
  const entries = await prisma.rateLimitEntry.findMany({
    where: {
      resetAt: {
        gt: new Date(),
      },
    },
  });

  return entries.map((e) => ({
    id: e.id,
    key: e.key,
    count: e.count,
    resetAt: e.resetAt,
  }));
}
