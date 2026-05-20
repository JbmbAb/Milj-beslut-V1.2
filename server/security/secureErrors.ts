import { logger } from '../logger';

/**
 * Secure error handling for production environments.
 * Prevents information disclosure while maintaining audit trail.
 */

export class SecureError extends Error {
  constructor(
    message: string,
    public readonly publicMessage: string = 'Internal server error',
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'SecureError';
  }
}

/**
 * Converts errors to safe, user-facing messages.
 * Internal errors are logged but never exposed to clients.
 */
export function toSafeErrorResponse(error: unknown): {
  ok: false;
  error: string;
  details?: string;
  code?: string;
  statusCode?: number;
} {
  if (error instanceof SecureError) {
    return {
      ok: false,
      error: error.publicMessage,
      code: error.statusCode.toString(),
      statusCode: error.statusCode,
    };
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Default status codes for standard error types
    let statusCode = 500;
    let publicMessage = 'An error occurred processing your request';
    let code: string | undefined = undefined;

    if (msg.includes('not found')) {
      statusCode = 404;
      publicMessage = 'Resource not found';
    } else if (msg.includes('unauthorized') || msg.includes('permission') || msg.includes('access denied')) {
      statusCode = 403;
      publicMessage = 'Access denied';
    } else if (msg.includes('invalid') && msg.includes('token')) {
      statusCode = 401;
      publicMessage = 'Authentication failed';
    } else if (msg.includes('expired')) {
      statusCode = 401;
      publicMessage = 'Session expired';
    } else if (msg.includes('live_lantmateriet_required')) {
      statusCode = 503;
      publicMessage = 'Lantmateriet live-uppslag ar inte konfigurerat. Endast BankID far vara mock/demo.';
      code = 'LIVE_LANTMATERIET_REQUIRED';
    } else if (msg.includes('fastighet hittades inte')) {
      statusCode = 404;
      publicMessage = 'Fastighet hittades inte hos Lantmateriet.';
      code = 'PROPERTY_NOT_FOUND';
    }

    return { ok: false, error: publicMessage, code, statusCode };
  }

  return { ok: false, error: 'Unknown error', statusCode: 500 };
}

/**
 * Middleware to catch and safely handle errors in Express routes.
 * Ensures no stack traces or sensitive info leak to client.
 */
export function secureErrorHandler(err: unknown, req: any, res: any, _next: any) {
  const response = toSafeErrorResponse(err);
  const statusCode = response.statusCode || 500;

  logger.error('secureErrorHandler caught error', {
    path: req?.path,
    method: req?.method,
    statusCode,
    error: err instanceof Error ? err.message : String(err),
  });

  // Remove statusCode from body if you want clean API responses
  const { statusCode: _, ...body } = response;
  res.status(statusCode).json(body);
}
