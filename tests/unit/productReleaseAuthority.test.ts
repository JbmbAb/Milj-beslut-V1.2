import { describe, expect, it } from "vitest";
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { InMemoryArtifactRepository } from "@miljobeslut/mps-runtime";
import { createProductReleaseIssuerArtifact, createProductReleaseManifestArtifact } from "../../packages/mps-governance/src/release/ProductReleaseAuthority";
import { attestProductRelease, verifyProductRelease } from "../../server/modules/release/productReleaseAuthority";
import { resolveCanonicalProductRelease } from "../../server/modules/release/productReleaseRuntime";

const keys = LocalPemSigningKeyProvider.generate("ed25519:product-release-test");
const verifier = new LocalPemVerificationKeyProvider(keys.provider.keyId, keys.publicKey);
const issuer = createProductReleaseIssuerArtifact(keys.provider.keyId);
function release() {
  return createProductReleaseManifestArtifact({
    product_name: "Miljöbeslut",
    package_lock_sha256: "a".repeat(64),
    package_manifest_sha256: "b".repeat(64),
    runtime_entrypoint_sha256: "c".repeat(64),
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issued_at: "2026-08-21T00:00:00.000Z",
  });
}
async function repository() { const repo = new InMemoryArtifactRepository(); await repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer }); return repo; }

describe("PRODUCT-RELEASE-AUTHORITY-BOOTSTRAP-01", () => {
  it("accepts a signed content-derived product release", async () => {
    const unsigned = release(); const signed = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
    await expect(verifyProductRelease({ release: signed, artifactRepository: await repository(), verification: verifier })).resolves.toBeUndefined();
  });
  it("fails closed for a tampered release", async () => {
    const unsigned = release(); const signed = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
    await expect(verifyProductRelease({ release: { ...signed, release_hash: { algorithm: "sha256", value: "d".repeat(64) } }, artifactRepository: await repository(), verification: verifier })).rejects.toThrow("REJECT_PRODUCT_RELEASE_ATTESTATION");
  });
  it("rejects an unknown issuer", async () => {
    const unsigned = release(); const signed = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
    await expect(verifyProductRelease({ release: signed, artifactRepository: new InMemoryArtifactRepository(), verification: verifier })).rejects.toThrow();
  });
  it("resolves only the configured trusted release", async () => {
    const unsigned = release(); const signed = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
    const repo = await repository(); await repo.put({ artifact_id: signed.artifact_id, content_hash: signed.content_hash, body: signed });
    await expect(resolveCanonicalProductRelease({ artifactRepository: repo, env: { PRODUCT_RELEASE_ARTIFACT_ID: signed.artifact_id, PRODUCT_RELEASE_ISSUER_KEY_ID: keys.provider.keyId, PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM: keys.publicKey } as NodeJS.ProcessEnv })).resolves.toMatchObject({ artifact_id: signed.artifact_id });
  });
  it("does not accept missing configuration or a Frozen Core mock as product authority", async () => {
    await expect(resolveCanonicalProductRelease({ artifactRepository: await repository(), env: {} })).rejects.toThrow("REJECT_PRODUCT_RELEASE_RUNTIME_CONFIGURATION");
    const repo = await repository();
    await repo.put({ artifact_id: "frozen-core-mock", content_hash: { algorithm: "sha256", value: "0".repeat(64) }, body: { artifact_id: "frozen-core-mock", artifact_type: "frozen_core_release_manifest", payload: {} } });
    await expect(resolveCanonicalProductRelease({ artifactRepository: repo, env: { PRODUCT_RELEASE_ARTIFACT_ID: "frozen-core-mock", PRODUCT_RELEASE_ISSUER_KEY_ID: keys.provider.keyId, PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM: keys.publicKey } as NodeJS.ProcessEnv })).rejects.toThrow();
  });
});
