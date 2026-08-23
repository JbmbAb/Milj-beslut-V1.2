/**
 * PRODUCT-RELEASE-AUTHORITY-BINDING-V1 -- Unit B live proof.
 *
 * Runs against the real dev DB/CAS, using the real, already-signed
 * product-release-772aceb600c4690777593ea8 as the positive case, and constructing real
 * (unsigned / untrusted-issuer / tampered) candidates for the negative cases -- all through the
 * real `resolveCanonicalProductRelease` entrypoint the canonical runtime now uses.
 *
 * Covers proof-matrix points 1-5 (6-8 are covered by the already-passing module test suites for
 * ExecutionIdentity V3 / ViewerCapability / the usecase, all of which now import
 * resolveCanonicalProductRelease; 9 is the already-proven H2 release-scoped-identity result; 10
 * is a structural .env.local check, not a runtime proof).
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-product-release-authority-binding-01.ts
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createProductReleaseIssuerArtifact,
  createProductReleaseManifestArtifact,
  type ProductReleaseManifestArtifact,
} from '../../packages/mps-governance/src/release/ProductReleaseAuthority';
import { attestProductRelease, verifyProductRelease } from '../../server/modules/release/productReleaseAuthority';
import { resolveCanonicalProductRelease } from '../../server/modules/release/productReleaseRuntime';
import { getProductReleaseIssuerVerifier } from '../../server/security/productReleaseIssuerKey';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const REAL_RELEASE_ID = 'product-release-772aceb600c4690777593ea8';
const REAL_ISSUER_KEY_ID = 'product-release-issuer-v1-3822fa1b7c7a1c05';

async function main() {
  console.log('########## PROVE-PRODUCT-RELEASE-AUTHORITY-BINDING-01 (Unit B) ##########\n');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  const results: Record<string, boolean> = {};
  const trustedPublicKeyPem = readFileSync(`${SECRETS_DIR}/product-release-issuer-v1-public.pem`, 'utf-8');
  process.env.PRODUCT_RELEASE_ISSUER_KEY_ID = REAL_ISSUER_KEY_ID;
  process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM = trustedPublicKeyPem;

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;

  console.log('=== PROOF 1: real already-signed release -> PASS ===\n');
  try {
    process.env.PRODUCT_RELEASE_ARTIFACT_ID = REAL_RELEASE_ID;
    const release = await resolveCanonicalProductRelease({ artifactRepository: repo });
    console.log(`  resolved: ${release.artifact_id}, release_hash: ${release.release_hash.value}\n`);
    results.proof1_realSignedReleasePasses = release.artifact_id === REAL_RELEASE_ID;
  } catch (error) {
    console.log(`  UNEXPECTED FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    results.proof1_realSignedReleasePasses = false;
  }

  console.log('=== PROOF 2: unsigned release, env-selected, matching hash -> DENY ===\n');
  try {
    const trustedIssuerRef = { artifact_id: 'product-release-issuer-f2bb20d702edfe2e242493a3', artifact_type: 'product_release_issuer' } as const;
    const unsigned = createProductReleaseManifestArtifact({
      product_name: 'Miljobeslut-proof-b-unsigned',
      package_lock_sha256: 'a'.repeat(64),
      package_manifest_sha256: 'b'.repeat(64),
      runtime_entrypoint_sha256: 'c'.repeat(64),
      issuer_ref: trustedIssuerRef,
      issued_at: new Date().toISOString(),
    });
    // Deliberately no .attestation -- a syntactically valid, internally-consistent (its own
    // release_hash/content_hash match its own payload) but never-signed candidate.
    await repo.put({ artifact_id: unsigned.artifact_id, content_hash: unsigned.content_hash, body: unsigned });
    process.env.PRODUCT_RELEASE_ARTIFACT_ID = unsigned.artifact_id;
    await resolveCanonicalProductRelease({ artifactRepository: repo });
    console.log('  UNEXPECTED: unsigned release was accepted -- negative proof FAILED\n');
    results.proof2_unsignedDenied = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  DENIED as expected: ${message}\n`);
    results.proof2_unsignedDenied = message.includes('REJECT_PRODUCT_RELEASE');
  }

  console.log('=== PROOF 3: release signed by an unknown/untrusted issuer -> DENY ===\n');
  try {
    const untrustedKey = LocalPemSigningKeyProvider.generate('ed25519:proof-b-untrusted-release-issuer');
    const untrustedIssuer = createProductReleaseIssuerArtifact(untrustedKey.provider.keyId);
    await repo.put({ artifact_id: untrustedIssuer.artifact_id, content_hash: untrustedIssuer.content_hash, body: untrustedIssuer });
    const untrustedUnsigned = createProductReleaseManifestArtifact({
      product_name: 'Miljobeslut-proof-b-untrusted-issuer',
      package_lock_sha256: 'd'.repeat(64),
      package_manifest_sha256: 'e'.repeat(64),
      runtime_entrypoint_sha256: 'f'.repeat(64),
      issuer_ref: { artifact_id: untrustedIssuer.artifact_id, artifact_type: untrustedIssuer.artifact_type },
      issued_at: new Date().toISOString(),
    });
    const untrustedSigned: ProductReleaseManifestArtifact = {
      ...untrustedUnsigned,
      attestation: await attestProductRelease({ release: untrustedUnsigned, issuer: untrustedIssuer, signing: untrustedKey.provider }),
    };
    await repo.put({ artifact_id: untrustedSigned.artifact_id, content_hash: untrustedSigned.content_hash, body: untrustedSigned });
    process.env.PRODUCT_RELEASE_ARTIFACT_ID = untrustedSigned.artifact_id;
    // env's PRODUCT_RELEASE_ISSUER_KEY_ID/PUBLIC_KEY_PEM still point at the REAL trusted issuer --
    // this candidate is validly signed, just not by anyone the runtime trusts.
    await resolveCanonicalProductRelease({ artifactRepository: repo });
    console.log('  UNEXPECTED: untrusted-issuer release was accepted -- negative proof FAILED\n');
    results.proof3_untrustedIssuerDenied = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  DENIED as expected: ${message}\n`);
    results.proof3_untrustedIssuerDenied = message.includes('REJECT_PRODUCT_RELEASE_ISSUER_TRUST');
  }

  console.log('=== PROOF 4: tampered signed release -> DENY ===\n');
  try {
    const realRelease = await repo.resolve<ProductReleaseManifestArtifact>({ artifact_id: REAL_RELEASE_ID, artifact_type: 'product_release_manifest' });
    const tampered: ProductReleaseManifestArtifact = { ...realRelease, release_hash: { algorithm: 'sha256', value: 'f'.repeat(64) } };
    await verifyProductRelease({ release: tampered, artifactRepository: repo, verification: getProductReleaseIssuerVerifier() });
    console.log('  UNEXPECTED: tampered release verified -- negative proof FAILED\n');
    results.proof4_tamperedDenied = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  DENIED as expected: ${message}\n`);
    results.proof4_tamperedDenied = message.includes('REJECT_PRODUCT_RELEASE');
  }

  console.log('=== PROOF 5: missing verifier config -> FAIL CLOSED ===\n');
  try {
    process.env.PRODUCT_RELEASE_ARTIFACT_ID = REAL_RELEASE_ID;
    delete process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM;
    await resolveCanonicalProductRelease({ artifactRepository: repo });
    console.log('  UNEXPECTED: resolved with no verifier config -- negative proof FAILED\n');
    results.proof5_missingConfigFailsClosed = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  DENIED as expected: ${message}\n`);
    results.proof5_missingConfigFailsClosed = message.includes('REJECT_PRODUCT_RELEASE_ISSUER_CONFIGURATION');
  } finally {
    process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM = trustedPublicKeyPem;
  }

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(results, null, 2));
  const ok = Object.values(results).every(Boolean);
  console.log(`\nALL GREEN: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exitCode = 1;
});
