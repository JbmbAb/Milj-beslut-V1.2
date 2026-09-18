/**
 * PROJECT-CONTEXT-BOOTSTRAP-WORKER-OPS-01.
 *
 * LU provisioning workers run ONLY in the dedicated worker process (`npm run worker:all`
 * or the individual `worker:lu-*` scripts). They must never be started from the HTTP server
 * via `startInProcessWorkers()` so issuer private keys stay out of the web process.
 */
import { logger } from '../logger';
import { startLuProjectContextBootstrapWorker } from '../services/luProjectContextBootstrapWorker';
import { startLocalizationIdentityProvisioningWorker } from '../services/luExecutionIdentityV3ProvisioningWorker';
import { startViewerCapabilityProvisioningWorker } from '../services/luViewerCapabilityProvisioningWorker';
import { startGeometrySupersessionProvisioningWorker } from '../services/luGeometrySupersessionProvisioningWorker';

export type LuProvisioningWorkerId =
  | 'project-context-bootstrap'
  | 'execution-identity-v3'
  | 'viewer-capability'
  | 'geometry-supersession';

export type LuProvisioningWorkerAvailability = {
  readonly id: LuProvisioningWorkerId;
  readonly privateKeyEnv: string;
  readonly configured: boolean;
  readonly required: boolean;
};

export type LuProvisioningWorkersHandle = {
  readonly started: readonly LuProvisioningWorkerId[];
  readonly skipped: ReadonlyArray<{ readonly id: LuProvisioningWorkerId; readonly reason: string }>;
  stop: () => void;
};

type LuWorkerDefinition = {
  readonly id: LuProvisioningWorkerId;
  readonly privateKeyEnv: string;
  readonly pollMsEnv: string;
  readonly defaultPollMs: number;
  readonly requiredByDefault: boolean;
  readonly start: (pollMs: number) => NodeJS.Timeout;
};

const LU_WORKERS: readonly LuWorkerDefinition[] = [
  {
    id: 'project-context-bootstrap',
    privateKeyEnv: 'PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM',
    pollMsEnv: 'LU_BOOTSTRAP_WORKER_POLL_MS',
    defaultPollMs: 5000,
    requiredByDefault: true,
    start: startLuProjectContextBootstrapWorker,
  },
  {
    id: 'execution-identity-v3',
    privateKeyEnv: 'LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM',
    pollMsEnv: 'LU_IDENTITY_V3_WORKER_POLL_MS',
    defaultPollMs: 5000,
    requiredByDefault: false,
    start: startLocalizationIdentityProvisioningWorker,
  },
  {
    id: 'viewer-capability',
    privateKeyEnv: 'VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM',
    pollMsEnv: 'LU_VIEWER_CAPABILITY_WORKER_POLL_MS',
    defaultPollMs: 5000,
    requiredByDefault: false,
    start: startViewerCapabilityProvisioningWorker,
  },
  {
    id: 'geometry-supersession',
    privateKeyEnv: 'LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM',
    pollMsEnv: 'LU_GEOMETRY_SUPERSESSION_WORKER_POLL_MS',
    defaultPollMs: 5000,
    requiredByDefault: false,
    start: startGeometrySupersessionProvisioningWorker,
  },
] as const;

function hasConfiguredPrivateKey(env: NodeJS.ProcessEnv, privateKeyEnv: string): boolean {
  return Boolean(env[privateKeyEnv]?.trim());
}

export function describeLuProvisioningWorkerAvailability(
  env: NodeJS.ProcessEnv = process.env,
): LuProvisioningWorkerAvailability[] {
  return LU_WORKERS.map((worker) => ({
    id: worker.id,
    privateKeyEnv: worker.privateKeyEnv,
    configured: hasConfiguredPrivateKey(env, worker.privateKeyEnv),
    required: worker.requiredByDefault,
  }));
}

export function isProjectContextBootstrapWorkerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasConfiguredPrivateKey(env, 'PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM');
}

export function startLuProvisioningWorkers(options?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly strict?: boolean;
}): LuProvisioningWorkersHandle {
  const env = options?.env ?? process.env;
  const strict = options?.strict ?? env.LU_PROVISIONING_WORKERS_STRICT !== 'false';
  const intervals: NodeJS.Timeout[] = [];
  const started: LuProvisioningWorkerId[] = [];
  const skipped: Array<{ id: LuProvisioningWorkerId; reason: string }> = [];

  for (const worker of LU_WORKERS) {
    if (!hasConfiguredPrivateKey(env, worker.privateKeyEnv)) {
      const reason = `${worker.privateKeyEnv} is not set`;
      skipped.push({ id: worker.id, reason });
      if (strict && worker.requiredByDefault) {
        logger.error(`worker:all — required LU worker "${worker.id}" cannot start: ${reason}`);
        process.exit(1);
      }
      logger.warn(`worker:all — skipping LU worker "${worker.id}" (${reason})`);
      continue;
    }

    const pollMs = Math.max(1000, Number(env[worker.pollMsEnv] || worker.defaultPollMs));
    intervals.push(worker.start(pollMs));
    started.push(worker.id);
    logger.info(`worker:all — started LU worker "${worker.id}"`, { pollMs });
  }

  if (started.length === 0) {
    logger.error('worker:all — no LU provisioning workers started (all issuer private keys missing)');
    if (strict) process.exit(1);
  }

  return {
    started,
    skipped,
    stop: () => {
      for (const id of intervals) clearInterval(id);
    },
  };
}
