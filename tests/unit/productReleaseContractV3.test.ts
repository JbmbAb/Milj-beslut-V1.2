// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { sha256ContentHash } from '@miljobeslut/mps-compliance/src/canonical/sha256Canonical';
import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import {
  PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS,
  PRODUCT_RELEASE_CONTRACT_VERSION,
  PRODUCT_RELEASE_CONTRACT_VERSION_V1,
  PRODUCT_RELEASE_CONTRACT_VERSION_V2,
  PRODUCT_RELEASE_CONTRACT_VERSION_V3,
  createProductReleaseIssuerArtifact,
  createProductReleaseManifestArtifact,
  createProductReleaseManifestArtifactV3,
  isProductReleaseManifestArtifactV3,
  validateProductReleaseManifestArtifactV2,
  validateProductReleaseManifestArtifactV3,
  type ProductReleaseBuildIdentityV3,
  type ProductReleaseManifestArtifact,
  type ProductReleaseManifestArtifactV1,
} from '../../packages/mps-governance/src/release/ProductReleaseAuthority';
import { attestProductRelease, verifyProductRelease } from '../../server/modules/release/productReleaseAuthority';
import { resolveCanonicalProductRelease } from '../../server/modules/release/productReleaseRuntime';

/**
 * W-U42 (U42a, point 1) -- the release contract `product-release-v3`, forward-only.
 *
 * Owner decision 2026-10-02 (OWNER-DECISIONS-OPEN row 4; answered: "Release contract v3 + /api/release + minimal
 * /health YES, narrow scope: exact runtime/app/release identity"): a release is identified per candidate by its
 * commit, source tree, measured source digest, composition hash and build flags, not only by the three file hashes
 * of V1/V2. V1 and V2 stay historical and verifiable (U40-U50B-SPEC §1.6); new producers emit V3.
 *
 * Hermetic: in-memory repository, generated keys, no CAS, no database, no network.
 */

const keys = LocalPemSigningKeyProvider.generate('ed25519:product-release-v3-test');
const verifier = new LocalPemVerificationKeyProvider(keys.provider.keyId, keys.publicKey);
const issuer = createProductReleaseIssuerArtifact(keys.provider.keyId);
const issuerRef = { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type } as const;

const hex40 = (c: string) => c.repeat(40);
const hex64 = (c: string) => c.repeat(64);

function identity(overrides: Partial<ProductReleaseBuildIdentityV3> = {}): ProductReleaseBuildIdentityV3 {
  return {
    package_lock_sha256: hex64('1'),
    package_manifest_sha256: hex64('2'),
    runtime_entrypoint_sha256: hex64('3'),
    source_commit_sha: hex40('4'),
    source_tree_sha: hex40('5'),
    source_digest_sha256: hex64('6'),
    composition_manifest_sha256: hex64('7'),
    build_args_sha256: hex64('8'),
    ...overrides,
  };
}

function releaseV3(overrides: Partial<ProductReleaseBuildIdentityV3> = {}, productName = 'Miljöbeslut') {
  return createProductReleaseManifestArtifactV3({ product_name: productName, build_identity: identity(overrides), issuer_ref: issuerRef });
}

/** The historical V2 producer, kept for V2 fixtures (it must keep emitting V2, never silently V3). */
function releaseV2() {
  return createProductReleaseManifestArtifact({
    product_name: 'Miljöbeslut',
    package_lock_sha256: hex64('1'),
    package_manifest_sha256: hex64('2'),
    runtime_entrypoint_sha256: hex64('3'),
    issuer_ref: issuerRef,
  });
}

function releaseV1(): ProductReleaseManifestArtifactV1 {
  const payload = {
    contract_version: PRODUCT_RELEASE_CONTRACT_VERSION_V1,
    product_name: 'Miljöbeslut',
    build_identity: { package_lock_sha256: hex64('1'), package_manifest_sha256: hex64('2'), runtime_entrypoint_sha256: hex64('3') },
    issuer_ref: issuerRef,
    issued_at: '2026-08-21T00:00:00.000Z',
  } as const;
  const releaseHash = sha256ContentHash({ contract_version: payload.contract_version, product_name: payload.product_name, build_identity: payload.build_identity });
  const unsigned = {
    artifact_id: `product-release-${releaseHash.value.slice(0, 24)}`,
    artifact_type: 'product_release_manifest' as const,
    references: [payload.issuer_ref],
    payload,
    release_hash: releaseHash,
  };
  return { ...unsigned, content_hash: sha256ContentHash(unsigned) };
}

async function signed<T extends ProductReleaseManifestArtifact>(release: T): Promise<T> {
  return { ...release, attestation: await attestProductRelease({ release, issuer, signing: keys.provider }) };
}

async function repository() {
  const repo = new InMemoryArtifactRepository();
  await repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  return repo;
}

const V3_FIELDS = [
  'package_lock_sha256',
  'package_manifest_sha256',
  'runtime_entrypoint_sha256',
  'source_commit_sha',
  'source_tree_sha',
  'source_digest_sha256',
  'composition_manifest_sha256',
  'build_args_sha256',
] as const;

describe('product-release-v3: contract form', () => {
  it('the current contract version is v3; v1 and v2 keep their historical names', () => {
    expect(PRODUCT_RELEASE_CONTRACT_VERSION_V3).toBe('product-release-v3');
    expect(PRODUCT_RELEASE_CONTRACT_VERSION).toBe(PRODUCT_RELEASE_CONTRACT_VERSION_V3);
    expect(PRODUCT_RELEASE_CONTRACT_VERSION_V1).toBe('product-release-v1');
    expect(PRODUCT_RELEASE_CONTRACT_VERSION_V2).toBe('product-release-v2');
  });

  it('build_identity has exactly the three V1/V2 hashes plus the five v3 fields, in a named, pinned list', () => {
    expect([...PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS].sort()).toEqual([...V3_FIELDS].sort());
    const release = releaseV3();
    expect(release.payload.contract_version).toBe('product-release-v3');
    expect(Object.keys(release.payload.build_identity).sort()).toEqual([...V3_FIELDS].sort());
    expect(release.payload.issuer_ref).toEqual(issuerRef);
    expect('issued_at' in release.payload, 'issuance time is operational metadata, never release identity').toBe(false);
    expect(release.artifact_id).toMatch(/^product-release-[0-9a-f]{24}$/);
    expect(release.artifact_id).toBe(`product-release-${release.release_hash.value.slice(0, 24)}`);
    expect(release.references).toEqual([issuerRef]);
    expect(isProductReleaseManifestArtifactV3(release)).toBe(true);
    expect(isProductReleaseManifestArtifactV3(releaseV2())).toBe(false);
  });

  it('the release hash domain is {contract_version, product_name, build_identity, issuer_ref} -- nothing less, nothing more', () => {
    const release = releaseV3();
    const expected = sha256ContentHash({
      contract_version: 'product-release-v3',
      product_name: 'Miljöbeslut',
      build_identity: identity(),
      issuer_ref: issuerRef,
    });
    expect(release.release_hash).toEqual(expected);
  });

  it.each(V3_FIELDS)('a different %s gives a different release hash AND a different artifact id', (field) => {
    const base = releaseV3();
    const altered = releaseV3({ [field]: /sha$/.test(field) ? hex40('f') : hex64('f') });
    expect(altered.release_hash.value).not.toBe(base.release_hash.value);
    expect(altered.artifact_id).not.toBe(base.artifact_id);
    expect(altered.content_hash.value).not.toBe(base.content_hash.value);
  });

  it('a different product name or issuer gives a different identity too', () => {
    const base = releaseV3();
    expect(releaseV3({}, 'Miljöbeslut NEGATIVE CANDIDATE').artifact_id).not.toBe(base.artifact_id);
    const otherIssuer = createProductReleaseManifestArtifactV3({
      product_name: 'Miljöbeslut',
      build_identity: identity(),
      issuer_ref: { artifact_id: 'product-release-issuer-other', artifact_type: 'product_release_issuer' },
    });
    expect(otherIssuer.artifact_id).not.toBe(base.artifact_id);
  });

  it('the same inputs give byte-identical releases (deterministic, re-issuable)', () => {
    expect(releaseV3()).toEqual(releaseV3());
  });

  it.each(V3_FIELDS)('the producer refuses a missing or malformed %s (fail-closed at creation)', (field) => {
    const bad = (value: string) =>
      createProductReleaseManifestArtifactV3({ product_name: 'Miljöbeslut', build_identity: identity({ [field]: value }), issuer_ref: issuerRef });
    expect(() => bad('')).toThrow(/REJECT_PRODUCT_RELEASE/);
    expect(() => bad('   ')).toThrow(/REJECT_PRODUCT_RELEASE/);
    const wrongLength = /sha$/.test(field) ? hex40('a').slice(1) : hex64('a').slice(1);
    expect(() => bad(wrongLength), `${field}: wrong length`).toThrow(/REJECT_PRODUCT_RELEASE/);
    const notHex = /sha$/.test(field) ? `g${hex40('a').slice(1)}` : `g${hex64('a').slice(1)}`;
    expect(() => bad(notHex), `${field}: not hex`).toThrow(/REJECT_PRODUCT_RELEASE/);
    const upper = /sha$/.test(field) ? hex40('A') : hex64('A');
    expect(() => bad(upper), `${field}: upper-case hex is not the canonical form`).toThrow(/REJECT_PRODUCT_RELEASE/);
  });
});

describe('product-release-v3: self-consistency validation', () => {
  it('accepts a fresh v3 release', () => {
    expect(() => validateProductReleaseManifestArtifactV3(releaseV3())).not.toThrow();
  });

  it('rejects a v2 release as not-v3 (REJECT_PRODUCT_RELEASE_CONTRACT_VERSION), and v2 validation still rejects v3', () => {
    expect(() => validateProductReleaseManifestArtifactV3(releaseV2())).toThrow('REJECT_PRODUCT_RELEASE_CONTRACT_VERSION');
    expect(() => validateProductReleaseManifestArtifactV2(releaseV3())).toThrow('REJECT_PRODUCT_RELEASE_CONTRACT_VERSION');
    expect(() => validateProductReleaseManifestArtifactV2(releaseV2())).not.toThrow();
  });

  it('rejects a tampered release hash, artifact id or content hash (REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD)', () => {
    const release = releaseV3();
    expect(() => validateProductReleaseManifestArtifactV3({ ...release, release_hash: { algorithm: 'sha256', value: hex64('d') } })).toThrow(
      'REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD',
    );
    expect(() => validateProductReleaseManifestArtifactV3({ ...release, artifact_id: `product-release-${hex64('d').slice(0, 24)}` })).toThrow(
      'REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD',
    );
    expect(() => validateProductReleaseManifestArtifactV3({ ...release, content_hash: { algorithm: 'sha256', value: hex64('d') } })).toThrow(
      'REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD',
    );
  });

  it.each(V3_FIELDS)('rejects a release whose %s was changed after issuance', (field) => {
    const release = releaseV3();
    const tampered = {
      ...release,
      payload: { ...release.payload, build_identity: { ...release.payload.build_identity, [field]: /sha$/.test(field) ? hex40('e') : hex64('e') } },
    };
    expect(() => validateProductReleaseManifestArtifactV3(tampered)).toThrow('REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD');
  });

  it('rejects a v3-labelled release whose build_identity lacks a v3 field, even if its hashes are self-consistent', () => {
    const release = releaseV3();
    const { source_digest_sha256: _dropped, ...partial } = release.payload.build_identity;
    const payload = { ...release.payload, build_identity: partial };
    const releaseHash = sha256ContentHash({ contract_version: payload.contract_version, product_name: payload.product_name, build_identity: payload.build_identity, issuer_ref: payload.issuer_ref });
    const unsigned = { artifact_id: `product-release-${releaseHash.value.slice(0, 24)}`, artifact_type: 'product_release_manifest' as const, references: [issuerRef], payload, release_hash: releaseHash };
    const consistentButIncomplete = { ...unsigned, content_hash: sha256ContentHash(unsigned) } as unknown as ProductReleaseManifestArtifact;
    expect(() => validateProductReleaseManifestArtifactV3(consistentButIncomplete)).toThrow(/REJECT_PRODUCT_RELEASE/);
  });
});

describe('product-release-v3: attestation and verification, forward-only', () => {
  it('a signed v3 release verifies; its predicate names the v3 contract', async () => {
    const release = await signed(releaseV3());
    expect(release.attestation?.predicateType).toBe('product-release-authority-v3');
    expect((release.attestation?.predicate as Record<string, unknown>).release_contract_version).toBe('product-release-v3');
    await expect(verifyProductRelease({ release, artifactRepository: await repository(), verification: verifier })).resolves.toBeUndefined();
  });

  it('a tampered signed v3 release fails closed', async () => {
    const release = await signed(releaseV3());
    const tampered = { ...release, payload: { ...release.payload, build_identity: { ...release.payload.build_identity, source_commit_sha: hex40('e') } } };
    await expect(verifyProductRelease({ release: tampered, artifactRepository: await repository(), verification: verifier })).rejects.toThrow('REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD');
    const unsigned = { ...release, attestation: undefined };
    await expect(verifyProductRelease({ release: unsigned, artifactRepository: await repository(), verification: verifier })).rejects.toThrow('REJECT_PRODUCT_RELEASE_ATTESTATION');
  });

  it('historical v1 and v2 releases still verify under their frozen semantics', async () => {
    await expect(verifyProductRelease({ release: await signed(releaseV1()), artifactRepository: await repository(), verification: verifier })).resolves.toBeUndefined();
    await expect(verifyProductRelease({ release: await signed(releaseV2()), artifactRepository: await repository(), verification: verifier })).resolves.toBeUndefined();
  });

  it('the historical producer keeps emitting v2 (forward-only means new producers move, old artifacts do not)', () => {
    expect(releaseV2().payload.contract_version).toBe('product-release-v2');
  });

  it('a v3 release signed by the trusted issuer resolves as the canonical product release', async () => {
    const release = await signed(releaseV3());
    const repo = await repository();
    await repo.put({ artifact_id: release.artifact_id, content_hash: release.content_hash, body: release });
    await expect(
      resolveCanonicalProductRelease({
        artifactRepository: repo,
        env: { PRODUCT_RELEASE_ARTIFACT_ID: release.artifact_id, PRODUCT_RELEASE_ISSUER_KEY_ID: keys.provider.keyId, PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM: keys.publicKey } as NodeJS.ProcessEnv,
      }),
    ).resolves.toMatchObject({ artifact_id: release.artifact_id, payload: { contract_version: 'product-release-v3' } });
  });
});
