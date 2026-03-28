import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const durationMs = Date.now() - started;
    const userId = req.authUser?.id ?? "anonymous";
    const org = req.authUser?.organisationId ?? "none";
    logger.info("http_access", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      userId,
      organisationId: org,
    });
  });

  next();
}
