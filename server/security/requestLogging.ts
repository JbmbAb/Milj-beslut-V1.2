import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { RequestContext } from '../lib/requestContext';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  const headerId = (req.headers['x-request-id'] as string) || (req.headers['x-trace-id'] as string);
  const requestId = headerId || crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const userId = req.authUser?.id ?? 'anonymous';

  RequestContext.run({ requestId, userId, startTs: started }, () => {
    res.on('finish', () => {
      const durationMs = Date.now() - started;
      const finalStore = RequestContext.get();
      const finalUserId = req.authUser?.id ?? finalStore?.userId ?? 'anonymous';
      const org = req.authUser?.organisationId ?? 'none';
      logger.info('http_access', {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
        userId: finalUserId,
        organisationId: org,
      });
    });

    next();
  });
}

