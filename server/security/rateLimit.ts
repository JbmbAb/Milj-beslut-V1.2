import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
  lastHit: number;
}

const buckets = new Map<string, Bucket>();

export const _resetBuckets = () => buckets.clear();

const MAX_BUCKETS = 10_000;

function cleanupBuckets(now: number): void {
  // Remove expired buckets first.
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  // If still too large, evict least-recently-hit entries (best-effort).
  if (buckets.size <= MAX_BUCKETS) return;
  const entries = Array.from(buckets.entries());
  entries.sort((a, b) => a[1].lastHit - b[1].lastHit);
  const toRemove = buckets.size - MAX_BUCKETS;
  for (let i = 0; i < toRemove; i += 1) {
    buckets.delete(entries[i][0]);
  }
}

function hit(key: string, max: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const current = buckets.get(key);
  const active =
    !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs, lastHit: now } : current;
  active.count += 1;
  active.lastHit = now;
  buckets.set(key, active);

  if (buckets.size > MAX_BUCKETS) cleanupBuckets(now);

  const remaining = Math.max(0, max - active.count);
  return {
    allowed: active.count <= max,
    remaining,
    resetAt: active.resetAt,
  };
}

function setRateLimitHeaders(res: Response, decision: { remaining: number; resetAt: number }): void {
  res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(decision.resetAt / 1000)));
}

function setRetryAfterHeader(res: Response, resetAt: number, nowMs: number): void {
  const retryAfterSeconds = Math.max(0, Math.ceil((resetAt - nowMs) / 1000));
  res.setHeader("Retry-After", String(retryAfterSeconds));
}

export function rateLimitByUser(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.authUser?.role === "ADMIN") {
      next();
      return;
    }
    const subject = req.authUser?.id || req.ip || "anonymous";
    const key = `u:${subject}:${req.path}`;
    const nowMs = Date.now();
    const decision = hit(key, max, windowMs);

    setRateLimitHeaders(res, decision);
    if (!decision.allowed) {
      setRetryAfterHeader(res, decision.resetAt, nowMs);
      res.status(429).json({ ok: false, error: "Rate limit exceeded" });
      return;
    }
    next();
  };
}

export function rateLimitByOrg(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.authUser?.role === "ADMIN") {
      next();
      return;
    }
    const org = req.authUser?.organisationId || "none";
    const key = `o:${org}:${req.path}`;
    const nowMs = Date.now();
    const decision = hit(key, max, windowMs);
    setRateLimitHeaders(res, decision);
    if (!decision.allowed) {
      setRetryAfterHeader(res, decision.resetAt, nowMs);
      res.status(429).json({ ok: false, error: "Organisation quota exceeded" });
      return;
    }
    next();
  };
}
