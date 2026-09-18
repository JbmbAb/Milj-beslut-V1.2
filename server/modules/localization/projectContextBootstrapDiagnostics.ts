/**
 * PROJECT-CONTEXT-BOOTSTRAP-WORKER-OPS-01 — operator-visible bootstrap queue diagnostics.
 * Safe for the web server to import (read-only; never touches issuer private keys).
 */
import { isProjectContextBootstrapWorkerConfigured } from '../../workers/luProvisioningWorkers';

const STALE_PENDING_DIAGNOSTIC_MS = 45_000;

export type BootstrapQueueDiagnostics = {
  readonly code: 'WORKER_LIKELY_UNAVAILABLE' | 'WORKER_NOT_CONFIGURED';
  readonly message: string;
  readonly staleForMs: number;
  readonly workerStartCommand: string;
  readonly projectContextWorkerConfigured: boolean;
};

export function diagnoseStaleBootstrapRequest(input: {
  readonly status: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED';
  readonly createdAt: Date;
  readonly now?: Date;
  readonly env?: NodeJS.ProcessEnv;
}): BootstrapQueueDiagnostics | null {
  if (input.status !== 'PENDING' && input.status !== 'LEASED') return null;
  const now = input.now ?? new Date();
  const staleForMs = now.getTime() - input.createdAt.getTime();
  if (staleForMs < STALE_PENDING_DIAGNOSTIC_MS) return null;

  const projectContextWorkerConfigured = isProjectContextBootstrapWorkerConfigured(input.env);
  if (!projectContextWorkerConfigured) {
    return {
      code: 'WORKER_NOT_CONFIGURED',
      message:
        'Project-context bootstrap worker is not configured in this runtime. Set PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM in the worker process (never in the web server) and start npm run worker:all.',
      staleForMs,
      workerStartCommand: 'npm run worker:all',
      projectContextWorkerConfigured,
    };
  }

  return {
    code: 'WORKER_LIKELY_UNAVAILABLE',
    message:
      'Bootstrap request has remained pending longer than expected. Ensure npm run worker:all is running in a separate process before creating a localization.',
    staleForMs,
    workerStartCommand: 'npm run worker:all',
    projectContextWorkerConfigured,
  };
}

export function webProcessHasProjectContextSigningKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return isProjectContextBootstrapWorkerConfigured(env);
}
