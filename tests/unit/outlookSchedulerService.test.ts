import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runIngestion: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/services/outlookIngestionService', () => ({
  runIngestion: mocks.runIngestion,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

import {
  getSchedulerStatus,
  startIngestionScheduler,
  stopIngestionScheduler,
  triggerIngestionWebhook,
} from '../../server/services/outlookSchedulerService';

describe('outlookSchedulerService', () => {
  const originalFolderPath = process.env.OUTLOOK_FOLDER_PATH;
  const originalStorageRoot = process.env.OUTLOOK_STORAGE_ROOT;
  const originalSecret = process.env.OUTLOOK_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stopIngestionScheduler();

    delete process.env.OUTLOOK_FOLDER_PATH;
    delete process.env.OUTLOOK_STORAGE_ROOT;
    delete process.env.OUTLOOK_WEBHOOK_SECRET;

    mocks.runIngestion.mockResolvedValue({
      emailsProcessed: 2,
      emailsSkipped: 1,
      attachmentsSaved: 4,
      errors: [],
    });
  });

  afterEach(() => {
    stopIngestionScheduler();
    vi.useRealTimers();

    if (originalFolderPath === undefined) {
      delete process.env.OUTLOOK_FOLDER_PATH;
    } else {
      process.env.OUTLOOK_FOLDER_PATH = originalFolderPath;
    }

    if (originalStorageRoot === undefined) {
      delete process.env.OUTLOOK_STORAGE_ROOT;
    } else {
      process.env.OUTLOOK_STORAGE_ROOT = originalStorageRoot;
    }

    if (originalSecret === undefined) {
      delete process.env.OUTLOOK_WEBHOOK_SECRET;
    } else {
      process.env.OUTLOOK_WEBHOOK_SECRET = originalSecret;
    }
  });

  it('starts and stops the scheduler, simulating an empty run when no folder is configured', async () => {
    // Fake timers block Node's setImmediate; runOnce() finishes via real async + microtasks.
    vi.useRealTimers();
    const beforeRuns = getSchedulerStatus().totalRuns;

    startIngestionScheduler();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const running = getSchedulerStatus();
    expect(running.running).toBe(true);
    expect(running.totalRuns).toBeGreaterThanOrEqual(beforeRuns + 1);
    expect(running.lastRunResult).toEqual({
      emailsProcessed: 0,
      emailsSkipped: 0,
      attachmentsSaved: 0,
      errors: [],
    });

    stopIngestionScheduler();
    expect(getSchedulerStatus().running).toBe(false);
    vi.useFakeTimers();
  });

  it('rejects invalid webhook signatures', async () => {
    process.env.OUTLOOK_WEBHOOK_SECRET = 'secret';

    const result = await triggerIngestionWebhook({
      rawBody: '{"value":[]}',
      signature: Buffer.from('bad-signature').toString('base64'),
    });

    expect(result).toEqual({
      triggered: false,
      reason: 'Webhook-signatur ogiltig',
    });
    expect(mocks.runIngestion).not.toHaveBeenCalled();
  });

  it('starts only once when called twice (idempotent)', () => {
    startIngestionScheduler();
    const statusAfterFirst = getSchedulerStatus();
    startIngestionScheduler(); // second call should be a no-op
    const statusAfterSecond = getSchedulerStatus();

    expect(statusAfterFirst.running).toBe(true);
    expect(statusAfterSecond.running).toBe(true);
    // total runs should not increase from the second start
    expect(statusAfterSecond.totalRuns).toBe(statusAfterFirst.totalRuns);

    stopIngestionScheduler();
  });

  it('triggers webhook without secret verification when OUTLOOK_WEBHOOK_SECRET is not set', async () => {
    process.env.OUTLOOK_FOLDER_PATH = '/data/outlook';
    process.env.OUTLOOK_STORAGE_ROOT = '/data/storage';
    // No secret set → should bypass HMAC check

    const result = await triggerIngestionWebhook({ rawBody: '{}' });
    expect(result).toEqual({ triggered: true });
    // runIngestion is called via runOnce in background
    await Promise.resolve();
    await Promise.resolve();
  });

  it('records run errors in lastRunResult when ingestion throws', async () => {
    process.env.OUTLOOK_FOLDER_PATH = '/data/outlook';
    process.env.OUTLOOK_STORAGE_ROOT = '/data/storage';
    mocks.runIngestion.mockRejectedValueOnce(new Error('Ingestion crash'));

    await triggerIngestionWebhook({ rawBody: '{}' });
    await Promise.resolve();
    await Promise.resolve();

    const status = getSchedulerStatus();
    expect(status.lastRunResult?.errors).toContain('Ingestion crash');
  });

  it('accepts valid HMAC signature and triggers webhook', async () => {
    const secret = 'my-webhook-secret';
    const rawBody = '{"value":[{"subscriptionId":"abc"}]}';
    process.env.OUTLOOK_WEBHOOK_SECRET = secret;
    process.env.OUTLOOK_FOLDER_PATH = '/data/outlook';
    process.env.OUTLOOK_STORAGE_ROOT = '/data/storage';

    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

    const result = await triggerIngestionWebhook({ rawBody, signature });
    expect(result).toEqual({ triggered: true });
  });

  it('getSchedulerStatus includes nextRunAt after scheduler starts', () => {
    startIngestionScheduler();

    const status = getSchedulerStatus();
    expect(status.running).toBe(true);
    expect(status.nextRunAt).toBeDefined();
    expect(typeof status.nextRunAt).toBe('string');

    stopIngestionScheduler();
  });
});
