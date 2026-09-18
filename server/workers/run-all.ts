/**
 * Kör alla bakgrundsjobb i en separat process (utan HTTP-server).
 * Kör: npm run worker:all
 */
import { logger } from '../logger';
import { bootstrapWorkerProcess } from './bootstrap';
import { startInProcessWorkers } from './registry';
import { startLuProvisioningWorkers } from './luProvisioningWorkers';

bootstrapWorkerProcess();

const platformWorkers = startInProcessWorkers();
const luWorkers = startLuProvisioningWorkers();
logger.info('worker:all — background workers running (Ctrl+C to stop).', {
  luStarted: luWorkers.started,
  luSkipped: luWorkers.skipped,
});

function shutdown(signal: string): void {
  logger.info('worker:all — shutting down', { signal });
  luWorkers.stop();
  platformWorkers.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
