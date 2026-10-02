/**
 * DEMO-ONLY (branch demo/lu-demonstrator-72h, never for main, never governed authority).
 *
 * One-time provisioning of a FRESH local demo CAS (MIMERS_ROOT=D:\mimer-demo\cas) with
 * throwaway local keys from D:\mimer-demo\secrets. Composes, in one process, the same exported
 * functions the operator scripts use:
 *   1. product release issuer + manifest   (= scripts/ops/bootstrap-product-release-authority.ts --execute)
 *   2. LU execution authority root+issuer (= first half of scripts/ops/bootstrap-lu-execution-authority.ts,
 *      which is hardcoded to one historical project and cannot be reused as-is)
 *   3. LU execution authority lifecycle   (= scripts/ops/provision-lu-execution-authority-lifecycle.ts --execute)
 * Writes PRODUCT_RELEASE_ARTIFACT_ID to secrets/extra-env.json and the lifecycle id to
 * secrets/lifecycle-id.txt. Refuses to run unless MIMERS_ROOT is the demo CAS.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { MimersIntegration } from "@miljobeslut/mps-runtime";
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { sha256Bytes } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical.js";
import {
  attestLuExecutionAuthorityLifecycle,
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityLifecycleArtifact,
  createLuExecutionAuthorityRootArtifact,
  verifyLuExecutionAuthorityLifecycle,
} from "@miljobeslut/mps-lu";
import { verifyLuExecutionAuthorityChain, attestLuExecutionAuthorityIssuer, attestLuExecutionAuthorityRoot } from "../../packages/mps-lu/src/execution/LuExecutionAuthorityChain.js";
import { createProductReleaseIssuerArtifact, createProductReleaseManifestArtifact } from "../../packages/mps-governance/src/release/ProductReleaseAuthority.js";
import { getProductReleaseIssuerSigner, getProductReleaseIssuerVerifier } from "../../server/security/productReleaseIssuerKey.js";
import { attestProductRelease, verifyProductRelease } from "../../server/modules/release/productReleaseAuthority.js";

const SEC = "D:/mimer-demo/secrets";
const fp = (pem: string) => createHash("sha256").update(pem).digest("hex");
const rd = async (role: string, f: string) => (await readFile(`${SEC}/${role}/${f}`, "utf8"));

async function main(): Promise<void> {
  const root = process.env.MIMERS_ROOT?.trim() ?? "";
  if (!/mimer-demo[\\/]+cas$/i.test(root)) throw new Error(`DEMO_PROVISION_REJECTED: MIMERS_ROOT must be the demo CAS, got '${root}'`);
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: root, MIMERS_REQUIRED: "1" }, forceMimers: true });
  const repo = mimers.artifactRepository;

  // 1. product release
  process.env.PRODUCT_RELEASE_ISSUER_KEY_ID = (await rd("product-release-issuer", "key-id.txt")).trim();
  process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM = await rd("product-release-issuer", "public.pem");
  process.env.PRODUCT_RELEASE_ISSUER_PRIVATE_KEY_PEM = await rd("product-release-issuer", "private.pem");
  const [lock, manifest, entrypoint] = await Promise.all([readFile("package-lock.json"), readFile("package.json"), readFile("server/index.ts")]);
  const signing = getProductReleaseIssuerSigner(process.env);
  const relIssuer = createProductReleaseIssuerArtifact(signing.keyId);
  const unsigned = createProductReleaseManifestArtifact({ product_name: "Miljöbeslut (LU demo, local, NOT governed)", package_lock_sha256: sha256Bytes(lock), package_manifest_sha256: sha256Bytes(manifest), runtime_entrypoint_sha256: sha256Bytes(entrypoint), issuer_ref: { artifact_id: relIssuer.artifact_id, artifact_type: relIssuer.artifact_type }, issued_at: new Date().toISOString() });
  const release = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer: relIssuer, signing }) };
  await repo.put({ artifact_id: relIssuer.artifact_id, content_hash: relIssuer.content_hash, body: relIssuer });
  delete process.env.PRODUCT_RELEASE_ISSUER_PRIVATE_KEY_PEM;
  await verifyProductRelease({ release, artifactRepository: repo, verification: getProductReleaseIssuerVerifier(process.env) });
  await repo.put({ artifact_id: release.artifact_id, content_hash: release.content_hash, body: release });

  // 2. LU execution authority root + issuer
  const rootKeyId = (await rd("lu-execution-root", "key-id.txt")).trim();
  const rootPublic = await rd("lu-execution-root", "public.pem");
  const rootPrivate = await rd("lu-execution-root", "private.pem");
  const issuerKeyId = (await rd("lu-execution-issuer", "key-id.txt")).trim();
  const issuerPublic = await rd("lu-execution-issuer", "public.pem");
  const rootVerification = new LocalPemVerificationKeyProvider(rootKeyId, rootPublic);
  const issuerVerification = new LocalPemVerificationKeyProvider(issuerKeyId, issuerPublic);
  const rootSigning = new LocalPemSigningKeyProvider(rootKeyId, rootPrivate, rootPublic);
  const bareRoot = createLuExecutionAuthorityRootArtifact({ root_key_id: rootKeyId, public_key_fingerprint: fp(rootPublic) });
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({ issuer_key_id: issuerKeyId, public_key_fingerprint: fp(issuerPublic), root_ref: { artifact_id: bareRoot.artifact_id, artifact_type: bareRoot.artifact_type } });
  const authorityRoot = { ...bareRoot, attestation: await attestLuExecutionAuthorityRoot({ root: bareRoot, signing: rootSigning }) };
  const issuerArt = { ...bareIssuer, attestation: await attestLuExecutionAuthorityIssuer({ issuer: bareIssuer, root: authorityRoot, signing: rootSigning }) };
  await repo.put({ artifact_id: authorityRoot.artifact_id, content_hash: authorityRoot.content_hash, body: authorityRoot });
  await repo.put({ artifact_id: issuerArt.artifact_id, content_hash: issuerArt.content_hash, body: issuerArt });
  const issuer = await verifyLuExecutionAuthorityChain({ issuerRef: { artifact_id: issuerArt.artifact_id, artifact_type: issuerArt.artifact_type }, repository: repo, rootVerification, issuerVerification });

  // 3. lifecycle (valid from 1h ago for 30 days)
  const now = Date.now();
  const bareLifecycle = createLuExecutionAuthorityLifecycleArtifact({ root: authorityRoot as any, issuer, valid_from: new Date(now - 3600_000).toISOString(), valid_until: new Date(now + 30 * 86400_000).toISOString(), revoked_at: null, previous_lifecycle_ref: undefined });
  const lifecycle = { ...bareLifecycle, attestation: await attestLuExecutionAuthorityLifecycle({ lifecycle: bareLifecycle, root: authorityRoot as any, signing: rootSigning }) };
  await verifyLuExecutionAuthorityLifecycle({ lifecycle, root: authorityRoot as any, issuer, root_verification: rootVerification });
  await repo.put({ artifact_id: lifecycle.artifact_id, content_hash: lifecycle.content_hash, body: lifecycle });

  await writeFile(`${SEC}/extra-env.json`, JSON.stringify({ PRODUCT_RELEASE_ARTIFACT_ID: release.artifact_id }, null, 2));
  await writeFile(`${SEC}/lifecycle-id.txt`, lifecycle.artifact_id);
  console.log(JSON.stringify({ release_artifact_id: release.artifact_id, release_hash: release.release_hash.value, lu_root: authorityRoot.artifact_id, lu_issuer: issuerArt.artifact_id, lifecycle: lifecycle.artifact_id, valid_until: lifecycle.payload.valid_until }, null, 2));
}
void main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; });
