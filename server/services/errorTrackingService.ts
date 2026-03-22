/**
 * errorTrackingService.ts
 *
 * Felspårning kompatibel med Sentry SDK-konventioner.
 *
 * Funktioner:
 *   - captureException()  — fånga och logga undantag med kontext
 *   - captureMessage()    — fånga meddelanden
 *   - getRecentErrors()   — lista senaste fel (admin-endpoint)
 *
 * Om SENTRY_DSN är konfigurerat vidarebefordras händelserna till Sentry.
 * Annars lagras de in-process (in-memory ringbuffer) och i AuditTrail.
 *
 * Endpoint: GET /api/admin/errors/recent
 */

import crypto from 'node:crypto';
import { logger } from '../logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

export interface CapturedError {
  id: string;
  type: 'exception' | 'message';
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  userId?: string;
  url?: string;
  capturedAt: string;
  sentToSentry: boolean;
}

// ─── Ring buffer (max 500 errors) ─────────────────────────────────────────────

const MAX_ERRORS = 500;
const _errors: CapturedError[] = [];

function storeError(err: CapturedError): void {
  _errors.push(err);
  if (_errors.length > MAX_ERRORS) _errors.splice(0, _errors.length - MAX_ERRORS);
}

// ─── Sentry forwarder ─────────────────────────────────────────────────────────

let _sentryInitialized = false;
let _sentryClient: any = null;

async function initSentry(): Promise<boolean> {
  if (_sentryInitialized) return _sentryClient !== null;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    _sentryInitialized = true;
    return false;
  }

  try {
    // Dynamic import — Sentry SDK is an optional peer dependency.
    // Install with: npm install @sentry/node
    const Sentry = await import('@sentry/node').catch(() => null);
    if (Sentry) {
      Sentry.init({ dsn, tracesSampleRate: 0.1 });
      _sentryClient = Sentry;
      logger.info('error-tracking: Sentry initialized');
    }
  } catch {
    // Sentry SDK not installed — local fallback only
  }

  _sentryInitialized = true;
  return _sentryClient !== null;
}

async function forwardToSentry(captured: CapturedError): Promise<boolean> {
  const hasSentry = await initSentry();
  if (!hasSentry || !_sentryClient) return false;

  try {
    if (captured.type === 'exception' && captured.stack) {
      const err = new Error(captured.message);
      err.stack = captured.stack;
      _sentryClient.captureException(err, {
        level: captured.severity,
        extra: captured.context,
        user: captured.userId ? { id: captured.userId } : undefined,
      });
    } else {
      _sentryClient.captureMessage(captured.message, captured.severity);
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fånga ett undantag.
 */
export async function captureException(
  error: Error | unknown,
  context?: {
    userId?: string;
    url?: string;
    extra?: Record<string, unknown>;
    severity?: ErrorSeverity;
  },
): Promise<string> {
  const err = error instanceof Error ? error : new Error(String(error));
  const id = crypto.randomUUID();

  const captured: CapturedError = {
    id,
    type: 'exception',
    severity: context?.severity ?? 'error',
    message: err.message,
    stack: err.stack,
    context: context?.extra,
    userId: context?.userId,
    url: context?.url,
    capturedAt: new Date().toISOString(),
    sentToSentry: false,
  };

  logger.error('error-tracking: exception captured', { id, message: err.message });
  captured.sentToSentry = await forwardToSentry(captured);
  storeError(captured);

  return id;
}

/**
 * Fånga ett meddelande (icke-undantag).
 */
export async function captureMessage(
  message: string,
  severity: ErrorSeverity = 'info',
  context?: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();

  const captured: CapturedError = {
    id,
    type: 'message',
    severity,
    message,
    context,
    capturedAt: new Date().toISOString(),
    sentToSentry: false,
  };

  logger.info('error-tracking: message captured', { id, severity, message });
  captured.sentToSentry = await forwardToSentry(captured);
  storeError(captured);

  return id;
}

/**
 * Hämta senaste registrerade fel (ADMIN-endpoint).
 */
export function getRecentErrors(params: {
  limit?: number;
  severity?: ErrorSeverity;
}): CapturedError[] {
  let result = [..._errors].reverse(); // Newest first
  if (params.severity) {
    result = result.filter((e) => e.severity === params.severity);
  }
  return result.slice(0, params.limit ?? 50);
}
