/**
 * UNATTENDED NEW-PROPERTY PROVISIONING + GENERIC NEW-PROPERTY LU E2E — PRODUCT-PROVEN proof.
 *
 * Fourth wholly new property (default: KIRUNA ABISKO 1:1), zero manual worker invocation:
 *
 *   npm run worker:all (subprocess, issuer private keys worker-only)
 *   -> new project + bootstrap queue
 *   -> viewer-capability queue
 *   -> user geometry save (identity enqueue)
 *   -> execution-identity-v3 queue
 *   -> GenerateLocalizationReportUseCase (assessment)
 *   -> resolveLuViewerPresentation x2 (reopen)
 *   -> CAS provenance spot-check
 *
 * No processProjectContextBootstrapRequestsOnce / no manual lease / no DB patch.
 *
 * Usage:
 *   MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-lu-unattended-new-property-product-proven-01.ts
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { prisma } from '../../server/db/prisma';
import type { AuthUser } from '../../server/security/types';
import { createLocalizationProject } from '../../server/modules/localization/localizationProjectDiscovery';
import { resolveCanonicalPropertySelection } from '../../server/modules/property/public';
import {
  enqueueProjectContextBootstrapRequest,
  getBootstrapRequestStatusForProject,
} from '../../server/modules/localization/projectContextBootstrapRequestQueue';
import { ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap } from '../../server/modules/localization/viewerCapabilityProvisioningTrigger';
import { getLatestProvisioningRequestForProject } from '../../server/modules/localization/viewerCapabilityProvisioningQueue';
import { saveUserLocalizationGeometry } from '../../server/modules/localization/localizationGeometryService';
import { getProvisioningStatusForGeometry } from '../../server/modules/localization/localizationIdentityProvisioningQueue';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';
import { resolveLuViewerPresentation } from '../../server/modules/localization/localizationOrchestrator';

const SECRETS_DIR = process.env.MIMERS_SECRETS_DIR || 'C:/Users/jimmy/.mimers/secrets';
const ORG_ID = process.env.LU_PROOF_ORG_ID || 'cmsjwmjds0000n4f7il7hf00a';
const USER_ID = process.env.LU_PROOF_USER_ID || 'cmsjwmjel0001n4f7l8yuybwm';

const FOURTH_PROPERTY = {
  designation: process.env.LU_PROOF_PROPERTY || 'KIRUNA ABISKO 1:1',
  sourceKey: process.env.LU_PROOF_SOURCE_KEY || 'merged:KIRUNAABISKO1:1',
  sourceDataset: process.env.LU_PROOF_SOURCE_DATASET || 'lm_fastighetsytor_merged',
  lng: Number(process.env.LU_PROOF_LNG || 18.68016395307179),
  lat: Number(process.env.LU_PROOF_LAT || 68.32405360753108),
} as const;

function pem(path: string): string {
  return readFileSync(path, 'utf8');
}

function loadPublicVerificationEnv(): void {
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = 'project-context-binding-issuer-v1-fb38fb09cba8f5f8';
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`);
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = 'ed25519:lu-execution-issuer-v1-656368e58631c925';
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/lu-execution-authority/issuer-public.pem`);
  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = 'ed25519:lu-execution-root-v1-839f2a91ad203e79';
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/lu-execution-authority/root-public.pem`);
  process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = 'ed25519:viewer-capability-issuer-v1';
  process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/viewer-capability-issuer-v1/public.pem`);
  process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = 'ed25519:viewer-identity-issuer-v1';
  process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/viewer-identity-issuer-v1/public.pem`);
  delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM;
  delete process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
  delete process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM;
  delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM;
}

function buildWorkerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LU_PROVISIONING_WORKERS_STRICT: 'false',
    SEARCH_WORKER_ENABLED: 'false',
    DOMSTOL_RSS_ENABLED: 'false',
    LU_BOOTSTRAP_WORKER_POLL_MS: '1000',
    LU_IDENTITY_V3_WORKER_POLL_MS: '1000',
    LU_VIEWER_CAPABILITY_WORKER_POLL_MS: '1000',
    LU_GEOMETRY_SUPERSESSION_WORKER_POLL_MS: '1000',
    PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID: 'project-context-binding-issuer-v1-fb38fb09cba8f5f8',
    PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM: pem(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`),
    PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM: pem(`${SECRETS_DIR}/project-context-binding-issuer-v1-private.pem`),
    LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID: 'ed25519:lu-execution-issuer-v1-656368e58631c925',
    LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM: pem(`${SECRETS_DIR}/lu-execution-authority/issuer-public.pem`),
    LU_EXECUTION_AUTHORITY_ROOT_KEY_ID: 'ed25519:lu-execution-root-v1-839f2a91ad203e79',
    LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM: pem(`${SECRETS_DIR}/lu-execution-authority/root-public.pem`),
    LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM: pem(`${SECRETS_DIR}/lu-execution-authority/issuer-private.pem`),
    VIEWER_CAPABILITY_ISSUER_KEY_ID: 'ed25519:viewer-capability-issuer-v1',
    VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM: pem(`${SECRETS_DIR}/viewer-capability-issuer-v1/public.pem`),
    VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM: pem(`${SECRETS_DIR}/viewer-capability-issuer-v1/private.pem`),
    LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM: pem(`${SECRETS_DIR}/localization-geometry-supersession-issuer-v1/private.pem`),
  };
}

async function waitFor<T>(
  label: string,
  read: () => Promise<T | null | undefined>,
  done: (value: NonNullable<T>) => boolean,
  failed: (value: NonNullable<T>) => boolean,
  timeoutMs: number,
): Promise<NonNullable<T>> {
  const started = Date.now();
  let last: string | null = null;
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) {
      const snapshot = JSON.stringify(value);
      if (snapshot !== last) {
        console.log(`  ${label}: ${snapshot}`);
        last = snapshot;
      }
      if (failed(value as NonNullable<T>)) {
        throw new Error(`${label} failed: ${snapshot}`);
      }
      if (done(value as NonNullable<T>)) return value as NonNullable<T>;
    }
    await delay(1000);
  }
  throw new Error(`${label} timed out (last=${last})`);
}

async function waitForWorkerReady(worker: ChildProcess, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let buffer = '';
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer | string) => {
      buffer += String(chunk);
      if (buffer.includes('worker:all — background workers running')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`worker:all exited before ready (code=${code ?? 'null'})`));
    };
    const timer = setInterval(() => {
      if (Date.now() - started > timeoutMs) {
        cleanup();
        reject(new Error('worker:all did not become ready in time'));
      }
    }, 500);
    const cleanup = () => {
      clearInterval(timer);
      worker.stdout?.off('data', onData);
      worker.stderr?.off('data', onData);
      worker.off('exit', onExit);
    };
    worker.stdout?.on('data', onData);
    worker.stderr?.on('data', onData);
    worker.on('exit', onExit);
  });
}

async function stopWorker(worker: ChildProcess): Promise<void> {
  worker.kill('SIGTERM');
  await delay(1500);
  if (!worker.killed) worker.kill('SIGKILL');
}

async function artifactInCas(
  repo: { resolve: (ref: { artifact_id: string; artifact_type: string }) => Promise<unknown> },
  artifactId: string,
  artifactType: string,
): Promise<boolean> {
  try {
    await repo.resolve({ artifact_id: artifactId, artifact_type: artifactType });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('########## PROVE-LU-UNATTENDED-NEW-PROPERTY-PRODUCT-PROVEN-01 ##########\n');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  loadPublicVerificationEnv();
  if (process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM) {
    throw new Error('web/proof process must not hold PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM');
  }

  const results: Record<string, boolean | string> = {};
  const authUser: AuthUser = { id: USER_ID, organisationId: ORG_ID, bankidId: 'bankid-test-session', role: 'ADMIN' };

  console.log('=== STEP 0: start worker:all (before any product action) ===\n');
  const worker = spawn('node --import tsx server/workers/run-all.ts', {
    cwd: process.cwd(),
    env: buildWorkerEnv(),
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout?.on('data', (chunk) => process.stdout.write(`[worker:all] ${chunk}`));
  worker.stderr?.on('data', (chunk) => process.stderr.write(`[worker:all] ${chunk}`));
  await waitForWorkerReady(worker, 120_000);
  console.log('  worker:all ready\n');

  try {
    console.log('\n=== STEP 1: fourth new property + unattended bootstrap ===\n');
    const property = await resolveCanonicalPropertySelection({
      sourceKey: FOURTH_PROPERTY.sourceKey,
      sourceDataset: FOURTH_PROPERTY.sourceDataset,
      designation: FOURTH_PROPERTY.designation,
    });
    const project = await createLocalizationProject({
      organisationId: ORG_ID,
      property,
      name: `PRODUCT-PROVEN fourth property ${new Date().toISOString()}`,
      userId: USER_ID,
    });
    await enqueueProjectContextBootstrapRequest({
      projectId: project.id,
      requestedByUserId: USER_ID,
      propertyDesignation: FOURTH_PROPERTY.designation,
    });
    results.projectId = project.id;
    results.propertyDesignation = FOURTH_PROPERTY.designation;

    const bootstrap = await waitFor(
      'bootstrap',
      () => getBootstrapRequestStatusForProject(project.id),
      (row) => row.status === 'COMPLETED' && !!row.contextBindingArtifactId,
      (row) => row.status === 'FAILED',
      180_000,
    );
    results.bootstrapCompleted = bootstrap.status === 'COMPLETED';
    results.contextBindingArtifactId = bootstrap.contextBindingArtifactId ?? '';

    console.log('\n=== STEP 2: unattended viewer-capability provisioning ===\n');
    await ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap({
      projectId: project.id,
      contextBindingArtifactId: bootstrap.contextBindingArtifactId!,
      requestedByUserId: USER_ID,
    });
    const viewerCapability = await waitFor(
      'viewer-capability',
      () => getLatestProvisioningRequestForProject(project.id),
      (row) => row.status === 'COMPLETED' && !!row.capabilityArtifactId,
      (row) => row.status === 'FAILED',
      180_000,
    );
    results.viewerCapabilityCompleted = viewerCapability.status === 'COMPLETED';
    results.capabilityArtifactId = viewerCapability.capabilityArtifactId ?? '';

    console.log('\n=== STEP 3: geometry save + unattended execution-identity-v3 ===\n');
    const geometrySave = await saveUserLocalizationGeometry({
      authUser,
      projectId: project.id,
      input: { geometry_type: 'POINT', coordinates: [FOURTH_PROPERTY.lng, FOURTH_PROPERTY.lat], srid: 4326 },
    });
    if (!geometrySave.ok) throw new Error(`geometry save failed: ${geometrySave.error}`);
    results.geometrySaved = true;
    results.geometryArtifactId = geometrySave.data.artifact_id;

    const identity = await waitFor(
      'execution-identity-v3',
      () => getProvisioningStatusForGeometry(project.id, geometrySave.data.artifact_id),
      (row) => row.status === 'COMPLETED' && !!row.executionIdentityArtifactId,
      (row) => row.status === 'FAILED',
      180_000,
    );
    results.executionIdentityCompleted = identity.status === 'COMPLETED';
    results.executionIdentityArtifactId = identity.executionIdentityArtifactId ?? '';

    console.log('\n=== STEP 4: assessment (ExecutionKernel) ===\n');
    const usecase = new GenerateLocalizationReportUseCase();
    const report = await usecase.execute({
      projectId: project.id,
      siteAlternatives: [{
        id: `site-${project.id}`,
        name: FOURTH_PROPERTY.designation,
        lat: FOURTH_PROPERTY.lat,
        lng: FOURTH_PROPERTY.lng,
      }],
    });
    const motor = report.siteAnalyses[0]?.executionMotor;
    results.executionKernelAdmitted = motor?.admitted === true;
    results.assessed = motor?.assessment_status === 'ASSESSED';
    results.assessmentArtifactId = motor?.assessment_artifact_id ?? '';

    console.log('\n=== STEP 5: governed viewer presentation + reopen ===\n');
    const firstOpen = await resolveLuViewerPresentation({ authUser, projectId: project.id });
    results.firstPresentationOk = firstOpen.ok;
    if (!firstOpen.ok) throw new Error(`first presentation failed: ${firstOpen.error}`);

    await delay(1500);
    const reopen = await resolveLuViewerPresentation({ authUser, projectId: project.id });
    results.reopenPresentationOk = reopen.ok;
    results.reopenMatchesAssessment =
      reopen.ok && firstOpen.ok && reopen.assessmentArtifactId === firstOpen.assessmentArtifactId;
    if (!reopen.ok) throw new Error(`reopen presentation failed: ${reopen.error}`);

    console.log('\n=== STEP 6: CAS provenance spot-check ===\n');
    const mimers = await MimersIntegration.create({ forceMimers: true });
    const repo = mimers.artifactRepository;
    results.bindingInCas = await artifactInCas(
      repo,
      String(results.contextBindingArtifactId),
      'project_context_binding',
    );
    results.capabilityInCas = await artifactInCas(
      repo,
      String(results.capabilityArtifactId),
      'viewer_capability',
    );
    results.assessmentInCas = await artifactInCas(
      repo,
      String(results.assessmentArtifactId),
      'localization_assessment',
    );
    results.geometryInCas = await artifactInCas(
      repo,
      String(results.geometryArtifactId),
      'localization_geometry',
    );
    results.executionIdentityInCas = await artifactInCas(
      repo,
      String(results.executionIdentityArtifactId),
      'execution_identity',
    );

    console.log('\n========== SUMMARY ==========');
    console.log(JSON.stringify(results, null, 2));
    const ok = Object.entries(results)
      .filter(([key]) => !key.endsWith('Id') && key !== 'propertyDesignation')
      .every(([, value]) => value === true);
    console.log(`\nUNATTENDED NEW-PROPERTY PROVISIONING: ${ok ? 'PRODUCT-PROVEN' : 'FAILED'}`);
    console.log(`GENERIC NEW-PROPERTY LU E2E: ${ok ? 'PRODUCT-PROVEN' : 'FAILED'}`);
    console.log(`MANUAL INTERVENTION: NO`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await stopWorker(worker);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
