import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Top-level mocks are hoisted by Vitest
vi.mock('../../server/services/domstolRssService', () => ({
  ingestDomstolRssFeed: vi.fn().mockResolvedValue({ newJudgments: 0, updatedJudgments: 0 }),
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Top-level reference – used only for tests that don't call vi.resetModules().
import { ingestDomstolRssFeed } from '../../server/services/domstolRssService';

/**
 * Get a fresh reference to the `ingestDomstolRssFeed` mock AFTER `loadScheduler()`
 * has called `vi.resetModules()`. Without this, vi.mocked() on the stale import
 * would set up a different mock instance from the one used by the re-imported scheduler.
 */
async function getFreshIngestMock() {
  const { ingestDomstolRssFeed: freshRef } = await import('../../server/services/domstolRssService');
  return vi.mocked(freshRef);
}

// Helper: fresh module import (resets internal _status and _timer)
async function loadScheduler() {
  vi.resetModules();
  return await import('../../server/services/domstolRssSchedulerService');
}

describe('domstolRssSchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getSchedulerStatus returnerar running:false initialt', async () => {
    const { getSchedulerStatus } = await loadScheduler();
    const status = getSchedulerStatus();
    expect(status.running).toBe(false);
    expect(status.totalRuns).toBe(0);
  });

  it('startDomstolScheduler sätter running:true', async () => {
    vi.mocked(ingestDomstolRssFeed).mockResolvedValue({ newJudgments: 2, updatedJudgments: 1 });
    const { startDomstolScheduler, getSchedulerStatus, stopDomstolScheduler } = await loadScheduler();

    startDomstolScheduler();
    expect(getSchedulerStatus().running).toBe(true);

    stopDomstolScheduler();
  });

  it('stopDomstolScheduler sätter running:false', async () => {
    vi.mocked(ingestDomstolRssFeed).mockResolvedValue({ newJudgments: 0, updatedJudgments: 0 });
    const { startDomstolScheduler, stopDomstolScheduler, getSchedulerStatus } = await loadScheduler();

    startDomstolScheduler();
    stopDomstolScheduler();
    expect(getSchedulerStatus().running).toBe(false);
  });

  it('startDomstolScheduler anropar ingestDomstolRssFeed direkt', async () => {
    const { startDomstolScheduler, stopDomstolScheduler } = await loadScheduler();
    // After vi.resetModules() we must get the fresh mock reference.
    const freshIngest = await getFreshIngestMock();
    freshIngest.mockResolvedValue({ newJudgments: 3, updatedJudgments: 0 });

    startDomstolScheduler();
    // runOnce() is fired immediately via void; drain the microtask queue
    // without calling vi.runAllTimersAsync() which causes infinite setInterval loops.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(freshIngest).toHaveBeenCalled();
    stopDomstolScheduler();
  });

  it('dubbel start ignoreras (idempotent)', async () => {
    vi.mocked(ingestDomstolRssFeed).mockResolvedValue({ newJudgments: 0, updatedJudgments: 0 });
    const { startDomstolScheduler, getSchedulerStatus, stopDomstolScheduler } = await loadScheduler();

    startDomstolScheduler();
    startDomstolScheduler(); // should be no-op
    expect(getSchedulerStatus().running).toBe(true);

    stopDomstolScheduler();
  });

  it('getSchedulerStatus returnerar intervalMs som positivt tal', async () => {
    const { getSchedulerStatus } = await loadScheduler();
    const { intervalMs } = getSchedulerStatus();
    expect(typeof intervalMs).toBe('number');
    expect(intervalMs).toBeGreaterThan(0);
  });

  it('lastRunResult sätts efter körning', async () => {
    const { startDomstolScheduler, getSchedulerStatus, stopDomstolScheduler } = await loadScheduler();
    // After vi.resetModules() we must get the fresh mock reference.
    const freshIngest = await getFreshIngestMock();
    freshIngest.mockResolvedValue({ newJudgments: 5, updatedJudgments: 2 });

    startDomstolScheduler();
    // Drain microtask queue without triggering infinite setInterval loops.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const status = getSchedulerStatus();
    expect(status.lastRunResult?.newJudgments).toBe(5);
    stopDomstolScheduler();
  });
});
