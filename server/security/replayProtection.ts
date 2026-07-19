/**
 * BankID Anti-Replay Protection
 *
 * Prevents attackers from replaying BankID authentication tokens.
 * Uses a nonce-based system with timestamp validation.
 */

import crypto from 'node:crypto';

interface ReplayTokenRecord {
  orderRef: string;
  nonce: string;
  timestamp: number;
  ipAddress: string;
  used: boolean;
  completedAt?: number;
}

/**
 * In-memory replay token cache with TTL
 * In production, this should use Redis for distributed systems
 */
class ReplayTokenCache {
  private tokens = new Map<string, ReplayTokenRecord>();
  private readonly TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_CACHE_SIZE = 10000; // Prevent memory exhaustion
  private cleanupInterval: any;

  constructor() {
    // Clean up expired tokens every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Register a new BankID authentication attempt
   */
  register(orderRef: string, ipAddress: string): { nonce: string } {
    if (this.tokens.has(orderRef)) {
      throw new Error(`BankID order ${orderRef} already registered`);
    }

    // Check cache size to prevent memory exhaustion
    if (this.tokens.size >= this.MAX_CACHE_SIZE) {
      this.cleanup(); // Force cleanup
      if (this.tokens.size >= this.MAX_CACHE_SIZE * 0.9) {
        throw new Error('Too many active authentication sessions');
      }
    }

    const nonce = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    this.tokens.set(orderRef, {
      orderRef,
      nonce,
      timestamp: now,
      ipAddress,
      used: false,
    });

    return { nonce };
  }

  /**
   * Validate and mark a token as used (anti-replay check)
   * @throws Error if token is invalid, expired, or already used
   */
  validateAndMark(orderRef: string, ipAddress: string): void {
    const record = this.tokens.get(orderRef);

    if (!record) {
      throw new Error(`Unknown BankID order: ${orderRef}`);
    }

    const now = Date.now();
    const age = now - record.timestamp;

    // Check token age (15 minute window)
    if (age > this.TOKEN_TTL_MS) {
      throw new Error('BankID authentication session expired');
    }

    // Check if already used (anti-replay)
    if (record.used) {
      throw new Error('BankID authentication token already used (replay attack detected)');
    }

    // Check IP address matches (optional but recommended)
    // This is a heuristic - allow if it's changed (mobile network switching)
    // but flag it for audit trail
    if (record.ipAddress !== ipAddress) {
      // Log for audit trail but don't block - mobile users switch networks
      console.warn(
        `[AUDIT] BankID collect from different IP: initial=${record.ipAddress}, current=${ipAddress}, orderRef=${orderRef}`,
      );
    }

    // Mark as used
    record.used = true;
    record.completedAt = now;
    this.tokens.set(orderRef, record);
  }

  /**
   * Check if a token has already been used
   */
  isUsed(orderRef: string): boolean {
    const record = this.tokens.get(orderRef);
    return record?.used ?? false;
  }

  /**
   * Get token info for debugging/audit
   */
  getInfo(orderRef: string): ReplayTokenRecord | undefined {
    return this.tokens.get(orderRef);
  }

  /**
   * Clean up expired tokens
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [orderRef, record] of this.tokens.entries()) {
      if (now - record.timestamp > this.TOKEN_TTL_MS) {
        this.tokens.delete(orderRef);
        removed++;
      }
    }

    if (removed > 0) {
      console.debug(`[BankID] Cleaned up ${removed} expired tokens`);
    }
  }

  /**
   * Clear all tokens (for testing or shutdown)
   */
  clear(): void {
    this.tokens.clear();
  }

  /**
   * Get cache stats for monitoring
   */
  getStats() {
    return {
      totalTokens: this.tokens.size,
      usedTokens: Array.from(this.tokens.values()).filter((t) => t.used).length,
      pendingTokens: Array.from(this.tokens.values()).filter((t) => !t.used).length,
    };
  }

  /**
   * Shutdown cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}

/**
 * Global instance of replay token cache
 * In production, consider using Redis for distributed setups
 */
let replayCache: ReplayTokenCache | null = null;

export function getReplayTokenCache(): ReplayTokenCache {
  if (!replayCache) {
    replayCache = new ReplayTokenCache();
  }
  return replayCache;
}

export function shutdownReplayTokenCache(): void {
  if (replayCache) {
    replayCache.destroy();
    replayCache = null;
  }
}

/**
 * Exported for testing - allows replacing the cache
 */
export function setReplayTokenCacheForTesting(cache: ReplayTokenCache): void {
  if (replayCache) {
    replayCache.destroy();
  }
  replayCache = cache;
}
