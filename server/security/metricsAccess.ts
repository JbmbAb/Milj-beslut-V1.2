import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

function timingSafeBearerMatch(authHeader: string, token: string): boolean {
  const expected = `Bearer ${token}`;
  if (authHeader.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
}

export function isMetricsAuthorized(req: Request): boolean {
  const metricsToken = String(process.env.METRICS_BEARER_TOKEN || '').trim();
  if (metricsToken) {
    const authHeader = req.headers.authorization ?? '';
    return timingSafeBearerMatch(authHeader, metricsToken);
  }

  const clientIp = req.ip ?? req.socket.remoteAddress ?? '';
  return clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
}

export async function handleMetricsRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!isMetricsAuthorized(req)) {
    if (process.env.METRICS_BEARER_TOKEN) {
      res.status(401).set('WWW-Authenticate', 'Bearer').end();
    } else {
      res.status(403).end();
    }
    return;
  }

  try {
    const { getMetricsText } = await import('../services/metricsService');
    const text = await getMetricsText();
    res.status(200).type('text/plain; version=0.0.4; charset=utf-8').send(text);
  } catch (error) {
    next(error);
  }
}
