/**
 * PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 -- Proof B.
 *
 * Live, real-DB/real-CAS proof of the full fresh zero-manual product chain for a BRAND NEW
 * project created by this script (never touching any pre-existing project):
 *
 *   new project -> ProjectContextBootstrapRequest -> bootstrap worker (mints V2 binding)
 *   -> viewer-capability trigger -> viewer-capability worker (pinned validity window)
 *   -> user geometry save (auto-enqueues execution-identity-v3 request)
 *   -> execution-identity-v3 worker
 *   -> GenerateLocalizationReportUseCase (real ExecutionKernel run, persists assessment)
 *   -> governed GET /viewer/evidence equivalent (resolveLuViewerPresentation)
 *
 * Every worker step is driven via the same *ProcessRequestsOnce() one-shot function the real
 * standalone worker processes call, with the real private keys loaded directly from
 * C:/Users/jimmy/.mimers/secrets/* for the duration of that one call only -- never written to
 * .env.local or any file the web process reads.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-lu-fresh-zero-manual-chain-01.ts
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { prisma } from '../../server/db/prisma';
import type { AuthUser } from '../../server/security/types';
import { createLocalizationProject } from '../../server/modules/localization/localizationProjectDiscovery';
import { enqueueProjectContextBootstrapRequest, getBootstrapRequestStatusForProject } from '../../server/modules/localization/projectContextBootstrapRequestQueue';
import { processProjectContextBootstrapRequestsOnce } from '../../server/services/luProjectContextBootstrapWorker';
import { ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap } from '../../server/modules/localization/viewerCapabilityProvisioningTrigger';
import { processViewerCapabilityProvisioningRequestsOnce } from '../../server/services/luViewerCapabilityProvisioningWorker';
import { getLatestProvisioningRequestForProject } from '../../server/modules/localization/viewerCapabilityProvisioningQueue';
import { saveUserLocalizationGeometry } from '../../server/modules/localization/localizationGeometryService';
import { processLocalizationIdentityProvisioningRequestsOnce } from '../../server/services/luExecutionIdentityV3ProvisioningWorker';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';
import { resolveLuViewerPresentation } from '../../server/modules/localization/localizationOrchestrator';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const ORG_ID = 'cmsjwmjds0000n4f7il7hf00a';
const USER_ID = 'cmsjwmjel0001n4f7l8yuybwm';
const PROPERTY_DESIGNATION = 'ORSA STACKMORA 3:12';
const [LNG, LAT] = [14.6645, 61.1348];

async function main() {
  console.log('########## PROVE-LU-FRESH-ZERO-MANUAL-CHAIN-01 (Proof B) ##########\n');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  const results: Record<string, boolean> = {};
  const authUser: AuthUser = { id: USER_ID, organisationId: ORG_ID, bankidId: 'admin:admin', role: 'ADMIN' };

  // Public keys needed by verification-only code paths throughout the chain.
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = 'project-context-binding-issuer-v1-fb38fb09cba8f5f8';
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`, 'utf-8');
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = 'ed25519:lu-execution-issuer-v1-656368e58631c925';
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-public.pem`, 'utf-8');
  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = 'ed25519:lu-execution-root-v1-839f2a91ad203e79';
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/lu-execution-authority/root-public.pem`, 'utf-8');
  process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = 'ed25519:viewer-capability-issuer-v1';
  process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/viewer-capability-issuer-v1/public.pem`, 'utf-8');
  process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = 'ed25519:viewer-identity-issuer-v1';
  process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/viewer-identity-issuer-v1/public.pem`, 'utf-8');

  console.log('=== STEP 1: create brand-new project ===\n');
  const project = await createLocalizationProject({
    organisationId: ORG_ID,
    propertyDesignation: PROPERTY_DESIGNATION,
    name: `PROOF-B fresh chain ${new Date().toISOString()}`,
    userId: USER_ID,
  });
  console.log(`  project.id: ${project.id}\n`);
  results.projectCreated = !!project.id;

  console.log('=== STEP 2: enqueue + run bootstrap (mints V2 ProjectContextBinding) ===\n');
  await enqueueProjectContextBootstrapRequest({
    projectId: project.id,
    requestedByUserId: USER_ID,
    propertyDesignation: PROPERTY_DESIGNATION,
  });
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM = readFileSync(`${SECRETS_DIR}/project-context-binding-issuer-v1-private.pem`, 'utf-8');
  const bootstrapProcessed = await processProjectContextBootstrapRequestsOnce();
  delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM;
  const bootstrapStatus = await getBootstrapRequestStatusForProject(project.id);
  console.log(`  processed: ${bootstrapProcessed}, status: ${bootstrapStatus?.status}, binding: ${bootstrapStatus?.contextBindingArtifactId}\n`);
  results.bootstrapCompleted = bootstrapStatus?.status === 'COMPLETED' && !!bootstrapStatus.contextBindingArtifactId;

  if (!bootstrapStatus?.contextBindingArtifactId) throw new Error('bootstrap did not complete -- cannot continue');
  const bindingId = bootstrapStatus.contextBindingArtifactId;

  console.log('=== STEP 3: trigger + run ViewerCapability provisioning (pinned validity window) ===\n');
  await ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap({
    projectId: project.id,
    contextBindingArtifactId: bindingId,
    requestedByUserId: USER_ID,
  });
  process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM = readFileSync(`${SECRETS_DIR}/viewer-capability-issuer-v1/private.pem`, 'utf-8');
  const vcProcessed = await processViewerCapabilityProvisioningRequestsOnce();
  delete process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM;
  const vcStatus = await getLatestProvisioningRequestForProject(project.id);
  console.log(`  processed: ${vcProcessed}, status: ${vcStatus?.status}, capability: ${vcStatus?.capabilityArtifactId}, validFrom: ${vcStatus?.capabilityValidFrom}, validUntil: ${vcStatus?.capabilityValidUntil}\n`);
  results.viewerCapabilityCompleted = vcStatus?.status === 'COMPLETED' && !!vcStatus.capabilityArtifactId;
  results.viewerCapabilityHasPinnedWindow = !!vcStatus?.capabilityValidFrom && !!vcStatus?.capabilityValidUntil;

  console.log('=== STEP 4: save user localization geometry (auto-enqueues execution-identity-v3) ===\n');
  const geometryResult = await saveUserLocalizationGeometry({
    authUser,
    projectId: project.id,
    input: { geometry_type: 'POINT', coordinates: [LNG, LAT], srid: 4326 },
  });
  console.log(`  geometry ok: ${geometryResult.ok}\n`);
  results.geometrySaved = geometryResult.ok === true;

  console.log('=== STEP 5: run execution-identity-v3 worker ===\n');
  process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-private.pem`, 'utf-8');
  const identityProcessed = await processLocalizationIdentityProvisioningRequestsOnce();
  delete process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
  console.log(`  processed: ${identityProcessed}\n`);
  results.executionIdentityProcessed = identityProcessed === 1;

  console.log('=== STEP 6: run real GenerateLocalizationReportUseCase (ExecutionKernel) ===\n');
  const usecase = new GenerateLocalizationReportUseCase();
  const report = await usecase.execute({
    projectId: project.id,
    siteAlternatives: [{ id: 'proof-b-run', name: PROPERTY_DESIGNATION, lat: LAT, lng: LNG }],
  });
  const motor = report.siteAnalyses[0]?.executionMotor;
  console.log(`  assessment_status: ${motor?.assessment_status}, admitted: ${motor?.admitted}, assessment_artifact_id: ${motor?.assessment_artifact_id}\n`);
  results.executionKernelAdmitted = motor?.admitted === true;
  results.assessed = motor?.assessment_status === 'ASSESSED';
  results.assessmentArtifactPersisted = !!motor?.assessment_artifact_id;

  console.log('=== STEP 7: governed presentation read (resolveLuViewerPresentation) ===\n');
  const presentation = await resolveLuViewerPresentation({ authUser, projectId: project.id });
  if (presentation.ok) {
    console.log(`  ok: true, assessmentArtifactId: ${presentation.assessmentArtifactId}, capabilityArtifactId: ${presentation.capabilityArtifactId}\n`);
    results.governedPresentationOk = true;
    results.governedPresentationMatchesAssessment = presentation.assessmentArtifactId === motor?.assessment_artifact_id;
    results.governedPresentationUsesV2Binding = presentation.capabilityArtifactId === vcStatus?.capabilityArtifactId;
  } else {
    console.log(`  ok: false, status: ${presentation.status}, error: ${presentation.error}\n`);
    results.governedPresentationOk = false;
    results.governedPresentationMatchesAssessment = false;
    results.governedPresentationUsesV2Binding = false;
  }

  console.log('\n========== SUMMARY ==========');
  console.log(`  project.id: ${project.id}`);
  console.log(JSON.stringify(results, null, 2));
  const ok = Object.values(results).every(Boolean);
  console.log(`\nALL GREEN: ${ok}`);

  await prisma.$disconnect();
  process.exitCode = ok ? 0 : 1;
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
