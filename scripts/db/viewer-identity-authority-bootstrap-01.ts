/**
 * VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01 -- real end-to-end proof, then PRODUCT-LU-VIEWER-
 * AUTHORITY-BOOTSTRAP-01 step 7 (real capability issuance).
 *
 * Phase A proves the new ViewerIdentityArtifact trust chain (VIEWER_IDENTITY_ISSUER_V1) against
 * the real Mimer CAS: signed issuer, canonical release binding, deterministic identity, fresh
 * reopen with only the public key, and the full negative matrix.
 *
 * Phase B resumes the previously-STOPped step 7: issues exactly one real
 * ProductViewerCapabilityArtifact for the LU golden-path project, binding the newly-verified real
 * ViewerIdentityArtifact (not the placeholder used in VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1's
 * proof), installs it through the V2-only runtime path, fresh-reopens with only public keys, and
 * proves ViewerKernel.exportAsGeoJSON against one clearly-labeled proof-fixture evidence artifact
 * (not real LU evidence -- that binding is PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1's job).
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/db/viewer-identity-authority-bootstrap-01.ts
 */
import '../../server/loadEnvFirst';
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  createViewerIdentityArtifact,
  createViewerIdentityIssuerArtifact,
  createProductViewerCapabilityArtifact,
  type ViewerIdentityArtifact,
  type ProductViewerCapabilityArtifact,
} from '@miljobeslut/mps-lu';
import {
  attestViewerIdentityArtifact,
  attestViewerIdentityIssuerArtifact,
  verifyViewerIdentityArtifact,
} from '../../server/modules/localization/viewerIdentityAuthority';
import { attestProductViewerCapability } from '../../server/modules/localization/productViewerCapabilityAuthority';
import { installOwnerIssuedLocalizationViewerCapability } from '../../server/modules/localization/installLocalizationViewerCapability';
import { verifyInstalledLocalizationViewerCapability } from '../../server/modules/localization/installLocalizationViewerCapability';
import { __resetViewerIdentitySigningProviderForTests } from '../../server/security/viewerIdentitySigningKey';
import { __resetViewerIdentityVerifierForTests, getViewerIdentityVerifier } from '../../server/security/viewerIdentityVerifier';
import { __resetViewerCapabilitySigningProviderForTests } from '../../server/security/viewerCapabilitySigningKey';
import { __resetViewerCapabilityVerifierForTests } from '../../server/security/viewerCapabilityVerifier';

const REAL_PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const REAL_BINDING_ID = 'project-context-binding-32f1ff68cf89421ac4b75d86';
const REAL_RELEASE_ID = 'product-release-772aceb600c4690777593ea8';
const REAL_RELEASE_HASH = '772aceb600c4690777593ea89255ce20c062648eadf6ef6e0ecee3e36808c0fa';
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-manual-install-v1', artifact_type: 'owner_authority_attestation' };
const RELEASE_REF = { artifact_id: REAL_RELEASE_ID, artifact_type: 'product_release_manifest' };

async function expectRejected(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    console.log(`  ${label}: FAIL (did not reject)`);
    return false;
  } catch (error) {
    console.log(`  ${label}: PASS -- FAIL_CLOSED (${error instanceof Error ? error.message : String(error)})`);
    return true;
  }
}

async function main() {
  console.log('########## VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01 ##########\n');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  const results: Record<string, boolean> = {};
  const negatives: Record<string, boolean> = {};

  console.log('=== SETUP: dedicated VIEWER_IDENTITY_ISSUER_V1 Ed25519 key (never reused) ===\n');
  const idKeys = crypto.generateKeyPairSync('ed25519');
  const idPriv = idKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const idPub = idKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const IDENTITY_KEY_ID = `ed25519:viewer-identity-issuer-proof-${crypto.randomUUID().slice(0, 8)}`;
  process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = IDENTITY_KEY_ID;
  process.env.VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM = idPriv;
  process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = idPub;
  __resetViewerIdentitySigningProviderForTests(null);
  __resetViewerIdentityVerifierForTests(null);
  const identitySigning = new LocalPemSigningKeyProvider(IDENTITY_KEY_ID, idPriv, idPub);
  console.log(`identity issuer key_id: ${IDENTITY_KEY_ID}\n`);

  const mimers = await MimersIntegration.create({ forceMimers: true });

  console.log('=== PROOF: signed issuer authority ===\n');
  const unsignedIssuer = createViewerIdentityIssuerArtifact({ issuer_key_id: IDENTITY_KEY_ID, owner_authority_ref: OWNER_AUTHORITY_REF });
  const issuerAttestation = await attestViewerIdentityIssuerArtifact({ issuer: unsignedIssuer, signing: identitySigning });
  const issuer = { ...unsignedIssuer, attestation: issuerAttestation };
  await mimers.artifactRepository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  results.signedIssuerAuthority = !!issuer.attestation && issuer.attestation.signer === IDENTITY_KEY_ID;
  console.log(`  issuer artifact_id: ${issuer.artifact_id}\n`);

  console.log('=== PROOF: deterministic ViewerIdentity identity ===\n');
  const commonInput = {
    runtime_component: 'canonical LU ViewerKernel / localization viewer runtime',
    product_release_ref: RELEASE_REF,
    product_release_hash: REAL_RELEASE_HASH,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: IDENTITY_KEY_ID,
  };
  const unsignedA = createViewerIdentityArtifact(commonInput);
  const unsignedB = createViewerIdentityArtifact(commonInput);
  results.deterministicIdentity = unsignedA.artifact_id === unsignedB.artifact_id && unsignedA.content_hash.value === unsignedB.content_hash.value;
  console.log(`  artifact_id (both builds): ${unsignedA.artifact_id} == ${unsignedB.artifact_id}: ${results.deterministicIdentity}\n`);

  console.log('=== PROOF: canonical product release binding ===\n');
  const release = await mimers.artifactRepository.resolve<{ release_hash?: { value: string } }>(RELEASE_REF);
  results.canonicalReleaseBinding = release.release_hash?.value === REAL_RELEASE_HASH;
  console.log(`  resolved release_hash: ${release.release_hash?.value} matches: ${results.canonicalReleaseBinding}\n`);

  const identityAttestation = await attestViewerIdentityArtifact({ identity: unsignedA, issuer, signing: identitySigning });
  const identity: ViewerIdentityArtifact = { ...unsignedA, attestation: identityAttestation };

  console.log('=== PROOF: persistent CAS write ===\n');
  await mimers.artifactRepository.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });
  results.persistentCasWrite = true;
  console.log(`  identity artifact_id: ${identity.artifact_id}\n`);

  console.log('=== PROOF: runtime can resolve exact viewer identity ===\n');
  const resolved = await verifyViewerIdentityArtifact({
    identityRef: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    repository: mimers.artifactRepository,
    verification: getViewerIdentityVerifier(),
    releaseId: REAL_RELEASE_ID,
    releaseHash: REAL_RELEASE_HASH,
  });
  results.runtimeResolvesExactIdentity = resolved.artifact_id === identity.artifact_id;
  console.log(`  resolved & verified: ${results.runtimeResolvesExactIdentity}\n`);

  console.log('=== NEGATIVE PROOFS ===\n');
  negatives.unsignedIdentity = await expectRejected('unsigned identity', async () => {
    const bareIdentity = { ...unsignedB, attestation: undefined };
    await mimers.artifactRepository.put({ artifact_id: bareIdentity.artifact_id, content_hash: bareIdentity.content_hash, body: bareIdentity });
    await verifyViewerIdentityArtifact({
      identityRef: { artifact_id: bareIdentity.artifact_id, artifact_type: bareIdentity.artifact_type },
      repository: mimers.artifactRepository, verification: getViewerIdentityVerifier(),
      releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH,
    });
  });

  negatives.tamperedIdentity = await expectRejected('tampered identity', async () => {
    const tampered = { ...identity, payload: { ...identity.payload, runtime_component: 'some-other-component' } };
    await mimers.artifactRepository.put({ artifact_id: `${tampered.artifact_id}-tampered-probe`, content_hash: tampered.content_hash, body: { ...tampered, artifact_id: `${tampered.artifact_id}-tampered-probe` } });
    await verifyViewerIdentityArtifact({
      identityRef: { artifact_id: `${tampered.artifact_id}-tampered-probe`, artifact_type: tampered.artifact_type },
      repository: mimers.artifactRepository, verification: getViewerIdentityVerifier(),
      releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH,
    });
  });

  negatives.wrongProductRelease = await expectRejected('wrong product release', () => verifyViewerIdentityArtifact({
    identityRef: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    repository: mimers.artifactRepository, verification: getViewerIdentityVerifier(),
    releaseId: 'wrong-release-id', releaseHash: REAL_RELEASE_HASH,
  }));

  negatives.unknownIssuer = await expectRejected('unknown issuer', async () => {
    const orphan = createViewerIdentityArtifact({ ...commonInput, issuer_ref: { artifact_id: 'nonexistent-issuer', artifact_type: 'viewer_identity_issuer' } });
    const orphanAttestation = await attestViewerIdentityArtifact({ identity: orphan, issuer: { ...issuer, artifact_id: 'nonexistent-issuer' }, signing: identitySigning });
    const orphanIdentity = { ...orphan, attestation: orphanAttestation };
    await mimers.artifactRepository.put({ artifact_id: orphanIdentity.artifact_id, content_hash: orphanIdentity.content_hash, body: orphanIdentity });
    await verifyViewerIdentityArtifact({
      identityRef: { artifact_id: orphanIdentity.artifact_id, artifact_type: orphanIdentity.artifact_type },
      repository: mimers.artifactRepository, verification: getViewerIdentityVerifier(),
      releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH,
    });
  });

  negatives.wrongIssuerScope = await expectRejected('wrong issuer scope', async () => {
    const wrongScopeIssuerUnsigned = { ...unsignedIssuer, payload: { ...unsignedIssuer.payload, allowed_artifact_type: 'viewer_capability' as any } };
    const wrongScopeAttestation = await attestViewerIdentityIssuerArtifact({ issuer: wrongScopeIssuerUnsigned as any, signing: identitySigning });
    const wrongScopeIssuer = { ...wrongScopeIssuerUnsigned, attestation: wrongScopeAttestation };
    await mimers.artifactRepository.put({ artifact_id: `${wrongScopeIssuer.artifact_id}-scope-probe`, content_hash: wrongScopeIssuer.content_hash, body: { ...wrongScopeIssuer, artifact_id: `${wrongScopeIssuer.artifact_id}-scope-probe` } });
    const identityUnderWrongIssuer = createViewerIdentityArtifact({ ...commonInput, issuer_ref: { artifact_id: `${wrongScopeIssuer.artifact_id}-scope-probe`, artifact_type: wrongScopeIssuer.artifact_type } });
    const identityAttestationUnderWrongIssuer = await attestViewerIdentityArtifact({ identity: identityUnderWrongIssuer, issuer: wrongScopeIssuer as any, signing: identitySigning });
    const finalIdentity = { ...identityUnderWrongIssuer, attestation: identityAttestationUnderWrongIssuer };
    await mimers.artifactRepository.put({ artifact_id: finalIdentity.artifact_id, content_hash: finalIdentity.content_hash, body: finalIdentity });
    await verifyViewerIdentityArtifact({
      identityRef: { artifact_id: finalIdentity.artifact_id, artifact_type: finalIdentity.artifact_type },
      repository: mimers.artifactRepository, verification: getViewerIdentityVerifier(),
      releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH,
    });
  });

  negatives.fixtureViewerIdentity = await expectRejected('fixture viewer identity (V1 hardcoded fixture id)', () => verifyViewerIdentityArtifact({
    identityRef: { artifact_id: 'viewer-identity-lu-1', artifact_type: 'viewer_identity' },
    repository: mimers.artifactRepository, verification: getViewerIdentityVerifier(),
    releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH,
  }));

  negatives.callerSelectedViewerIdentity = await expectRejected('caller-selected viewer identity (arbitrary unbacked id)', () => verifyViewerIdentityArtifact({
    identityRef: { artifact_id: 'caller-selected-identity-not-in-cas', artifact_type: 'viewer_identity' },
    repository: mimers.artifactRepository, verification: getViewerIdentityVerifier(),
    releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH,
  }));

  console.log('\n=== PROOF: fresh reopen, public-key-only verification, private key absent ===\n');
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM;
  const childOut = execSync(
    `npx tsx scripts/db/_viewer-identity-fresh-reopen-verifier.ts ${identity.artifact_id} ${REAL_RELEASE_ID} ${REAL_RELEASE_HASH}`,
    { cwd: process.cwd(), env: childEnv, encoding: 'utf-8' },
  );
  const childResult = JSON.parse(childOut.trim().split('\n').filter(Boolean).pop() || '{}');
  console.log('  fresh-reopen child result:', childResult);
  results.freshReopen = childResult.ok === true;
  results.publicKeyOnlyVerification = childResult.ok === true;
  results.privateKeyAbsentAtReopen = childResult.privateKeyEnvPresent === false && childResult.publicKeyEnvPresent === true;

  console.log('\n========== PHASE A SUMMARY ==========');
  console.log('POSITIVE:', JSON.stringify(results, null, 2));
  console.log('NEGATIVE:', JSON.stringify(negatives, null, 2));
  const phaseAOk = Object.values(results).every(Boolean) && Object.values(negatives).every(Boolean);
  console.log(`\nPHASE A ALL GREEN: ${phaseAOk}`);
  if (!phaseAOk) throw new Error('Phase A did not pass cleanly; refusing to proceed to real capability issuance.');

  // -----------------------------------------------------------------------
  console.log('\n\n########## PHASE B: resume PRODUCT-LU-VIEWER-AUTHORITY-BOOTSTRAP-01 step 7 ##########\n');

  console.log('=== SETUP: dedicated VIEWER_CAPABILITY_ISSUER_V1 Ed25519 key ===\n');
  const capKeys = crypto.generateKeyPairSync('ed25519');
  const capPriv = capKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const capPub = capKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const CAP_KEY_ID = `ed25519:viewer-capability-issuer-golden-path-${crypto.randomUUID().slice(0, 8)}`;
  process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = CAP_KEY_ID;
  process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM = capPriv;
  process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = capPub;
  __resetViewerCapabilitySigningProviderForTests(null);
  __resetViewerCapabilityVerifierForTests(null);
  const capSigning = new LocalPemSigningKeyProvider(CAP_KEY_ID, capPriv, capPub);

  const { createViewerCapabilityIssuerArtifact } = await import('@miljobeslut/mps-lu');
  const { attestViewerCapabilityIssuerArtifact } = await import('../../server/modules/localization/productViewerCapabilityAuthority');
  const unsignedCapIssuer = createViewerCapabilityIssuerArtifact({ issuer_key_id: CAP_KEY_ID, owner_authority_ref: OWNER_AUTHORITY_REF });
  const capIssuerAttestation = await attestViewerCapabilityIssuerArtifact({ issuer: unsignedCapIssuer, signing: capSigning });
  const capIssuer = { ...unsignedCapIssuer, attestation: capIssuerAttestation };
  await mimers.artifactRepository.put({ artifact_id: capIssuer.artifact_id, content_hash: capIssuer.content_hash, body: capIssuer });
  console.log(`capability issuer artifact_id: ${capIssuer.artifact_id}\n`);

  console.log('=== ISSUE: exactly one real ProductViewerCapabilityArtifact for the LU golden-path project ===\n');
  const validFrom = new Date().toISOString();
  const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const unsignedCapability = createProductViewerCapabilityArtifact({
    issuer_key_id: CAP_KEY_ID,
    issuer_ref: { artifact_id: capIssuer.artifact_id, artifact_type: capIssuer.artifact_type },
    subject_project_id: REAL_PROJECT_ID,
    project_context_binding_ref: { artifact_id: REAL_BINDING_ID, artifact_type: 'project_context_binding' },
    viewer_identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    product_release_ref: RELEASE_REF,
    product_release_hash: REAL_RELEASE_HASH,
    valid_from: validFrom,
    valid_until: validUntil,
  });
  const capabilityAttestation = await attestProductViewerCapability({ capability: unsignedCapability, issuer: capIssuer, signing: capSigning });
  const capability: ProductViewerCapabilityArtifact = { ...unsignedCapability, attestation: capabilityAttestation };
  console.log(`capability artifact_id: ${capability.artifact_id}`);
  console.log(`valid_from: ${validFrom}`);
  console.log(`valid_until: ${validUntil}\n`);

  console.log('=== INSTALL through V2-only runtime path, persistent CAS ===\n');
  const now = new Date();
  const installation = await installOwnerIssuedLocalizationViewerCapability({
    artifactRepository: mimers.artifactRepository,
    capability,
    now: () => now,
  });
  console.log(`installed: ${JSON.stringify(installation, null, 2)}\n`);

  console.log('=== SEED: one clearly-labeled proof-fixture spatial evidence artifact (NOT real LU evidence) ===\n');
  const proofEvidence = {
    artifact_id: 'spatial-evidence-VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01-PROOF-FIXTURE',
    artifact_type: 'SPATIAL_EVIDENCE',
    content_hash: { algorithm: 'sha256', value: 'proof-fixture-not-real-evidence' },
    references: [{ artifact_id: 'property-proof-fixture', artifact_type: 'PROPERTY' }],
    payload: {
      result_semantics: {
        kind: 'EXISTENCE_WITHIN_DISTANCE',
        query: { subject_ref: { artifact_id: 'property-proof-fixture', artifact_type: 'PROPERTY' }, srid: 3006, distance_meters: 250 },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: 'property-proof-fixture', artifact_type: 'PROPERTY' },
      geometry: null,
      srid: 3006,
      operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: 'proof-fixture' },
      layer_ref: { layer_id: 'water', version_hash: 'b'.repeat(64), layer_version: 'v1' },
      source_metadata: { provider: 'PROOF-FIXTURE', dataset: 'water', dataset_version: 'b'.repeat(64), retrieved_at: now.toISOString() },
      query_context: { query_id: 'viewer-identity-bootstrap-proof', query_type: 'SPATIAL_DWITHIN', parameters: {} },
    },
  };
  await mimers.artifactRepository.put({ artifact_id: proofEvidence.artifact_id, content_hash: proofEvidence.content_hash, body: proofEvidence });

  console.log('=== FRESH REOPEN, public-key-only, prove ViewerKernel.exportAsGeoJSON ===\n');
  const childEnv2: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv2.VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM;
  delete childEnv2.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM;
  childEnv2.LU_VIEWER_CAPABILITY_ARTIFACT_ID = installation.runtimeConfig.capabilityArtifactId;
  childEnv2.LU_VIEWER_PROJECT_ID = installation.runtimeConfig.expectedProjectId;
  childEnv2.LU_VIEWER_CONTEXT_BINDING_ID = installation.runtimeConfig.expectedContextBindingId;
  childEnv2.LU_VIEWER_IDENTITY_ID = installation.runtimeConfig.expectedViewerIdentityId;
  childEnv2.LU_VIEWER_RELEASE_ID = installation.runtimeConfig.expectedReleaseId;
  childEnv2.LU_VIEWER_RELEASE_HASH = installation.runtimeConfig.expectedReleaseHash;
  const childOut2 = execSync(
    `npx tsx scripts/db/_viewer-golden-path-fresh-reopen-verifier.ts ${proofEvidence.artifact_id}`,
    { cwd: process.cwd(), env: childEnv2, encoding: 'utf-8' },
  );
  const childResult2 = JSON.parse(childOut2.trim().split('\n').filter(Boolean).pop() || '{}');
  console.log('  fresh-reopen + exportAsGeoJSON child result:', childResult2);

  console.log('\n\n========== FINAL SUMMARY ==========');
  console.log(JSON.stringify({
    identity_artifact_id: identity.artifact_id,
    identity_issuer_artifact_id: issuer.artifact_id,
    identity_issuer_key_id: IDENTITY_KEY_ID,
    capability_artifact_id: capability.artifact_id,
    capability_issuer_artifact_id: capIssuer.artifact_id,
    capability_issuer_key_id: CAP_KEY_ID,
    project: REAL_PROJECT_ID,
    context_binding: REAL_BINDING_ID,
    release: REAL_RELEASE_ID,
    valid_from: validFrom,
    valid_until: validUntil,
    phaseA_allGreen: phaseAOk,
    phaseB_freshReopenExportOk: childResult2.ok === true,
  }, null, 2));

  await mimers.rebuildIndex();
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exitCode = 1;
});
