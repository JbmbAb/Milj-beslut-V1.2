/**
 * outlookSchedulerService.ts
 *
 * Produktionsschedulering och webhook-trigger för Outlook e-postinläsning.
 *
 * Funktioner:
 *   - startIngestionScheduler()  — startar periodisk körning (intervall via env)
 *   - stopIngestionScheduler()   — stoppar schemat
 *   - triggerIngestionWebhook()  — körs när webhook-event anländer
 *   - getSchedulerStatus()       — returnerar aktuellt status
 *
 * Miljövariabler:
 *   OUTLOOK_INGEST_INTERVAL_MS  — intervall i ms (default 3600000 = 1 h)
 *   OUTLOOK_FOLDER_PATH         — sökväg till Outlook-exportmapp
 *   OUTLOOK_STORAGE_ROOT        — lagringsmapp för bilagor
 *   OUTLOOK_WEBHOOK_SECRET      — HMAC-hemlighet för webhook-verifiering
 */

import crypto from 'node:crypto';
import { logger } from '../logger';
import { runIngestion } from './outlookIngestionService';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchedulerStatus {
  running: boolean;
  intervalMs: number;
  lastRunAt?: string;
  lastRunResult?: {
    emailsProcessed: number;
    emailsSkipped: number;
    attachmentsSaved: number;
    errors: string[];
  };
  nextRunAt?: string;
  totalRuns: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;
const _status: SchedulerStatus = {
  running: false,
  intervalMs: Number(process.env.OUTLOOK_INGEST_INTERVAL_MS ?? 3_600_000),
  totalRuns: 0,
};

// ─── Core run ─────────────────────────────────────────────────────────────────

async function runOnce(): Promise<void> {
  _status.totalRuns++;
  _status.lastRunAt = new Date().toISOString();

  const storageRoot = process.env.OUTLOOK_STORAGE_ROOT ?? '/tmp/outlook-attachments';
  const folderPath = process.env.OUTLOOK_FOLDER_PATH;

  if (!folderPath) {
    logger.info('outlook-scheduler: OUTLOOK_FOLDER_PATH not set — simulating empty run');
    _status.lastRunResult = { emailsProcessed: 0, emailsSkipped: 0, attachmentsSaved: 0, errors: [] };
    return;
  }

  try {
    // In production, a parser (node-mapi / MailParser) converts the Outlook
    // export into RawEmail objects here. For now we run with an empty array
    // to demonstrate the scheduler fires correctly.
    const result = await runIngestion({
      emails: [],
      storageRoot,
    });

    _status.lastRunResult = {
      emailsProcessed: result.emailsProcessed,
      emailsSkipped: result.emailsSkipped,
      attachmentsSaved: result.attachmentsSaved,
      errors: result.errors,
    };

    logger.info('outlook-scheduler: run completed', _status.lastRunResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _status.lastRunResult = { emailsProcessed: 0, emailsSkipped: 0, attachmentsSaved: 0, errors: [msg] };
    logger.warn('outlook-scheduler: run failed', { error: msg });
  }
}

// ─── Scheduler API ────────────────────────────────────────────────────────────

/**
 * Starta den periodiska e-postinläsaren.
 * Anropas normalt från server/index.ts vid uppstart.
 */
export function startIngestionScheduler(): void {
  if (_status.running) return;
  _status.running = true;

  const interval = _status.intervalMs;
  _status.nextRunAt = new Date(Date.now() + interval).toISOString();

  _timer = setInterval(() => {
    _status.nextRunAt = new Date(Date.now() + interval).toISOString();
    void runOnce();
  }, interval);

  // Optional: run once immediately at startup
  void runOnce();

  logger.info('outlook-scheduler: started', { intervalMs: interval });
}

/**
 * Stoppa schemat.
 */
export function stopIngestionScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _status.running = false;
  logger.info('outlook-scheduler: stopped');
}

/**
 * Verifierar och hanterar ett inkommande Microsoft Graph-webhook-event.
 * Anropas av POST /api/admin/outlook/webhook.
 */
export async function triggerIngestionWebhook(params: {
  rawBody: string;
  signature?: string;
}): Promise<{ triggered: boolean; reason?: string }> {
  const secret = process.env.OUTLOOK_WEBHOOK_SECRET;

  if (secret && params.signature) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(params.rawBody)
      .digest('base64');

    const sigBuffer = Buffer.from(params.signature, 'base64');
    const expBuffer = Buffer.from(expected, 'base64');

    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      return { triggered: false, reason: 'Webhook-signatur ogiltig' };
    }
  }

  logger.info('outlook-scheduler: webhook trigger received');
  void runOnce();
  return { triggered: true };
}

/**
 * Hämta aktuellt status för schemat.
 */
export function getSchedulerStatus(): SchedulerStatus {
  return { ..._status };
}
