import path from "node:path";
import { fileURLToPath } from "node:url";
import { MimersIntegration } from "@miljobeslut/mps-runtime";
import { createProductReleaseIssuerArtifact, createProductReleaseManifestArtifactV3, type ProductReleaseManifestArtifact } from "../../packages/mps-governance/src/release/ProductReleaseAuthority.js";
import { getProductReleaseIssuerSigner, getProductReleaseIssuerVerifier } from "../../server/security/productReleaseIssuerKey.js";
import { attestProductRelease, verifyProductRelease } from "../../server/modules/release/productReleaseAuthority.js";
import { RELEASE_IDENTITY_FILE_NAME, assertProductReleaseBuildIdentity, readReleaseIdentityFile } from "../../server/modules/release/productReleaseBuildIdentity.js";

/**
 * Product release ceremony (issue / verify).
 *
 * W-U42: a release is issued as `product-release-v3` from the MEASURED identity the build wrote
 * (`<root>/release-identity.json`, scripts/release/write-build-identity.mjs) -- never from files read out of the
 * current working directory (U40-A2 finding R8). Before signing, the ceremony re-measures the delivered tree under the
 * root and requires measurement, identity file and the unsigned manifest to agree (the same check every process runs
 * at start), so it can only issue a release for the exact tree it stands in. The root defaults to the repository this
 * script lives in; `--root <dir>` points it at another delivered tree (e.g. the image's /app).
 */
const PRIVATE = "PRODUCT_RELEASE_ISSUER_PRIVATE_KEY_PEM";
const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function option(name: string) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function required(value: string | undefined, name: string) { const result = value?.trim(); if (!result) throw new Error(`PRODUCT_RELEASE_BOOTSTRAP_REJECTED: ${name} is required`); return result; }
async function verify(): Promise<void> {
  if (process.env[PRIVATE]) throw new Error("PRODUCT_RELEASE_BOOTSTRAP_REJECTED: private key available during verification");
  const root = required(process.env.MIMERS_ROOT, "MIMERS_ROOT");
  const releaseId = required(option("release-id"), "--release-id");
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: root, MIMERS_REQUIRED: "1" }, forceMimers: true });
  const release = await mimers.artifactRepository.resolve<ProductReleaseManifestArtifact>({ artifact_id: releaseId, artifact_type: "product_release_manifest" });
  await verifyProductRelease({ release, artifactRepository: mimers.artifactRepository, verification: getProductReleaseIssuerVerifier(process.env) });
  console.log(JSON.stringify({ verified: true, private_key_available: false, release_artifact_id: release.artifact_id, release_hash: release.release_hash.value, contract_version: release.payload.contract_version }));
}
async function issue(): Promise<void> {
  if (!process.argv.includes("--execute")) throw new Error("PRODUCT_RELEASE_BOOTSTRAP_REJECTED: refusing to write without --execute");
  const casRoot = required(process.env.MIMERS_ROOT, "MIMERS_ROOT");
  const deliveredRoot = path.resolve(option("root") ?? SCRIPT_REPO_ROOT);
  const identity = readReleaseIdentityFile(deliveredRoot);
  if (!identity) throw new Error(`PRODUCT_RELEASE_BOOTSTRAP_REJECTED: ${RELEASE_IDENTITY_FILE_NAME} is missing under ${deliveredRoot}; the build (or node scripts/release/write-build-identity.mjs on a clean checkout) writes it first`);
  const signing = getProductReleaseIssuerSigner(process.env);
  const issuer = createProductReleaseIssuerArtifact(signing.keyId);
  const unsigned = createProductReleaseManifestArtifactV3({ product_name: "Miljöbeslut", build_identity: identity.build_identity, issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type } });
  // the ceremony stands in the tree it issues for: measurement, identity file and manifest must be one build
  const { measured } = assertProductReleaseBuildIdentity({ root: deliveredRoot, release: unsigned, identity });
  const release = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing }) };
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: casRoot, MIMERS_REQUIRED: "1" }, forceMimers: true });
  await mimers.artifactRepository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  await verifyProductRelease({ release, artifactRepository: mimers.artifactRepository, verification: getProductReleaseIssuerVerifier(process.env) });
  await mimers.artifactRepository.put({ artifact_id: release.artifact_id, content_hash: release.content_hash, body: release });
  console.log(JSON.stringify({ issued: true, contract_version: release.payload.contract_version, release_artifact_id: release.artifact_id, release_hash: release.release_hash.value, issuer_artifact_id: issuer.artifact_id, issuer_key_id: signing.keyId, delivered_root: deliveredRoot, source_commit_sha: identity.build_identity.source_commit_sha, source_digest_sha256: measured.source_digest_sha256, measured_file_count: measured.file_count }));
}
void (process.argv.includes("--verify") ? verify() : issue()).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
