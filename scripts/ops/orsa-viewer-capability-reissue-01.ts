/**
 * OWNER DECISION -- AUTHORIZE REAL ORSA VIEWER CAPABILITY PROVISIONING (2026-08-22).
 *
 * A distinct owner-provisioning action, NOT part of AUTHENTICATED-LU-UI-E2E-01 itself. Mints and
 * installs exactly one new ProductViewerCapabilityArtifact for ORSA bound to its CURRENT
 * canonical ProjectContextBinding head (project-context-binding-dd8e2bb706cfa9affab8fc19),
 * because the one real capability that already existed
 * (viewer-capability-b9dc302c42d332400659e4c2, minted by
 * scripts/ops/bootstrap-viewer-authority-persistent.ts) is bound to ORSA's OLD, now-superseded
 * binding (project-context-binding-32f1ff68cf89421ac4b75d86) and is correctly rejected by
 * VIEWER-CAPABILITY-CURRENT-BINDING-WIRING-01's currency check.
 *
 * Reuses, does not recreate: the existing persisted viewer-capability-issuer-v1 signing key
 * (~/.mimers/secrets/viewer-capability-issuer-v1), the existing ViewerCapabilityIssuerArtifact in
 * CAS, and the existing ViewerIdentityArtifact (viewer-identity-6b049e1012b59ef2d6726fd6, already
 * bound to the current release). No new key, trust root, issuer, or authority is created here.
 *
 * The private signing key is loaded and used only inside this offline script's own process. It is
 * never written to .env/.env.local and must never be exposed to the live web server process.
 *
 * Usage: npx tsx scripts/ops/orsa-viewer-capability-reissue-01.ts --execute
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { createProductViewerCapabilityArtifact, type ProductViewerCapabilityArtifact, type ViewerCapabilityIssuerArtifact } from '@miljobeslut/mps-lu';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import {
  attestProductViewerCapability,
  verifyViewerCapabilityIssuerArtifact,
} from '../../server/modules/localization/productViewerCapabilityAuthority';
import { installOwnerIssuedLocalizationViewerCapability } from '../../server/modules/localization/installLocalizationViewerCapability';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const EXPECTED_CURRENT_BINDING_ID = 'project-context-binding-dd8e2bb706cfa9affab8fc19';
const EXISTING_CAPABILITY_ID = 'viewer-capability-b9dc302c42d332400659e4c2';

function readPem(name: string, file: 'private' | 'public'): string {
  return readFileSync(`${SECRETS_DIR}/${name}/${file}.pem`, 'utf8');
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('refusing to write without --execute');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  // Existing public verification material only -- reused, not created. Set in this process only
  // so the reused verify/install functions (which read process.env) can run; never persisted here.
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = 'project-context-binding-issuer-v1-fb38fb09cba8f5f8';
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`, 'utf8');
  process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = 'ed25519:viewer-capability-issuer-v1';
  process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = readPem('viewer-capability-issuer-v1', 'public');
  process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = 'ed25519:viewer-identity-issuer-v1';
  process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = readPem('viewer-identity-issuer-v1', 'public');

  const mimers = await MimersIntegration.create({ forceMimers: true });

  // Step 1+2: resolve and verify ORSA's current canonical ProjectContextBinding head.
  const { getProjectContextBindingIssuerVerifier } = await import('../../server/security/projectContextBindingIssuerKey');
  const realBindingProvider = new ProjectContextBindingProvider(
    mimers.artifactRepository,
    new PrismaProjectContextBindingIndex(),
    getProjectContextBindingIssuerVerifier(),
  );
  const currentBinding = await realBindingProvider.resolveCurrent(PROJECT_ID);
  if (currentBinding.artifact_id !== EXPECTED_CURRENT_BINDING_ID) {
    throw new Error(
      `STOP: resolved current binding ${currentBinding.artifact_id} does not match expected ${EXPECTED_CURRENT_BINDING_ID}. Re-derive, do not proceed.`,
    );
  }
  console.log(`STEP 1+2 PASS: current ProjectContextBinding head = ${currentBinding.artifact_id}`);

  // Step 3+4a: resolve the EXISTING capability solely to discover the existing issuer, viewer
  // identity, and release refs to reuse -- never used as the capability itself.
  const existingCapability = await mimers.artifactRepository.resolve<ProductViewerCapabilityArtifact>({
    artifact_id: EXISTING_CAPABILITY_ID,
    artifact_type: 'viewer_capability',
  });
  const capIssuer = await mimers.artifactRepository.resolve<ViewerCapabilityIssuerArtifact>(
    existingCapability.payload.issuer_ref,
  );
  await verifyViewerCapabilityIssuerArtifact({
    issuer: capIssuer,
    verification: (await import('../../server/security/viewerCapabilityVerifier')).getViewerCapabilityVerifier(),
  });
  console.log(`STEP 3 PASS: reusing existing, verified ViewerCapabilityIssuerArtifact ${capIssuer.artifact_id} (key_id=${capIssuer.payload.issuer_key_id})`);

  const capPrivatePem = readPem('viewer-capability-issuer-v1', 'private');
  const capPublicPem = readPem('viewer-capability-issuer-v1', 'public');
  const signing = new LocalPemSigningKeyProvider(capIssuer.payload.issuer_key_id, capPrivatePem, capPublicPem);
  if (signing.keyId !== capIssuer.payload.issuer_key_id) {
    throw new Error('STOP: persisted signing key_id does not match existing issuer artifact key_id.');
  }

  // Step 4: mint exactly one new ProductViewerCapabilityArtifact bound to ORSA project + the
  // CURRENT binding head + current release + the SAME already-governed ViewerIdentity.
  const validFrom = new Date().toISOString();
  const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const bareCapability = createProductViewerCapabilityArtifact({
    issuer_key_id: capIssuer.payload.issuer_key_id,
    issuer_ref: { artifact_id: capIssuer.artifact_id, artifact_type: capIssuer.artifact_type },
    subject_project_id: PROJECT_ID,
    project_context_binding_ref: { artifact_id: currentBinding.artifact_id, artifact_type: 'project_context_binding' },
    viewer_identity_ref: existingCapability.payload.viewer_identity_ref,
    product_release_ref: existingCapability.payload.product_release_ref,
    product_release_hash: existingCapability.payload.product_release_hash,
    valid_from: validFrom,
    valid_until: validUntil,
  });
  const attestation = await attestProductViewerCapability({ capability: bareCapability, issuer: capIssuer, signing });
  const capability: ProductViewerCapabilityArtifact = { ...bareCapability, attestation } as ProductViewerCapabilityArtifact;
  console.log(`STEP 4 PASS: minted new capability ${capability.artifact_id} bound to current binding ${currentBinding.artifact_id}`);

  // Step 5+8+9: install through the existing owner/operator path, which independently
  // re-verifies the full chain (issuer trust, current-binding currency, viewer identity, release
  // hash, signature) using ONLY VerificationKeyProvider material before persisting.
  const result = await installOwnerIssuedLocalizationViewerCapability({
    artifactRepository: mimers.artifactRepository,
    capability,
    currentBindingProvider: realBindingProvider,
  });
  await mimers.rebuildIndex();
  console.log('STEP 5+8+9 PASS: installed and independently re-verified via installOwnerIssuedLocalizationViewerCapability.');

  console.log(
    JSON.stringify(
      {
        owner_provisioning: 'REAL_VIEWER_CAPABILITY_INSTALLED_VERIFIED',
        project_id: PROJECT_ID,
        resolved_current_binding_id: currentBinding.artifact_id,
        reused_issuer_artifact_id: capIssuer.artifact_id,
        reused_viewer_identity_id: existingCapability.payload.viewer_identity_ref.artifact_id,
        reused_release_id: existingCapability.payload.product_release_ref.artifact_id,
        installed_capability_artifact_id: result.artifactId,
        release_hash: result.releaseHash,
        valid_from: validFrom,
        valid_until: validUntil,
        runtime_environment: {
          LU_VIEWER_CAPABILITY_ARTIFACT_ID: result.runtimeConfig.capabilityArtifactId,
          LU_VIEWER_PROJECT_ID: result.runtimeConfig.expectedProjectId,
          LU_VIEWER_CONTEXT_BINDING_ID: result.runtimeConfig.expectedContextBindingId,
          LU_VIEWER_IDENTITY_ID: result.runtimeConfig.expectedViewerIdentityId,
          LU_VIEWER_RELEASE_ID: result.runtimeConfig.expectedReleaseId,
          LU_VIEWER_RELEASE_HASH: result.runtimeConfig.expectedReleaseHash,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
