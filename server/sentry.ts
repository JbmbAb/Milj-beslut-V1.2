/**
 * Sentry Error Tracking Setup
 * Captures and monitors errors in production
 */

import * as Sentry from '@sentry/node';
import type { Express } from 'express';

/**
 * Initialize Sentry for error tracking
 */
export const initializeSentry = (app: Express) => {
  const sentryDsn = process.env.SENTRY_DSN;

  if (!sentryDsn) {
    console.warn('[Sentry] SENTRY_DSN not configured, error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    attachStacktrace: true,
  });

  // Sentry v10 no longer exposes the older Handlers/Integrations API shape
  // used in this repo. We keep initialization lightweight until the Express
  // integration is wired through the newer SDK pattern.
  app.use((_req, _res, next) => next());

  console.log('[Sentry] Error tracking initialized');
};

/**
 * Capture error manually
 */
export const captureException = (error: unknown, context?: Record<string, unknown>) => {
  Sentry.captureException(error, {
    contexts: {
      custom: context || {},
    },
  });
};

/**
 * Capture message
 */
export const captureMessage = (message: string, level: 'fatal' | 'error' | 'warning' | 'info' = 'info') => {
  Sentry.captureMessage(message, level);
};

/**
 * Add context to current scope
 */
export const addContext = (key: string, value: unknown) => {
  // The current lightweight integration path does not keep a mutable request
  // scope. We emit a breadcrumb-like message instead of mutating SDK state.
  Sentry.captureMessage(`[context] ${key}`, 'info');
  void value;
};

export default Sentry;
