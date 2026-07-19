/**
 * domstolRssSchedulerService.ts
 *
 *
 * Schemalagd inläsning av domstolarnas RSS-flöde.
 */

import { logger } from '../logger';
import { ingestDomstolRssFeed } from './domstolRssService';

export interface SchedulerStatus {
  running: boolean;
  intervalMs: number;
  lastRunAt?: string;
  lastRunResult?: {
    newJudgments: number;
    updatedJudgments: number;
    error?: string;
  };
  nextRunAt?: string;
  totalRuns: number;
}

let _timer: ReturnType<typeof setInterval> | null = null;
const _status: SchedulerStatus = {
  running: false,
  intervalMs: Number(process.env.DOMSTOL_RSS_INTERVAL_MS ?? 14_400_000), // 4h default
  totalRuns: 0,
};

async function runOnce(): Promise<void> {
  _status.totalRuns++;
  _status.lastRunAt = new Date().toISOString();

  try {
    const result = await ingestDomstolRssFeed();
    _status.lastRunResult = {
      newJudgments: result.newJudgments,
      updatedJudgments: result.updatedJudgments,
    };
    logger.info('domstol-rss-scheduler: run completed', _status.lastRunResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _status.lastRunResult = { newJudgments: 0, updatedJudgments: 0, error: msg };
    logger.warn('domstol-rss-scheduler: run failed', { error: msg });
  }
}

export function startDomstolScheduler(): void {
  if (_status.running) return;
  _status.running = true;

  const interval = _status.intervalMs;
  _status.nextRunAt = new Date(Date.now() + interval).toISOString();

  _timer = setInterval(() => {
    _status.nextRunAt = new Date(Date.now() + interval).toISOString();
    void runOnce();
  }, interval);

  void runOnce();
  logger.info('domstol-rss-scheduler: started', { intervalMs: interval });
}

export function stopDomstolScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _status.running = false;
  logger.info('domstol-rss-scheduler: stopped');
}

export function getSchedulerStatus(): SchedulerStatus {
  return { ..._status };
}
