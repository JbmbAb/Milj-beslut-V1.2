import { describe, expect, it } from "vitest";
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import { InMemoryArtifactRepository } from "@miljobeslut/mps-runtime";
import { PRODUCT_RELEASE_CONTRACT_VERSION_V1, createProductReleaseIssuerArtifact, createProductReleaseManifestArtifact, type ProductReleaseManifestArtifactV1 } from "../../packages/mps-governance/src/release/ProductReleaseAuthority";
import { attestProductRelease, verifyProductRelease } from "../../server/modules/release/productReleaseAuthority";
import { resolveCanonicalProductRelease } from "../../server/modules/release/productReleaseRuntime";

const keys = LocalPemSigningKeyProvider.generate("ed25519:product-release-test");
const verifier = new LocalPemVerificationKeyProvider(keys.provider.keyId, keys.publicKey);
const issuer = createProductReleaseIssuerArtifact(keys.provider.keyId);
function release(issuedAt = "2026-08-21T00:00:00.000Z") {
  return createProductReleaseManifestArtifact({
    product_name: "Miljöbeslut",
    package_lock_sha256: "a".repeat(64),
    package_manifest_sha256: "b".repeat(64),
    runtime_entrypoint_sha256: "c".repeat(64),
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issued_at: issuedAt,
  });
}
async function repository() { const repo = new InMemoryArtifactRepository(); await repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer }); return repo; }

describe("PRODUCT-RELEASE-IDENTITY-CONSISTENCY-V1", () => {
  it("accepts a signed content-derived V2 product release", async () => {
    const unsigned = release(); const signed = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
    await expect(verifyProductRelease({ release: signed, artifactRepository: await repository(), verification: verifier })).resolves.toBeUndefined();
  });
  it("fails closed for a tampered V2 release", async () => {
    const unsigned = release(); const signed = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
    await expect(verifyProductRelease({ release: { ...signed, release_hash: { algorithm: "sha256", value: "d".repeat(64) } }, artifactRepository: await repository(), verification: verifier })).rejects.toThrow("REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD");
  });
  it("makes reissuance with different operational issued_at byte-identical", () => {
    const first = release("2026-08-21T00:00:00.000Z");
    const reissued = release("2026-08-22T00:00:00.000Z");
    expect(reissued.artifact_id).toBe(first.artifact_id);
    expect(reissued.content_hash).toEqual(first.content_hash);
    expect("issued_at" in first.payload).toBe(false);
  });
  it("binds issuer authority into V2 release identity", () => {
    const first = release();
    const underAnotherIssuer = createProductReleaseManifestArtifact({ product_name: "Miljöbeslut", package_lock_sha256: "a".repeat(64), package_manifest_sha256: "b".repeat(64), runtime_entrypoint_sha256: "c".repeat(64), issuer_ref: { artifact_id: "product-release-issuer-other", artifact_type: "product_release_issuer" } });
    expect(underAnotherIssuer.artifact_id).not.toBe(first.artifact_id);
    expect(underAnotherIssuer.release_hash).not.toEqual(first.release_hash);
  });
  it("fails closed when a V2 canonical payload is tampered", async () => {
    const unsigned = release(); const signed = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
    const tampered = { ...signed, payload: { ...signed.payload, issuer_ref: { artifact_id: "product-release-issuer-other", artifact_type: "product_release_issuer" } } };
    await expect(verifyProductRelease({ release: tampered, artifactRepository: await repository(), verification: verifier })).rejects.toThrow("REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD");
  });
  it("continues to verify a historical V1 release under frozen V1 semantics", async () => {
    const payload = { contract_version: PRODUCT_RELEASE_CONTRACT_VERSION_V1, product_name: "Miljöbeslut", build_identity: { package_lock_sha256: "a".repeat(64), package_manifest_sha256: "b".repeat(64), runtime_entrypoint_sha256: "c".repeat(64) }, issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type }, issued_at: "2026-08-21T00:00:00.000Z" } as const;
    const releaseHash = sha256ContentHash({ contract_version: payload.contract_version, product_name: payload.product_name, build_identity: payload.build_identity });
    const unsignedBody = { artifact_id: `product-release-${releaseHash.value.slice(0, 24)}`, artifact_type: "product_release_manifest" as const, references: [payload.issuer_ref], payload, release_hash: releaseHash };
    const historical: ProductReleaseManifestArtifactV1 = { ...unsignedBody, content_hash: sha256ContentHash(unsignedBody) };
    const signed = { ...historical, attestation: await attestProductRelease({ release: historical, issuer, signing: keys.provider }) };
    await expect(verifyProductRelease({ release: signed, artifactRepository: await repository(), verification: verifier })).resolves.toBeUndefined();
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
