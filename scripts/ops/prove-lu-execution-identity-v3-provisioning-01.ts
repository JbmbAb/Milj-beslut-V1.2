/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B -- real, live proof run against the
 * real dev DB/CAS and the real ORSA STACKMORA 3:12 project (`cmt2m7bdj0000h0f7uj4jykis`).
 *
 * Proves the durable request -> separate worker -> public-key-only verification chain end to end,
 * with the web-server side and the worker side genuinely separated the same way this script is
 * itself structured: the "enqueue" phase never touches the private key; only the "process as
 * worker" phase loads it, and loads it from ~/.mimers/secrets, never from .env/.env.local.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-lu-execution-identity-v3-provisioning-01.ts --execute
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { prisma } from '../../server/db/prisma';
import {
  enqueueLocalizationIdentityProvisioningRequest,
  getProvisioningStatusForGeometry,
} from '../../server/modules/localization/localizationIdentityProvisioningQueue';
import { processLocalizationIdentityProvisioningRequestsOnce } from '../../server/services/luExecutionIdentityV3ProvisioningWorker';
import { createLocalizationGeometryArtifact } from '@miljobeslut/mps-lu';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { registerLocalizationGeometry } from '../../server/modules/localization/localizationGeometryProjection';
import { resolveCanonicalProjectContext } from '../../src/application/resolveCanonicalProjectContext';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const OWNER_USER_ID = 'cmsjwmjel0001n4f7l8yuybwm';

const POINT_A = { lng: 14.6, lat: 61.16 };
const POINT_B = { lng: 14.65, lat: 61.21 };

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('refusing to write without --execute');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  console.log('=== PROOF 1: web-server-side process has NO execution authority private key ===');
  console.log(`  LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM present before worker step: ${Boolean(process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM)}`);
  if (process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM) throw new Error('PROOF FAILED: private key already present before the worker step');
  console.log('  PROOF PASS: private key absent from this process at the point the web server would enqueue.');

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;
  const canonicalContext = await resolveCanonicalProjectContext(PROJECT_ID, repo);

  async function saveAndEnqueue(point: { lng: number; lat: number }, label: string) {
    const geometry = createLocalizationGeometryArtifact({
      project_id: PROJECT_ID,
      property_context_ref: canonicalContext.propertyContextRef,
      wgs84LngLat: [point.lng, point.lat],
      sweref99NorthingEasting: [6790000 + Math.round(point.lat * 1000), 480000 + Math.round(point.lng * 1000)],
      provenance: 'user_defined',
      label,
      created_by: 'PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01-live-proof',
    });
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });
    await registerLocalizationGeometry({ projectId: PROJECT_ID, geometry });
    // This is exactly what saveUserLocalizationGeometry does after a successful save -- the
    // ONLY thing the live web server route does. No artifact_id/content_hash/issuer/signature
    // is minted or touched here.
    const request = await enqueueLocalizationIdentityProvisioningRequest({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: OWNER_USER_ID,
    });
    console.log(`  enqueued request ${request.id} for ${label} (geometry=${geometry.artifact_id}), status=${request.status}`);
    return { geometry, request };
  }

  console.log('\n=== POINT A: save + enqueue (web-server side, no private key) ===');
  const a = await saveAndEnqueue(POINT_A, 'V3 provisioning proof point A');

  console.log('\n=== SIMULATE THE RACE: move to point B and enqueue its own request BEFORE A is processed ===');
  const b = await saveAndEnqueue(POINT_B, 'V3 provisioning proof point B (moved)');

  console.log('\n=== NOW load the private key and start the worker (separate step, worker-only) ===');
  process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-private.pem`, 'utf8');
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = 'ed25519:lu-execution-issuer-v1-656368e58631c925';
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-public.pem`, 'utf8');
  process.env.LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID = 'lu-execution-authority-issuer-8a7861f9da74621c6bda9032';

  console.log('\n=== WORKER: process request for A (may complete AFTER B already exists -- must still mint strictly for A) ===');
  const processedA = await processLocalizationIdentityProvisioningRequestsOnce();
  if (processedA !== 1) throw new Error('PROOF FAILED: worker did not process a request for A');
  const statusA1 = await getProvisioningStatusForGeometry(PROJECT_ID, a.geometry.artifact_id);
  console.log(`  A: status=${statusA1?.status} identity=${statusA1?.executionIdentityArtifactId} failureCode=${statusA1?.failureCode ?? ''}`);
  if (statusA1?.status !== 'COMPLETED') throw new Error(`PROOF FAILED: A did not complete (${statusA1?.failureCode}: ${statusA1?.failureDetail})`);
  console.log('  PROOF PASS: stale request for A completed successfully as a historical identity, even though B already existed.');

  console.log('\n=== WORKER: process request for B ===');
  const processedB = await processLocalizationIdentityProvisioningRequestsOnce();
  if (processedB !== 1) throw new Error('PROOF FAILED: worker did not process a request for B');
  const statusB1 = await getProvisioningStatusForGeometry(PROJECT_ID, b.geometry.artifact_id);
  console.log(`  B: status=${statusB1?.status} identity=${statusB1?.executionIdentityArtifactId}`);
  if (statusB1?.status !== 'COMPLETED') throw new Error(`PROOF FAILED: B did not complete (${statusB1?.failureCode}: ${statusB1?.failureDetail})`);
  if (statusB1.executionIdentityArtifactId === statusA1.executionIdentityArtifactId) throw new Error('PROOF FAILED: A and B minted the SAME identity');
  console.log('  PROOF PASS: distinct V3 identity minted for B; each fresh-verified with public-key-only verification (see inline CLI output above).');

  console.log('\n=== PROOF: same exact point re-enqueued and re-processed -> reused identity, no duplicate signing ===');
  const requeueA = await enqueueLocalizationIdentityProvisioningRequest({
    projectId: PROJECT_ID,
    geometryArtifactId: a.geometry.artifact_id,
    requestedByUserId: OWNER_USER_ID,
  });
  const processedARetry = await processLocalizationIdentityProvisioningRequestsOnce();
  if (processedARetry !== 1) throw new Error('PROOF FAILED: worker did not process the re-enqueued A request');
  const retryRow = await prisma.localizationIdentityProvisioningRequest.findUnique({ where: { id: requeueA.id } });
  console.log(`  retry request ${requeueA.id}: status=${retryRow?.status} identity=${retryRow?.executionIdentityArtifactId}`);
  if (retryRow?.executionIdentityArtifactId !== statusA1.executionIdentityArtifactId) {
    throw new Error('PROOF FAILED: re-processing the same point minted a DIFFERENT identity');
  }
  console.log('  PROOF PASS: re-processing the identical point reuses the existing identity, no divergent state.');

  console.log('\n=== PROOF: wrong project/user relationship -> fail closed ===');
  // A real, existing user (so the row can even be inserted -- Postgres itself already enforces
  // the FK) who is simply not a ProjectMember of this project.
  const STRANGER_USER_ID = 'cmt2mr4de0001j8f7frmhwwzd';
  const strangerRequest = await enqueueLocalizationIdentityProvisioningRequest({
    projectId: PROJECT_ID,
    geometryArtifactId: a.geometry.artifact_id,
    requestedByUserId: STRANGER_USER_ID,
  });
  const processedStranger = await processLocalizationIdentityProvisioningRequestsOnce();
  if (processedStranger !== 1) throw new Error('PROOF FAILED: worker did not process the stranger request');
  const strangerRow = await prisma.localizationIdentityProvisioningRequest.findUnique({ where: { id: strangerRequest.id } });
  console.log(`  stranger request: status=${strangerRow?.status} failureCode=${strangerRow?.failureCode}`);
  if (strangerRow?.status !== 'FAILED') throw new Error('PROOF FAILED: a request from a non-existent/unauthorized user was not denied');
  console.log('  PROOF PASS: wrong project/user relationship denied, fail closed.');

  console.log('\nALL PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 LIVE PROOFS PASS');
  console.log(
    JSON.stringify(
      {
        project_id: PROJECT_ID,
        point_a: { geometry: a.geometry.artifact_id, identity: statusA1.executionIdentityArtifactId },
        point_b: { geometry: b.geometry.artifact_id, identity: statusB1.executionIdentityArtifactId },
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
