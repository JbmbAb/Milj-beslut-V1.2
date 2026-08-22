/**
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B -- real, live proof run.
 *
 * Creates a SECOND real localization project for ORSA STACKMORA 3:12 (proving 1 property -> N
 * projects), enqueues a real bootstrap request, then runs the worker's own processing function
 * to lease and execute it for real against the real dev DB/CAS -- then proves idempotent retry
 * and a private-key-absent fail-closed case. Uses only the module functions the real routes/
 * worker use; nothing here is a special test-only code path.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-lu-project-context-bootstrap-phase-b.ts
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { prisma } from '../../server/db/prisma';
import { createLocalizationProject, listProjectsForProperty } from '../../server/modules/localization/localizationProjectDiscovery';
import {
  enqueueProjectContextBootstrapRequest,
  leaseOnePendingBootstrapRequest,
  markBootstrapRequestCompleted,
  markBootstrapRequestFailed,
  getBootstrapRequestStatusForProject,
} from '../../server/modules/localization/projectContextBootstrapRequestQueue';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const ORSA_PROPERTY_DESIGNATION = 'ORSA STACKMORA 3:12';
const ORSA_ORG_ID = 'cmsjwmjds0000n4f7il7hf00a';
const OWNER_USER_ID = 'cmsjwmjel0001n4f7l8yuybwm'; // admin:admin, real OWNER of the golden-path project

async function processOnceWithPrivateKey() {
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM = readFileSync(`${SECRETS_DIR}/project-context-binding-issuer-v1-private.pem`, 'utf8');
  const { executeProjectContextBootstrap } = await import('../../server/modules/localization/luProjectContextBootstrap');
  const request = await leaseOnePendingBootstrapRequest();
  if (!request) throw new Error('expected a PENDING request to lease');
  const outcome = await executeProjectContextBootstrap({ projectId: request.projectId, propertyDesignation: request.propertyDesignation });
  if (outcome.ok) {
    await markBootstrapRequestCompleted(request.id, outcome.contextBindingArtifactId);
  } else {
    await markBootstrapRequestFailed(request.id, outcome.failureCode, outcome.failureDetail);
  }
  return { request, outcome };
}

async function main() {
  console.log('=== PROOF 1: 1 property -> N projects (before) ===');
  const before = await listProjectsForProperty({ organisationId: ORSA_ORG_ID, propertyDesignation: ORSA_PROPERTY_DESIGNATION });
  console.log(`  existing localizations for ${ORSA_PROPERTY_DESIGNATION}: ${before.length}`);
  before.forEach((p) => console.log(`    - ${p.id} "${p.name}" (${p.status})`));

  console.log('\n=== creating a NEW second localization for the same property ===');
  const newProject = await createLocalizationProject({
    organisationId: ORSA_ORG_ID,
    propertyDesignation: ORSA_PROPERTY_DESIGNATION,
    name: `Phase B proof localization ${new Date().toISOString()}`,
    userId: OWNER_USER_ID,
  });
  console.log(`  created project ${newProject.id}`);

  const after = await listProjectsForProperty({ organisationId: ORSA_ORG_ID, propertyDesignation: ORSA_PROPERTY_DESIGNATION });
  console.log(`  localizations for ${ORSA_PROPERTY_DESIGNATION} now: ${after.length} (must be exactly ${before.length + 1})`);
  if (after.length !== before.length + 1) throw new Error('PROOF 1 FAILED: project was reused/deduplicated instead of newly created');
  console.log('  PROOF 1 PASS: distinct project, same property, both coexist.');

  console.log('\n=== PROOF: web server process (this process, before worker step) has NO private key ===');
  console.log(`  PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM present: ${Boolean(process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM)}`);
  if (process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM) throw new Error('PROOF FAILED: private key already present before the worker step');

  console.log('\n=== enqueue (as the real route does) ===');
  const request = await enqueueProjectContextBootstrapRequest({
    projectId: newProject.id,
    requestedByUserId: OWNER_USER_ID,
    propertyDesignation: ORSA_PROPERTY_DESIGNATION,
  });
  console.log(`  request ${request.id} status=${request.status}`);

  console.log('\n=== PROOF: worker without private key -> FAILED_CLOSED, explicit operational failure ===');
  {
    const { executeProjectContextBootstrap } = await import('../../server/modules/localization/luProjectContextBootstrap');
    const leased = await leaseOnePendingBootstrapRequest();
    if (!leased) throw new Error('expected to lease the just-enqueued request');
    const outcomeNoKey = await executeProjectContextBootstrap({ projectId: leased.projectId, propertyDesignation: leased.propertyDesignation });
    console.log(`  outcome.ok=${outcomeNoKey.ok} failureCode=${!outcomeNoKey.ok ? outcomeNoKey.failureCode : ''}`);
    if (outcomeNoKey.ok) throw new Error('PROOF FAILED: worker minted without a private key');
    await markBootstrapRequestFailed(leased.id, outcomeNoKey.ok ? '' : outcomeNoKey.failureCode, outcomeNoKey.ok ? '' : outcomeNoKey.failureDetail);
    console.log('  PROOF PASS: no-private-key run failed closed, marked FAILED.');
  }

  console.log('\n=== retry: re-enqueue and process WITH the private key (worker process only) ===');
  const retryRequest = await enqueueProjectContextBootstrapRequest({
    projectId: newProject.id,
    requestedByUserId: OWNER_USER_ID,
    propertyDesignation: ORSA_PROPERTY_DESIGNATION,
  });
  console.log(`  retry request ${retryRequest.id} status=${retryRequest.status}`);
  const first = await processOnceWithPrivateKey();
  console.log(`  first real execution: ok=${first.outcome.ok} ${first.outcome.ok ? `binding=${first.outcome.contextBindingArtifactId} reused=${first.outcome.reused}` : `code=${first.outcome.failureCode} detail=${first.outcome.failureDetail}`}`);
  if (!first.outcome.ok) throw new Error('PROOF FAILED: real bootstrap execution did not succeed');

  console.log('\n=== PROOF: idempotent retry of the SAME project -> no duplicate/divergent binding ===');
  const secondEnqueue = await enqueueProjectContextBootstrapRequest({
    projectId: newProject.id,
    requestedByUserId: OWNER_USER_ID,
    propertyDesignation: ORSA_PROPERTY_DESIGNATION,
  });
  const second = await processOnceWithPrivateKey();
  console.log(`  second execution (should be a reuse): ok=${second.outcome.ok} ${second.outcome.ok ? `binding=${second.outcome.contextBindingArtifactId} reused=${second.outcome.reused}` : ''}`);
  if (!second.outcome.ok || !second.outcome.reused) throw new Error('PROOF FAILED: retry did not recognize/reuse the already-valid binding');
  if (first.outcome.ok && second.outcome.ok && first.outcome.contextBindingArtifactId !== second.outcome.contextBindingArtifactId) {
    throw new Error('PROOF FAILED: retry produced a DIFFERENT binding id -- divergent authority state');
  }
  console.log('  PROOF PASS: same contextBindingArtifactId on retry, no divergence.');
  void secondEnqueue;

  console.log('\n=== final status read (as the live web server would poll it) ===');
  const finalStatus = await getBootstrapRequestStatusForProject(newProject.id);
  console.log(JSON.stringify(finalStatus, null, 2));

  console.log('\nALL PHASE B LIVE PROOFS PASS');
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('FATAL:', error);
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
