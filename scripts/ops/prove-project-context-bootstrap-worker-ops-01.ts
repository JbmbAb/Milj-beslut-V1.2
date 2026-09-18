/**
 * PROJECT-CONTEXT-BOOTSTRAP-WORKER-OPS-01 live proof.
 *
 * Enqueues a real bootstrap request, starts npm run worker:all as a normal subprocess with
 * worker-only issuer keys in that subprocess env (never written to .env.local), then waits for
 * PENDING -> LEASED -> COMPLETED without manual lease/DB patch/direct worker invocation.
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '../../server/db/prisma';
import { createLocalizationProject } from '../../server/modules/localization/localizationProjectDiscovery';
import { resolveCanonicalPropertySelection } from '../../server/modules/property/public';
import {
  enqueueProjectContextBootstrapRequest,
  getBootstrapRequestStatusForProject,
} from '../../server/modules/localization/projectContextBootstrapRequestQueue';

const SECRETS_DIR = process.env.MIMERS_SECRETS_DIR || 'C:/Users/jimmy/.mimers/secrets';
const ORG_ID = process.env.LU_PROOF_ORG_ID || 'cmsjwmjds0000n4f7il7hf00a';
const USER_ID = process.env.LU_PROOF_USER_ID || 'cmsjwmjel0001n4f7l8yuybwm';
const PROPERTY_DESIGNATION = process.env.LU_PROOF_PROPERTY || 'ORSA STACKMORA 3:12';

function pem(path: string): string {
  return readFileSync(path, 'utf8');
}

async function waitForTerminalStatus(projectId: string, timeoutMs: number) {
  const started = Date.now();
  let lastStatus: string | null = null;
  while (Date.now() - started < timeoutMs) {
    const row = await getBootstrapRequestStatusForProject(projectId);
    if (!row) throw new Error('bootstrap request disappeared');
    if (row.status !== lastStatus) {
      console.log(`  status=${row.status} binding=${row.contextBindingArtifactId ?? 'null'}`);
      lastStatus = row.status;
    }
    if (row.status === 'COMPLETED' || row.status === 'FAILED') return row;
    await delay(1000);
  }
  throw new Error(`timed out waiting for bootstrap completion (last=${lastStatus})`);
}

async function main() {
  console.log('=== enqueue real bootstrap request ===');
  const property = await resolveCanonicalPropertySelection({
    sourceKey: 'merged:ORSASTACKMORA3:12',
    sourceDataset: 'lm_fastighetsytor_merged',
    designation: PROPERTY_DESIGNATION,
  });
  const project = await createLocalizationProject({
    organisationId: ORG_ID,
    property,
    name: `WORKER-OPS proof ${new Date().toISOString()}`,
    userId: USER_ID,
  });
  const request = await enqueueProjectContextBootstrapRequest({
    projectId: project.id,
    requestedByUserId: USER_ID,
    propertyDesignation: PROPERTY_DESIGNATION,
  });
  console.log(`  project=${project.id} request=${request.id} status=${request.status}`);
  if (request.status !== 'PENDING') throw new Error(`expected PENDING, got ${request.status}`);

  console.log('\n=== start npm run worker:all (normal subprocess) ===');
  const workerEnv = {
    ...process.env,
    LU_PROVISIONING_WORKERS_STRICT: 'false',
    SEARCH_WORKER_ENABLED: 'false',
    DOMSTOL_RSS_ENABLED: 'false',
    PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM: pem(`${SECRETS_DIR}/project-context-binding-issuer-v1-private.pem`),
    PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM: pem(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`),
    LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM: pem(`${SECRETS_DIR}/lu-execution-authority/issuer-private.pem`),
    VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM: pem(`${SECRETS_DIR}/viewer-capability-issuer-v1/private.pem`),
    LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM: pem(`${SECRETS_DIR}/localization-geometry-supersession-issuer-v1/private.pem`),
  };

  const worker = spawn('npm run worker:all', {
    cwd: process.cwd(),
    env: workerEnv,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout?.on('data', (chunk) => process.stdout.write(`[worker:all] ${chunk}`));
  worker.stderr?.on('data', (chunk) => process.stderr.write(`[worker:all] ${chunk}`));

  try {
    console.log('\n=== wait for unattended completion ===');
    const finalRow = await waitForTerminalStatus(project.id, 120_000);
    if (finalRow.status !== 'COMPLETED' || !finalRow.contextBindingArtifactId) {
      throw new Error(`bootstrap did not complete successfully: ${finalRow.status} ${finalRow.failureCode ?? ''}`);
    }
    console.log('\nPROOF PASS: PENDING -> COMPLETED via npm run worker:all');
    console.log(JSON.stringify({
      projectId: project.id,
      requestId: request.id,
      bindingId: finalRow.contextBindingArtifactId,
    }, null, 2));
  } finally {
    worker.kill('SIGTERM');
    await delay(1000);
    if (!worker.killed) worker.kill('SIGKILL');
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
