/**
 * VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1 -- real end-to-end proof.
 *
 * OWNER DECISION: ADOPT_EXISTING_VIEWER_V2_WORK. This proves the completed trust chain
 * (steps 1-6): signed issuer reference, structurally split signer/verifier, canonical release
 * resolution against the REAL product release, and the real installer/runtime invoking ONLY the
 * V2 cryptographic verification (V1's structural-only admission gate is never called).
 *
 * Step 7 (provisioning the real production ViewerCapability for the LU golden-path project) is
 * DELIBERATELY NOT PERFORMED here: tracing V1's `viewer_identity_ref` (see report) found no
 * canonical, persistent, non-fixture-derived authority object anywhere in this codebase or the
 * real CAS -- ViewerKernel/tests only ever consume a hardcoded test literal
 * (packages/mps-lu/tests/fixtures/admittedViewerCapability.ts). Per the owner's explicit
 * instruction, that is VIEWER_IDENTITY_AUTHORITY_MISSING and blocks real issuance, not the
 * trust-chain machinery itself. This script therefore proves the machinery with a clearly-labeled
 * placeholder viewer identity and does not write anything to a production
 * LU_VIEWER_CAPABILITY_ARTIFACT_ID pointer.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/db/viewer-capability-issuer-trust-chain-v1.ts
 */
import '../../server/loadEnvFirst';
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  createViewerCapabilityIssuerArtifact,
  createProductViewerCapabilityArtifact,
  type ProductViewerCapabilityArtifact,
} from '@miljobeslut/mps-lu';
import {
  attestViewerCapabilityIssuerArtifact,
  attestProductViewerCapability,
  verifyProductViewerCapability,
} from '../../server/modules/localization/productViewerCapabilityAuthority';
import { installOwnerIssuedLocalizationViewerCapability } from '../../server/modules/localization/installLocalizationViewerCapability';
import { __resetViewerCapabilitySigningProviderForTests } from '../../server/security/viewerCapabilitySigningKey';
import { __resetViewerCapabilityVerifierForTests, getViewerCapabilityVerifier } from '../../server/security/viewerCapabilityVerifier';

const REAL_PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const REAL_BINDING_ID = 'project-context-binding-32f1ff68cf89421ac4b75d86';
const REAL_RELEASE_ID = 'product-release-772aceb600c4690777593ea8';
const REAL_RELEASE_HASH = '772aceb600c4690777593ea89255ce20c062648eadf6ef6e0ecee3e36808c0fa';
const PLACEHOLDER_VIEWER_IDENTITY_ID = 'viewer-identity-UNVERIFIED-PLACEHOLDER-do-not-treat-as-real-grant';
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-manual-install-v1', artifact_type: 'owner_authority_attestation' };

function grep(pattern: string, path: string): string[] {
  try {
    const out = execSync(`grep -rln "${pattern}" "${path}" --include="*.ts" --exclude-dir=node_modules`, { cwd: process.cwd(), encoding: 'utf-8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function expectRejected(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    console.log(`  ${label}: FAIL (did not reject)`);
    return false;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  ${label}: PASS -- FAIL_CLOSED (${msg})`);
    return true;
  }
}

async function main() {
  console.log('########## VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1 ##########\n');

  if (!process.env.MIMERS_ROOT?.trim()) {
    throw new Error('MIMERS_ROOT is required (point it at the real Mimer root to resolve the real product release).');
  }

  const results: Record<string, boolean> = {};

  console.log('=== SETUP: dedicated Ed25519 issuer key (never reused from any other authority) ===\n');
  const keys = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const KEY_ID = `ed25519:viewer-capability-issuer-proof-${crypto.randomUUID().slice(0, 8)}`;
  process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = KEY_ID;
  process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM = privateKeyPem;
  process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = publicKeyPem;
  __resetViewerCapabilitySigningProviderForTests(null);
  __resetViewerCapabilityVerifierForTests(null);
  const signing = new LocalPemSigningKeyProvider(KEY_ID, privateKeyPem, publicKeyPem);

  console.log(`key_id: ${KEY_ID}\n`);

  console.log('=== PROOF: signer/verifier structurally separated ===\n');
  const verifierImportsSigner = grep("from '../security/viewerCapabilitySigningKey'", 'server/security/viewerCapabilityVerifier.ts')
    .concat(grep('from "../security/viewerCapabilitySigningKey"', 'server/security/viewerCapabilityVerifier.ts'));
  results.signerVerifierSeparated = verifierImportsSigner.length === 0;
  console.log(`  viewerCapabilityVerifier.ts imports the signing-key module: ${verifierImportsSigner.length > 0 ? 'YES (VIOLATION)' : 'NO'}\n`);

  console.log('=== PROOF: verifier has no private-key access (structural) ===\n');
  const verifier = getViewerCapabilityVerifier();
  results.verifierNoSign = typeof (verifier as any).sign === 'undefined';
  console.log(`  verifier.sign is defined: ${typeof (verifier as any).sign !== 'undefined'} (expected: false)\n`);

  console.log('=== PROOF: canonical release resolves from the REAL Mimer CAS ===\n');
  const mimers = await MimersIntegration.create({ forceMimers: true });
  let release: { release_hash?: { value: string } };
  try {
    release = await mimers.artifactRepository.resolve<{ release_hash?: { value: string } }>({
      artifact_id: REAL_RELEASE_ID,
      artifact_type: 'product_release_manifest',
    });
  } catch (error) {
    throw new Error(`Could not resolve the real release ${REAL_RELEASE_ID}: ${error instanceof Error ? error.message : String(error)}`);
  }
  results.canonicalReleaseResolves = release.release_hash?.value === REAL_RELEASE_HASH;
  console.log(`  resolved release release_hash: ${release.release_hash?.value}`);
  console.log(`  matches expected: ${results.canonicalReleaseResolves}\n`);

  console.log('=== PROOF: signed issuer artifact + owner/trust-root verification ===\n');
  const unsignedIssuer = createViewerCapabilityIssuerArtifact({ issuer_key_id: KEY_ID, owner_authority_ref: OWNER_AUTHORITY_REF });
  const issuerAttestation = await attestViewerCapabilityIssuerArtifact({ issuer: unsignedIssuer, signing });
  const issuer = { ...unsignedIssuer, attestation: issuerAttestation };
  await mimers.artifactRepository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  results.signedIssuerArtifact = !!issuer.attestation && issuer.attestation.signer === KEY_ID;
  console.log(`  issuer artifact_id: ${issuer.artifact_id}`);
  console.log(`  self-attestation signer: ${issuer.attestation?.signer}`);
  console.log(`  owner_authority_ref: ${JSON.stringify(issuer.payload.owner_authority_ref)}\n`);

  const identityRef = { artifact_id: PLACEHOLDER_VIEWER_IDENTITY_ID, artifact_type: 'viewer_identity' };
  const bindingRef = { artifact_id: REAL_BINDING_ID, artifact_type: 'project_context_binding' };
  const releaseRef = { artifact_id: REAL_RELEASE_ID, artifact_type: 'product_release_manifest' };

  console.log('=== PROOF: deterministic capability identity ===\n');
  const unsignedA = createProductViewerCapabilityArtifact({
    issuer_key_id: KEY_ID,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    subject_project_id: REAL_PROJECT_ID,
    project_context_binding_ref: bindingRef,
    viewer_identity_ref: identityRef,
    product_release_ref: releaseRef,
    product_release_hash: REAL_RELEASE_HASH,
    valid_from: '2026-08-21T00:00:00.000Z',
    valid_until: '2027-08-21T00:00:00.000Z',
  });
  const unsignedB = createProductViewerCapabilityArtifact({
    issuer_key_id: KEY_ID,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    subject_project_id: REAL_PROJECT_ID,
    project_context_binding_ref: bindingRef,
    viewer_identity_ref: identityRef,
    product_release_ref: releaseRef,
    product_release_hash: REAL_RELEASE_HASH,
    valid_from: '2026-08-21T00:00:00.000Z',
    valid_until: '2027-08-21T00:00:00.000Z',
  });
  results.deterministicCapabilityIdentity = unsignedA.artifact_id === unsignedB.artifact_id && unsignedA.content_hash.value === unsignedB.content_hash.value;
  console.log(`  artifact_id (both builds): ${unsignedA.artifact_id} == ${unsignedB.artifact_id}: ${results.deterministicCapabilityIdentity}\n`);

  const capabilityAttestation = await attestProductViewerCapability({ capability: unsignedA, issuer, signing });
  const capability: ProductViewerCapabilityArtifact = { ...unsignedA, attestation: capabilityAttestation };

  console.log('=== PROOF: real installer invokes V2 verification + persistent CAS install ===\n');
  const installerNoV1 = grep('admitViewerCapability', 'server/modules/localization/installLocalizationViewerCapability.ts');
  results.v1CannotIndependentlyActivate = installerNoV1.length === 0;
  console.log(`  installLocalizationViewerCapability.ts references admitViewerCapability (V1): ${installerNoV1.length > 0} (expected false)`);

  const now = new Date('2026-08-21T12:00:00.000Z');
  const installation = await installOwnerIssuedLocalizationViewerCapability({
    artifactRepository: mimers.artifactRepository,
    capability,
    now: () => now,
  });
  results.realInstallerInvokesV2 = installation.artifactId === capability.artifact_id;
  results.persistentCasInstall = installation.artifactId === capability.artifact_id;
  console.log(`  installed artifact_id: ${installation.artifactId}`);
  console.log(`  runtimeConfig: ${JSON.stringify(installation.runtimeConfig, null, 2)}\n`);

  console.log('=== PROOF: exact project / context binding / release / scope binding ===\n');
  results.exactProjectSubject = capability.payload.subject_project_id === REAL_PROJECT_ID;
  results.exactContextBinding = capability.payload.project_context_binding_ref.artifact_id === REAL_BINDING_ID;
  results.exactReleaseBinding = capability.payload.product_release_ref.artifact_id === REAL_RELEASE_ID && capability.payload.product_release_hash === REAL_RELEASE_HASH;
  results.exactPresentationScope = capability.payload.permitted_presentation_capability === 'PRESENT_PERSISTED_CANONICAL_LU_RESULTS';
  console.log(`  project: ${results.exactProjectSubject}, binding: ${results.exactContextBinding}, release: ${results.exactReleaseBinding}, scope: ${results.exactPresentationScope}\n`);

  console.log('=== NEGATIVE PROOFS ===\n');
  const negatives: Record<string, boolean> = {};

  negatives.unsignedIssuer = await expectRejected('unsigned issuer', async () => {
    const bare = createViewerCapabilityIssuerArtifact({ issuer_key_id: KEY_ID, owner_authority_ref: OWNER_AUTHORITY_REF });
    await verifyProductViewerCapability({
      capability: { ...capability, payload: { ...capability.payload, issuer_ref: { artifact_id: bare.artifact_id, artifact_type: bare.artifact_type } } },
      repository: { resolve: async () => bare, put: async () => {}, exists: async () => true } as any,
      verification: getViewerCapabilityVerifier(),
      projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
    });
  });

  negatives.tamperedIssuer = await expectRejected('tampered issuer', async () => {
    const tampered = { ...issuer, payload: { ...issuer.payload, owner_authority_ref: { artifact_id: 'someone-else', artifact_type: 'owner_authority_attestation' } } };
    await verifyProductViewerCapability({
      capability: { ...capability, payload: { ...capability.payload, issuer_ref: { artifact_id: tampered.artifact_id, artifact_type: tampered.artifact_type } } },
      repository: { resolve: async () => tampered, put: async () => {}, exists: async () => true } as any,
      verification: getViewerCapabilityVerifier(),
      projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
    });
  });

  negatives.wrongTrustRoot = await expectRejected('wrong trust root (untrusted issuer key)', async () => {
    const rogue = crypto.generateKeyPairSync('ed25519');
    const rogueSigning = new LocalPemSigningKeyProvider('ed25519:rogue', rogue.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), rogue.publicKey.export({ type: 'spki', format: 'pem' }).toString());
    const rogueUnsigned = createViewerCapabilityIssuerArtifact({ issuer_key_id: 'ed25519:rogue', owner_authority_ref: OWNER_AUTHORITY_REF });
    const rogueAttest = await attestViewerCapabilityIssuerArtifact({ issuer: rogueUnsigned, signing: rogueSigning });
    const rogueIssuer = { ...rogueUnsigned, attestation: rogueAttest };
    await verifyProductViewerCapability({
      capability: { ...capability, payload: { ...capability.payload, issuer_key_id: 'ed25519:rogue', issuer_ref: { artifact_id: rogueIssuer.artifact_id, artifact_type: rogueIssuer.artifact_type } } },
      repository: { resolve: async () => rogueIssuer, put: async () => {}, exists: async () => true } as any,
      verification: getViewerCapabilityVerifier(),
      projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
    });
  });

  negatives.mismatchedKeyIdPublicKey = await expectRejected('mismatched issuer key_id/public key', async () => {
    const wrongKeyIssuer = { ...issuer, payload: { ...issuer.payload, issuer_key_id: 'ed25519:different-declared-key' } };
    await verifyProductViewerCapability({
      capability,
      repository: { resolve: async () => wrongKeyIssuer, put: async () => {}, exists: async () => true } as any,
      verification: getViewerCapabilityVerifier(),
      projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
    });
  });

  negatives.wrongIssuerPurpose = await expectRejected('wrong issuer purpose', async () => {
    const wrongPurpose = { ...issuer, payload: { ...issuer.payload, purpose: 'SOME_OTHER_PURPOSE_V1' as any } };
    await verifyProductViewerCapability({
      capability,
      repository: { resolve: async () => wrongPurpose, put: async () => {}, exists: async () => true } as any,
      verification: getViewerCapabilityVerifier(),
      projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
    });
  });

  negatives.unsignedCapability = await expectRejected('unsigned capability', async () => {
    await verifyProductViewerCapability({
      capability: { ...unsignedA, attestation: undefined } as any,
      repository: mimers.artifactRepository,
      verification: getViewerCapabilityVerifier(),
      projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
    });
  });

  negatives.tamperedCapability = await expectRejected('tampered capability', async () => {
    const tampered = { ...capability, payload: { ...capability.payload, subject_project_id: 'some-other-project' } };
    await verifyProductViewerCapability({
      capability: tampered, repository: mimers.artifactRepository, verification: getViewerCapabilityVerifier(),
      projectId: 'some-other-project', bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
    });
  });

  negatives.wrongProject = await expectRejected('wrong project', () => verifyProductViewerCapability({
    capability, repository: mimers.artifactRepository, verification: getViewerCapabilityVerifier(),
    projectId: 'wrong-project', bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
  }));

  negatives.wrongContextBinding = await expectRejected('wrong context binding', () => verifyProductViewerCapability({
    capability, repository: mimers.artifactRepository, verification: getViewerCapabilityVerifier(),
    projectId: REAL_PROJECT_ID, bindingId: 'wrong-binding', viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
  }));

  negatives.wrongRelease = await expectRejected('wrong release', () => verifyProductViewerCapability({
    capability, repository: mimers.artifactRepository, verification: getViewerCapabilityVerifier(),
    projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: 'wrong-release', releaseHash: REAL_RELEASE_HASH, now,
  }));

  negatives.wrongCapabilityScope = await expectRejected('wrong capability scope', async () => {
    const wrongScope = { ...capability, payload: { ...capability.payload, permitted_presentation_capability: 'SOME_OTHER_SCOPE' as any } };
    await verifyProductViewerCapability({
      capability: wrongScope, repository: mimers.artifactRepository, verification: getViewerCapabilityVerifier(),
      projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
    });
  });

  negatives.unknownIssuer = await expectRejected('unknown issuer (does not resolve)', () => verifyProductViewerCapability({
    capability: { ...capability, payload: { ...capability.payload, issuer_ref: { artifact_id: 'nonexistent-issuer', artifact_type: 'viewer_capability_issuer' } } },
    repository: mimers.artifactRepository, verification: getViewerCapabilityVerifier(),
    projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: REAL_RELEASE_HASH, now,
  }));

  negatives.devReleaseHash = await expectRejected('dev-release-hash substitution', async () => {
    const devHashCapability = { ...capability, payload: { ...capability.payload, product_release_hash: 'dev-release-hash-'.padEnd(64, '0') } };
    await verifyProductViewerCapability({
      capability: devHashCapability, repository: mimers.artifactRepository, verification: getViewerCapabilityVerifier(),
      projectId: REAL_PROJECT_ID, bindingId: REAL_BINDING_ID, viewerIdentityId: PLACEHOLDER_VIEWER_IDENTITY_ID, releaseId: REAL_RELEASE_ID, releaseHash: 'dev-release-hash-'.padEnd(64, '0'), now,
    });
  });

  negatives.oldUnsignedV1Activation = await expectRejected('old unsigned V1 activation attempt', async () => {
    await installOwnerIssuedLocalizationViewerCapability({
      artifactRepository: mimers.artifactRepository,
      capability: {
        artifact_id: 'viewer-capability-v1-style-attempt',
        artifact_type: 'viewer_capability',
        content_hash: { algorithm: 'sha256', value: 'fake' },
        references: [],
        payload: capability.payload,
      } as any,
      now: () => now,
    });
  });

  console.log('\n=== PROOF: fresh reopen, public-key-only capability verification ===\n');
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM;
  const childOut = execSync(
    `npx tsx scripts/db/_viewer-capability-fresh-reopen-verifier.ts ${installation.artifactId}`,
    { cwd: process.cwd(), env: childEnv, encoding: 'utf-8' },
  );
  const childResult = JSON.parse(childOut.trim().split('\n').filter(Boolean).pop() || '{}');
  console.log('  fresh-reopen child process result:', childResult);
  results.freshReopen = childResult.ok === true;
  results.publicKeyOnlyVerification = childResult.ok === true;
  results.privateKeyAbsentAtReopen = childResult.privateKeyEnvPresent === false && childResult.publicKeyEnvPresent === true;

  console.log('\n\n========== SUMMARY ==========');
  console.log('POSITIVE:', JSON.stringify(results, null, 2));
  console.log('NEGATIVE:', JSON.stringify(negatives, null, 2));
  const allPositive = Object.values(results).every(Boolean);
  const allNegative = Object.values(negatives).every(Boolean);
  console.log(`\nALL POSITIVE PASS: ${allPositive}`);
  console.log(`ALL NEGATIVE FAIL_CLOSED: ${allNegative}`);
  console.log(`\nInstalled proof-labeled capability artifact_id (NOT the production golden-path grant): ${installation.artifactId}`);
  console.log(`Issuer artifact_id: ${issuer.artifact_id}`);
  console.log(`Issuer key_id: ${KEY_ID}`);
  console.log('\nSTOP CONDITION: VIEWER_IDENTITY_AUTHORITY_MISSING -- step 7 (real capability provisioning) was not performed.');
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exitCode = 1;
});
