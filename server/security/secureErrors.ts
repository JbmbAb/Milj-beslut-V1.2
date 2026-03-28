/**
 * Secure error handling for production environments.
 * Prevents information disclosure while maintaining audit trail.
 */

export class SecureError extends Error {
  constructor(
    message: string,
    public readonly publicMessage: string = "Internal server error",
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "SecureError";
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
} {
  if (error instanceof SecureError) {
    return {
      ok: false,
      error: error.publicMessage,
      code: error.statusCode.toString(),
    };
  }

  if (error instanceof Error) {
    // Map known error types to safe messages
    if (error.message.includes("not found")) {
      return { ok: false, error: "Resource not found" };
    }
    if (error.message.includes("unauthorized") || error.message.includes("permission")) {
      return { ok: false, error: "Access denied" };
    }
    if (error.message.includes("invalid") && error.message.includes("token")) {
      return { ok: false, error: "Authentication failed" };
    }
    if (error.message.includes("expired")) {
      return { ok: false, error: "Session expired" };
    }
    if (error.message.includes("reuse")) {
      return { ok: false, error: "Session security check failed - please login again" };
    }

    // Generic fallback for other errors
    return { ok: false, error: "An error occurred processing your request" };
  }

  return { ok: false, error: "Unknown error" };
}

/**
 * Middleware to catch and safely handle errors in Express routes.
 * Ensures no stack traces or sensitive info leak to client.
 */
export function secureErrorHandler(
  err: unknown,
  req: any,
  res: any,
  _next: any
) {
  const response = toSafeErrorResponse(err);
  const statusCode =
    err instanceof SecureError ? err.statusCode : 500;

  res.status(statusCode).json(response);
}
