import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function hit(key: string, max: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const current = buckets.get(key);
  const active = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  active.count += 1;
  buckets.set(key, active);

  const remaining = Math.max(0, max - active.count);
  return {
    allowed: active.count <= max,
    remaining,
    resetAt: active.resetAt,
  };
}

export function rateLimitByUser(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const subject = req.authUser?.id || req.ip || "anonymous";
    const key = `u:${subject}:${req.path}`;
    const decision = hit(key, max, windowMs);

    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(decision.resetAt / 1000)));
    if (!decision.allowed) {
      res.status(429).json({ ok: false, error: "Rate limit exceeded" });
      return;
    }
    next();
  };
}

export function rateLimitByOrg(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const org = req.authUser?.organisationId || "none";
    const key = `o:${org}:${req.path}`;
    const decision = hit(key, max, windowMs);
    if (!decision.allowed) {
      res.status(429).json({ ok: false, error: "Organisation quota exceeded" });
      return;
    }
    next();
  };
}
