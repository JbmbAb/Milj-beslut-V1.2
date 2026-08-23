import { readFile } from "node:fs/promises";
import { MimersIntegration } from "@miljobeslut/mps-runtime";
import { sha256Bytes } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical.js";
import { createProductReleaseIssuerArtifact, createProductReleaseManifestArtifact, type ProductReleaseManifestArtifact } from "../../packages/mps-governance/src/release/ProductReleaseAuthority.js";
import { getProductReleaseIssuerSigner, getProductReleaseIssuerVerifier } from "../../server/security/productReleaseIssuerKey.js";
import { attestProductRelease, verifyProductRelease } from "../../server/modules/release/productReleaseAuthority.js";

const PRIVATE = "PRODUCT_RELEASE_ISSUER_PRIVATE_KEY_PEM";
function option(name: string) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function required(value: string | undefined, name: string) { const result = value?.trim(); if (!result) throw new Error(`PRODUCT_RELEASE_BOOTSTRAP_REJECTED: ${name} is required`); return result; }
async function verify(): Promise<void> {
  if (process.env[PRIVATE]) throw new Error("PRODUCT_RELEASE_BOOTSTRAP_REJECTED: private key available during verification");
  const root = required(process.env.MIMERS_ROOT, "MIMERS_ROOT");
  const releaseId = required(option("release-id"), "--release-id");
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: root, MIMERS_REQUIRED: "1" }, forceMimers: true });
  const release = await mimers.artifactRepository.resolve<ProductReleaseManifestArtifact>({ artifact_id: releaseId, artifact_type: "product_release_manifest" });
  await verifyProductRelease({ release, artifactRepository: mimers.artifactRepository, verification: getProductReleaseIssuerVerifier(process.env) });
  console.log(JSON.stringify({ verified: true, private_key_available: false, release_artifact_id: release.artifact_id, release_hash: release.release_hash.value }));
}
async function issue(): Promise<void> {
  if (!process.argv.includes("--execute")) throw new Error("PRODUCT_RELEASE_BOOTSTRAP_REJECTED: refusing to write without --execute");
  const root = required(process.env.MIMERS_ROOT, "MIMERS_ROOT");
  const [lock, manifest, entrypoint] = await Promise.all([readFile("package-lock.json"), readFile("package.json"), readFile("server/index.ts")]);
  const signing = getProductReleaseIssuerSigner(process.env);
  const issuer = createProductReleaseIssuerArtifact(signing.keyId);
  const unsigned = createProductReleaseManifestArtifact({ product_name: "Miljöbeslut", package_lock_sha256: sha256Bytes(lock), package_manifest_sha256: sha256Bytes(manifest), runtime_entrypoint_sha256: sha256Bytes(entrypoint), issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type }, issued_at: new Date().toISOString() });
  const release = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing }) };
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: root, MIMERS_REQUIRED: "1" }, forceMimers: true });
  await mimers.artifactRepository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  await verifyProductRelease({ release, artifactRepository: mimers.artifactRepository, verification: getProductReleaseIssuerVerifier(process.env) });
  await mimers.artifactRepository.put({ artifact_id: release.artifact_id, content_hash: release.content_hash, body: release });
  console.log(JSON.stringify({ issued: true, release_artifact_id: release.artifact_id, release_hash: release.release_hash.value, issuer_artifact_id: issuer.artifact_id, issuer_key_id: signing.keyId }));
}
void (process.argv.includes("--verify") ? verify() : issue()).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
