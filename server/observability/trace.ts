import { randomUUID } from 'node:crypto';
import type express from 'express';

export function traceMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const incoming = typeof req.headers['x-trace-id'] === 'string' ? req.headers['x-trace-id'] : '';
    const traceId = incoming.trim() || randomUUID();
    res.locals.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);
    next();
  };
}

export function traceIdFrom(res: express.Response): string {
  return String((res as any).locals?.traceId || '');
}
