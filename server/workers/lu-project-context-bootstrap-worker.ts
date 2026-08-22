/**
 * Fristående LU project-context bootstrap-worker.
 * Kör: npm run worker:lu-bootstrap
 *
 * The ONLY process that should ever have PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM set.
 */
import { logger } from '../logger';
import { startLuProjectContextBootstrapWorker } from '../services/luProjectContextBootstrapWorker';
import { bootstrapWorkerProcess } from './bootstrap';

bootstrapWorkerProcess();

function main(): void {
  if (!process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM) {
    logger.error('lu-bootstrap-worker: PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM is not set -- refusing to start.');
    process.exit(1);
  }
  logger.info('lu-bootstrap-worker: Starting LU project-context bootstrap worker...');
  const pollMs = Math.max(1000, Number(process.env.LU_BOOTSTRAP_WORKER_POLL_MS || 5000));
  startLuProjectContextBootstrapWorker(pollMs);
  logger.info(`lu-bootstrap-worker: Polling for requests every ${pollMs}ms.`);
}

main();
