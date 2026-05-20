/**
 * Standalone worker for running GDPR maintenance.
 * Can be run as a separate process, e.g., via a cron job or a separate Cloud Run service.
 *
 * To run: `ts-node -r dotenv/config server/workers/gdpr-maintenance-worker.ts`
 */
import { loadEnvFile } from '../../server/loadEnv';
import { logger } from '../../server/logger';
import { runGdprMaintenanceJob } from '../../server/services/gdprComplianceService';

loadEnvFile();

async function main() {
  logger.info('gdpr-worker: Starting GDPR maintenance job...');
  await runGdprMaintenanceJob();
  logger.info('gdpr-worker: GDPR maintenance job finished.');
  process.exit(0);
}

main().catch((err) => {
  logger.error('gdpr-worker: Job failed with unhandled exception', { error: String(err) });
  process.exit(1);
});
