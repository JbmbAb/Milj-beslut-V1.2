/**
 * Interna endpoints för Cloud Scheduler, Cloud Tasks eller manuell operation.
 * Skydda med INTERNAL_CRON_TOKEN (header X-Internal-Token).
 */

import express from 'express';
import { logger } from '../logger';
import { processSearchJobsOnce } from '../modules/search/public';
import { runGdprMaintenanceJob } from '../modules/platform/public';

const router = express.Router();

function assertInternalToken(req: express.Request, res: express.Response): boolean {
  const expected = String(process.env.INTERNAL_CRON_TOKEN || '').trim();
  if (!expected) {
    res.status(503).json({ ok: false, error: 'INTERNAL_CRON_TOKEN is not configured' });
    return false;
  }
  const got = String(req.get('X-Internal-Token') || '').trim();
  if (got !== expected) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

/** Kör sök-/inbäddningsjobb från databasen (ersätter in-process poll när SEARCH_WORKER_ENABLED=false). */
router.post('/api/internal/background/search-worker/tick', express.json(), async (req, res) => {
  try {
    if (!assertInternalToken(req, res)) return;
    const max = Math.max(1, Math.min(50, Number((req.body as { maxJobs?: number })?.maxJobs || 5)));
    const processed = await processSearchJobsOnce(max);
    res.json({ ok: true, processed });
  } catch (err) {
    logger.error('internal search-worker tick failed', { err: String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/** GDPR-underhåll (ersätter in-process setInterval när GDPR_CRON_IN_PROCESS=false). */
router.post('/api/internal/background/gdpr-maintenance', async (req, res) => {
  try {
    if (!assertInternalToken(req, res)) return;
    const result = await runGdprMaintenanceJob();
    res.json({ ok: true, result });
  } catch (err) {
    logger.error('internal gdpr-maintenance failed', { err: String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
