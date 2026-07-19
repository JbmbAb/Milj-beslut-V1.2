/**
 * Fristående GDPR-underhållsjobb.
 * Kör: npm run worker:gdpr
 */
import { logger } from '../logger';
import { runGdprMaintenanceJob } from '../services/gdprComplianceService';
import { bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

async function main(): Promise<void> {
  logger.info('gdpr-worker: Starting GDPR maintenance job...');
  await runGdprMaintenanceJob();
  logger.info('gdpr-worker: GDPR maintenance job finished.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('gdpr-worker: Job failed with unhandled exception', { error: String(err) });
    process.exit(1);
  });
