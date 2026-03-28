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
    const beforeRuns = getSchedulerStatus().totalRuns;

    startIngestionScheduler();

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

  it('accepts valid signatures, triggers ingestion and updates status', async () => {
    process.env.OUTLOOK_WEBHOOK_SECRET = 'secret';
    process.env.OUTLOOK_FOLDER_PATH = '/data/outlook';
    process.env.OUTLOOK_STORAGE_ROOT = '/data/storage';

    const rawBody = '{"value":[{"id":"evt-1"}]}';
    const signature = crypto.createHmac('sha256', 'secret').update(rawBody).digest('base64');

    const result = await triggerIngestionWebhook({
      rawBody,
      signature,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(result).toEqual({ triggered: true });
    expect(mocks.runIngestion).toHaveBeenCalledWith({
      emails: [],
      storageRoot: '/data/storage',
    });
    expect(getSchedulerStatus().lastRunResult).toEqual({
      emailsProcessed: 2,
      emailsSkipped: 1,
      attachmentsSaved: 4,
      errors: [],
    });
  });
});
