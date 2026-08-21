import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import * as crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createProductViewerCapabilityArtifact,
  createViewerCapabilityIssuerArtifact,
  type ProductViewerCapabilityArtifact,
} from "../../packages/mps-lu/src/artifacts/ProductViewerCapabilityArtifact";
import {
  createViewerIdentityArtifact,
  createViewerIdentityIssuerArtifact,
} from "../../packages/mps-lu/src/artifacts/ViewerIdentityArtifact";
import {
  attestProductViewerCapability,
  attestViewerCapabilityIssuerArtifact,
} from "../../server/modules/localization/productViewerCapabilityAuthority";
import {
  attestViewerIdentityArtifact,
  attestViewerIdentityIssuerArtifact,
} from "../../server/modules/localization/viewerIdentityAuthority";
import {
  MimersIntegration,
  resetMimersCasCacheForTests,
} from "../../packages/mps-runtime/src/mimers/MimersIntegration";
import {
  installOwnerIssuedLocalizationViewerCapability,
  verifyInstalledLocalizationViewerCapability,
} from "../../server/modules/localization/installLocalizationViewerCapability";
import { LocalPemSigningKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { __resetViewerCapabilitySigningProviderForTests } from "../../server/security/viewerCapabilitySigningKey";
import { __resetViewerCapabilityVerifierForTests } from "../../server/security/viewerCapabilityVerifier";
import { __resetViewerIdentitySigningProviderForTests } from "../../server/security/viewerIdentitySigningKey";
import { __resetViewerIdentityVerifierForTests } from "../../server/security/viewerIdentityVerifier";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const RELEASE_HASH = "d".repeat(64);
const PROJECT_ID = "project-owner-issued";
const BINDING_REF = { artifact_id: "project-context-binding-owner-issued", artifact_type: "project_context_binding" };
const RELEASE_REF = { artifact_id: "product-release-owner-issued", artifact_type: "product_release" };
const OWNER_AUTHORITY_REF = { artifact_id: "owner-authority-manual-install-v1", artifact_type: "owner_authority_attestation" };

let root: string;
const keys = crypto.generateKeyPairSync("ed25519");
const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const KEY_ID = "ed25519:viewer-capability-issuer-test";
const signing = new LocalPemSigningKeyProvider(KEY_ID, privateKeyPem, publicKeyPem);

const identityKeys = crypto.generateKeyPairSync("ed25519");
const identityPrivateKeyPem = identityKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const identityPublicKeyPem = identityKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const IDENTITY_KEY_ID = "ed25519:viewer-identity-issuer-test";
const identitySigning = new LocalPemSigningKeyProvider(IDENTITY_KEY_ID, identityPrivateKeyPem, identityPublicKeyPem);

const unsignedIdentityIssuer = createViewerIdentityIssuerArtifact({ issuer_key_id: IDENTITY_KEY_ID, owner_authority_ref: OWNER_AUTHORITY_REF });
const unsignedIdentity = createViewerIdentityArtifact({
  runtime_component: "canonical LU ViewerKernel / localization viewer runtime",
  product_release_ref: RELEASE_REF,
  product_release_hash: RELEASE_HASH,
  issuer_ref: { artifact_id: unsignedIdentityIssuer.artifact_id, artifact_type: unsignedIdentityIssuer.artifact_type },
  issuer_key_id: IDENTITY_KEY_ID,
});
const VIEWER_IDENTITY_REF = { artifact_id: unsignedIdentity.artifact_id, artifact_type: unsignedIdentity.artifact_type };

function casEnv(): NodeJS.ProcessEnv {
  return {
    MIMERS_ROOT: root,
    MIMERS_REQUIRED: "1",
    MIMERS_DURABILITY_MODE: "none",
    NODE_ENV: "development",
    VIEWER_CAPABILITY_ISSUER_KEY_ID: KEY_ID,
    VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM: publicKeyPem,
    VIEWER_IDENTITY_ISSUER_KEY_ID: IDENTITY_KEY_ID,
    VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM: identityPublicKeyPem,
  } as NodeJS.ProcessEnv;
}

async function buildIssuer() {
  const unsigned = createViewerCapabilityIssuerArtifact({ issuer_key_id: KEY_ID, owner_authority_ref: OWNER_AUTHORITY_REF });
  const attestation = await attestViewerCapabilityIssuerArtifact({ issuer: unsigned, signing });
  return { ...unsigned, attestation };
}

async function buildIdentityIssuer() {
  const attestation = await attestViewerIdentityIssuerArtifact({ issuer: unsignedIdentityIssuer, signing: identitySigning });
  return { ...unsignedIdentityIssuer, attestation };
}

async function buildIdentity() {
  const identityIssuer = await buildIdentityIssuer();
  const attestation = await attestViewerIdentityArtifact({ identity: unsignedIdentity, issuer: identityIssuer, signing: identitySigning });
  return { identity: { ...unsignedIdentity, attestation }, identityIssuer };
}

async function buildCapability(
  issuer: Awaited<ReturnType<typeof buildIssuer>>,
  overrides: Partial<ProductViewerCapabilityArtifact["payload"]> = {},
): Promise<ProductViewerCapabilityArtifact> {
  const unsigned = createProductViewerCapabilityArtifact({
    issuer_key_id: KEY_ID,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    subject_project_id: PROJECT_ID,
    project_context_binding_ref: BINDING_REF,
    viewer_identity_ref: VIEWER_IDENTITY_REF,
    product_release_ref: RELEASE_REF,
    product_release_hash: RELEASE_HASH,
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: "2027-01-01T00:00:00.000Z",
    ...overrides,
  } as any);
  const attestation = await attestProductViewerCapability({ capability: unsigned, issuer, signing });
  return { ...unsigned, attestation };
}

beforeEach(() => {
  resetMimersCasCacheForTests();
  __resetViewerCapabilitySigningProviderForTests(null);
  __resetViewerCapabilityVerifierForTests(null);
  __resetViewerIdentitySigningProviderForTests(null);
  __resetViewerIdentityVerifierForTests(null);
  process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = KEY_ID;
  process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = publicKeyPem;
  process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = IDENTITY_KEY_ID;
  process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = identityPublicKeyPem;
  root = mkdtempSync(path.join(tmpdir(), "lu-viewer-install-"));
});

afterEach(() => {
  resetMimersCasCacheForTests();
  __resetViewerCapabilitySigningProviderForTests(null);
  __resetViewerCapabilityVerifierForTests(null);
  __resetViewerIdentitySigningProviderForTests(null);
  __resetViewerIdentityVerifierForTests(null);
  delete process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID;
  delete process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM;
  delete process.env.VIEWER_IDENTITY_ISSUER_KEY_ID;
  delete process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM;
  rmSync(root, { recursive: true, force: true });
});

async function seedReleaseAndIssuer(repository: Awaited<ReturnType<typeof MimersIntegration.create>>["artifactRepository"]) {
  const issuer = await buildIssuer();
  await repository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  await repository.put({
    artifact_id: RELEASE_REF.artifact_id,
    content_hash: { algorithm: "sha256", value: RELEASE_HASH },
    body: { artifact_id: RELEASE_REF.artifact_id, artifact_type: RELEASE_REF.artifact_type, content_hash: { algorithm: "sha256", value: "release-manifest-content-hash" }, references: [], payload: {}, release_hash: { algorithm: "sha256", value: RELEASE_HASH } },
  });
  const { identity, identityIssuer } = await buildIdentity();
  await repository.put({ artifact_id: identityIssuer.artifact_id, content_hash: identityIssuer.content_hash, body: identityIssuer });
  await repository.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });
  return issuer;
}

describe("VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1: install", () => {
  it("fails closed when the configured capability is absent from real CAS", async () => {
    const mimers = await MimersIntegration.create({ env: casEnv(), forceMimers: true });

    await expect(
      verifyInstalledLocalizationViewerCapability({
        artifactRepository: mimers.artifactRepository,
        config: {
          capabilityArtifactId: "viewer-capability-missing",
          expectedProjectId: PROJECT_ID,
          expectedContextBindingId: BINDING_REF.artifact_id,
          expectedViewerIdentityId: VIEWER_IDENTITY_REF.artifact_id,
          expectedReleaseId: RELEASE_REF.artifact_id,
          expectedReleaseHash: RELEASE_HASH,
        },
        now: () => NOW,
      }),
    ).rejects.toThrow("REJECT_LU_VIEWER_CAPABILITY_UNAVAILABLE");
  });

  it("rejects a capability whose release does not resolve to the claimed hash (dev-release-hash style substitution)", async () => {
    const mimers = await MimersIntegration.create({ env: casEnv(), forceMimers: true });
    const issuer = await seedReleaseAndIssuer(mimers.artifactRepository);
    const capability = await buildCapability(issuer, { product_release_hash: "e".repeat(64) });

    await expect(
      installOwnerIssuedLocalizationViewerCapability({
        artifactRepository: mimers.artifactRepository,
        capability,
        now: () => NOW,
      }),
    ).rejects.toThrow(/REJECT_VIEWER_(CAPABILITY|IDENTITY)_RELEASE_HASH/);
  });

  it("rejects an unsigned issuer", async () => {
    const mimers = await MimersIntegration.create({ env: casEnv(), forceMimers: true });
    const issuerUnsigned = createViewerCapabilityIssuerArtifact({ issuer_key_id: KEY_ID, owner_authority_ref: OWNER_AUTHORITY_REF });
    await mimers.artifactRepository.put({ artifact_id: issuerUnsigned.artifact_id, content_hash: issuerUnsigned.content_hash, body: issuerUnsigned });
    await mimers.artifactRepository.put({
      artifact_id: RELEASE_REF.artifact_id,
      content_hash: { algorithm: "sha256", value: RELEASE_HASH },
      body: { artifact_id: RELEASE_REF.artifact_id, artifact_type: RELEASE_REF.artifact_type, content_hash: { algorithm: "sha256", value: "release-manifest-content-hash" }, references: [], payload: {}, release_hash: { algorithm: "sha256", value: RELEASE_HASH } },
    });
    const { identity, identityIssuer } = await buildIdentity();
    await mimers.artifactRepository.put({ artifact_id: identityIssuer.artifact_id, content_hash: identityIssuer.content_hash, body: identityIssuer });
    await mimers.artifactRepository.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });
    const capability = await buildCapability({ ...issuerUnsigned, attestation: undefined } as any);

    await expect(
      installOwnerIssuedLocalizationViewerCapability({ artifactRepository: mimers.artifactRepository, capability, now: () => NOW }),
    ).rejects.toThrow("REJECT_VIEWER_CAPABILITY_ISSUER_UNSIGNED");
  });

  it("rejects an issuer signed by an untrusted key (wrong trust root)", async () => {
    const rogueKeys = crypto.generateKeyPairSync("ed25519");
    const rogueSigning = new LocalPemSigningKeyProvider(
      "ed25519:rogue",
      rogueKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      rogueKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    const mimers = await MimersIntegration.create({ env: casEnv(), forceMimers: true });
    const unsignedIssuer = createViewerCapabilityIssuerArtifact({ issuer_key_id: "ed25519:rogue", owner_authority_ref: OWNER_AUTHORITY_REF });
    const rogueIssuerAttestation = await attestViewerCapabilityIssuerArtifact({ issuer: unsignedIssuer, signing: rogueSigning });
    const rogueIssuer = { ...unsignedIssuer, attestation: rogueIssuerAttestation };
    await mimers.artifactRepository.put({ artifact_id: rogueIssuer.artifact_id, content_hash: rogueIssuer.content_hash, body: rogueIssuer });
    await mimers.artifactRepository.put({
      artifact_id: RELEASE_REF.artifact_id,
      content_hash: { algorithm: "sha256", value: RELEASE_HASH },
      body: { artifact_id: RELEASE_REF.artifact_id, artifact_type: RELEASE_REF.artifact_type, content_hash: { algorithm: "sha256", value: "release-manifest-content-hash" }, references: [], payload: {}, release_hash: { algorithm: "sha256", value: RELEASE_HASH } },
    });
    const { identity, identityIssuer } = await buildIdentity();
    await mimers.artifactRepository.put({ artifact_id: identityIssuer.artifact_id, content_hash: identityIssuer.content_hash, body: identityIssuer });
    await mimers.artifactRepository.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });
    const unsignedCapability = createProductViewerCapabilityArtifact({
      issuer_key_id: "ed25519:rogue",
      issuer_ref: { artifact_id: rogueIssuer.artifact_id, artifact_type: rogueIssuer.artifact_type },
      subject_project_id: PROJECT_ID,
      project_context_binding_ref: BINDING_REF,
      viewer_identity_ref: VIEWER_IDENTITY_REF,
      product_release_ref: RELEASE_REF,
      product_release_hash: RELEASE_HASH,
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2027-01-01T00:00:00.000Z",
    });
    const capabilityAttestation = await attestProductViewerCapability({ capability: unsignedCapability, issuer: rogueIssuer, signing: rogueSigning });
    const capability = { ...unsignedCapability, attestation: capabilityAttestation };

    await expect(
      installOwnerIssuedLocalizationViewerCapability({ artifactRepository: mimers.artifactRepository, capability, now: () => NOW }),
    ).rejects.toThrow("REJECT_VIEWER_CAPABILITY_ISSUER_TRUST_ROOT");
  });

  it("rejects an expired capability", async () => {
    const mimers = await MimersIntegration.create({ env: casEnv(), forceMimers: true });
    const issuer = await seedReleaseAndIssuer(mimers.artifactRepository);
    const capability = await buildCapability(issuer, { valid_from: "2020-01-01T00:00:00.000Z", valid_until: "2021-01-01T00:00:00.000Z" });

    await expect(
      installOwnerIssuedLocalizationViewerCapability({ artifactRepository: mimers.artifactRepository, capability, now: () => NOW }),
    ).rejects.toThrow("REJECT_VIEWER_CAPABILITY_EXPIRED");
  });

  it("rejects a not-yet-valid capability", async () => {
    const mimers = await MimersIntegration.create({ env: casEnv(), forceMimers: true });
    const issuer = await seedReleaseAndIssuer(mimers.artifactRepository);
    const capability = await buildCapability(issuer, { valid_from: "2030-01-01T00:00:00.000Z", valid_until: "2031-01-01T00:00:00.000Z" });

    await expect(
      installOwnerIssuedLocalizationViewerCapability({ artifactRepository: mimers.artifactRepository, capability, now: () => NOW }),
    ).rejects.toThrow("REJECT_VIEWER_CAPABILITY_NOT_YET_VALID");
  });

  it("rejects a tampered capability (payload mutated after signing)", async () => {
    const mimers = await MimersIntegration.create({ env: casEnv(), forceMimers: true });
    const issuer = await seedReleaseAndIssuer(mimers.artifactRepository);
    const capability = await buildCapability(issuer);
    const tampered = { ...capability, payload: { ...capability.payload, subject_project_id: "some-other-project" } };

    await expect(
      installOwnerIssuedLocalizationViewerCapability({ artifactRepository: mimers.artifactRepository, capability: tampered, now: () => NOW }),
    ).rejects.toThrow(/REJECT_PRODUCT_VIEWER_CAPABILITY|REJECT_VIEWER_CAPABILITY_TAMPERED/);
  });

  it("persists an owner-issued V2 capability in Mimers CAS and starts ViewerKernel after reopening", async () => {
    const first = await MimersIntegration.create({ env: casEnv(), forceMimers: true });
    const issuer = await seedReleaseAndIssuer(first.artifactRepository);
    const capability = await buildCapability(issuer);

    const installation = await installOwnerIssuedLocalizationViewerCapability({
      artifactRepository: first.artifactRepository,
      capability,
      now: () => NOW,
    });

    resetMimersCasCacheForTests();
    __resetViewerCapabilityVerifierForTests(null);
    const reopened = await MimersIntegration.create({ env: casEnv(), forceMimers: true });
    const runtime = await verifyInstalledLocalizationViewerCapability({
      artifactRepository: reopened.artifactRepository,
      config: installation.runtimeConfig,
      now: () => NOW,
    });

    expect(installation.artifactId).toBe(capability.artifact_id);
    expect(installation.releaseHash).toBe(RELEASE_HASH);
    expect(runtime.capability.viewer_identity_ref.artifact_id).toBe(VIEWER_IDENTITY_REF.artifact_id);
    expect(runtime.viewer).toBeDefined();
  });
});
