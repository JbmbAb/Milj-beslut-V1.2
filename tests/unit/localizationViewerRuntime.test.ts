import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { __resetViewerIdentitySigningProviderForTests } from "../../server/security/viewerIdentitySigningKey";
import { __resetViewerIdentityVerifierForTests } from "../../server/security/viewerIdentityVerifier";
import type { SpatialEvidenceArtifact } from "../../packages/mps-lu/src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../../packages/mps-lu/src/artifacts/SpatialEngineFingerprint";
import { InMemoryArtifactRepository } from "../../packages/mps-runtime/src/repository/InMemoryArtifactRepository";
import {
  createLocalizationViewerRuntime,
  LocalizationViewerCapabilityProvider,
  type LocalizationViewerRuntimeConfig,
} from "../../server/modules/localization/createLocalizationViewerRuntime";
import type { ProjectContextBindingProvider } from "../../server/modules/localization/projectContextBindingRuntime";
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { __resetViewerCapabilitySigningProviderForTests } from "../../server/security/viewerCapabilitySigningKey";
import { __resetViewerCapabilityVerifierForTests } from "../../server/security/viewerCapabilityVerifier";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const RELEASE_HASH = "a".repeat(64);
const PROJECT_ID = "project-production-issued";
const BINDING_REF = { artifact_id: "project-context-binding-production-issued", artifact_type: "project_context_binding" };
const RELEASE_REF = { artifact_id: "product-release-production-issued", artifact_type: "product_release" };
const OWNER_AUTHORITY_REF = { artifact_id: "owner-authority-manual-install-v1", artifact_type: "owner_authority_attestation" };

const keys = crypto.generateKeyPairSync("ed25519");
const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const KEY_ID = "ed25519:viewer-capability-issuer-runtime-test";
const signing = new LocalPemSigningKeyProvider(KEY_ID, privateKeyPem, publicKeyPem);

const identityKeys = crypto.generateKeyPairSync("ed25519");
const identityPrivateKeyPem = identityKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const identityPublicKeyPem = identityKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const IDENTITY_KEY_ID = "ed25519:viewer-identity-issuer-runtime-test";
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

/**
 * VIEWER-CAPABILITY-CURRENT-BINDING-WIRING-01: this test file never provisions a real
 * ProjectContextBinding/supersession graph -- a stub standing in for "BINDING_REF is currently
 * the canonical head" keeps these tests exercising what they were written to prove without
 * requiring a live Postgres-backed binding graph.
 */
function currentBindingProviderStub(bindingRef: { artifact_id: string; artifact_type: string }): ProjectContextBindingProvider {
  return {
    resolveCurrent: async () => ({ artifact_id: bindingRef.artifact_id, artifact_type: bindingRef.artifact_type }) as never,
    resolve: async () => ({ artifact_id: bindingRef.artifact_id, artifact_type: bindingRef.artifact_type }) as never,
  } as unknown as ProjectContextBindingProvider;
}

const config: LocalizationViewerRuntimeConfig = {
  capabilityArtifactId: "viewer-capability-production-issued-placeholder",
  expectedProjectId: PROJECT_ID,
  expectedContextBindingId: BINDING_REF.artifact_id,
  expectedViewerIdentityId: VIEWER_IDENTITY_REF.artifact_id,
  expectedReleaseId: RELEASE_REF.artifact_id,
  expectedReleaseHash: RELEASE_HASH,
};

async function buildIssuer() {
  const unsigned = createViewerCapabilityIssuerArtifact({ issuer_key_id: KEY_ID, owner_authority_ref: OWNER_AUTHORITY_REF });
  const attestation = await attestViewerCapabilityIssuerArtifact({ issuer: unsigned, signing });
  return { ...unsigned, attestation };
}

async function buildIdentity() {
  const identityIssuerAttestation = await attestViewerIdentityIssuerArtifact({ issuer: unsignedIdentityIssuer, signing: identitySigning });
  const identityIssuer = { ...unsignedIdentityIssuer, attestation: identityIssuerAttestation };
  const identityAttestation = await attestViewerIdentityArtifact({ identity: unsignedIdentity, issuer: identityIssuer, signing: identitySigning });
  return { identity: { ...unsignedIdentity, attestation: identityAttestation }, identityIssuer };
}

async function buildCapability(issuer: Awaited<ReturnType<typeof buildIssuer>>): Promise<ProductViewerCapabilityArtifact> {
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
  });
  const attestation = await attestProductViewerCapability({ capability: unsigned, issuer, signing });
  return { ...unsigned, attestation };
}

async function seed(repository: InMemoryArtifactRepository) {
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
  const capability = await buildCapability(issuer);
  await repository.put({ artifact_id: capability.artifact_id, content_hash: capability.content_hash, body: capability });
  return capability;
}

function existenceEvidence(): SpatialEvidenceArtifact {
  return {
    artifact_id: "spatial-evidence-viewer-runtime",
    artifact_type: "SPATIAL_EVIDENCE",
    content_hash: { algorithm: "sha256", value: "spatial-evidence-viewer-runtime-hash" },
    references: [{ artifact_id: "property-viewer-runtime", artifact_type: "PROPERTY" }],
    payload: {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: {
          subject_ref: { artifact_id: "property-viewer-runtime", artifact_type: "PROPERTY" },
          srid: 3006,
          distance_meters: 250,
        },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: "property-viewer-runtime", artifact_type: "PROPERTY" },
      geometry: null,
      srid: 3006,
      operation: {
        algorithm: "spatial.dwithin_existence",
        engine: "PostGIS",
        engine_fingerprint: SPATIAL_STACK_V1,
      },
      layer_ref: { layer_id: "water", version_hash: "b".repeat(64), layer_version: "v1" },
      source_metadata: {
        provider: "SGU",
        dataset: "water",
        dataset_version: "b".repeat(64),
        retrieved_at: "2026-08-20T12:00:00.000Z",
      },
      query_context: { query_id: "viewer-runtime-query", query_type: "SPATIAL_DWITHIN", parameters: {} },
    },
  } as SpatialEvidenceArtifact;
}

beforeEach(() => {
  __resetViewerCapabilitySigningProviderForTests(null);
  __resetViewerCapabilityVerifierForTests(new LocalPemVerificationKeyProvider(KEY_ID, publicKeyPem));
  __resetViewerIdentitySigningProviderForTests(null);
  __resetViewerIdentityVerifierForTests(new LocalPemVerificationKeyProvider(IDENTITY_KEY_ID, identityPublicKeyPem));
});

afterEach(() => {
  __resetViewerCapabilitySigningProviderForTests(null);
  __resetViewerCapabilityVerifierForTests(null);
  __resetViewerIdentitySigningProviderForTests(null);
  __resetViewerIdentityVerifierForTests(null);
});

describe("VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1: runtime", () => {
  it("fails closed when no owner-issued capability is installed", async () => {
    const provider = new LocalizationViewerCapabilityProvider(new InMemoryArtifactRepository(), config, () => NOW, currentBindingProviderStub(BINDING_REF));

    await expect(provider.resolve()).rejects.toThrow("REJECT_LU_VIEWER_CAPABILITY_UNAVAILABLE");
  });

  it("rejects an installed capability bound to a different project (wrong project)", async () => {
    const repository = new InMemoryArtifactRepository();
    const capability = await seed(repository);
    const provider = new LocalizationViewerCapabilityProvider(
      repository,
      { ...config, capabilityArtifactId: capability.artifact_id, expectedProjectId: "some-other-project" },
      () => NOW,
      currentBindingProviderStub(BINDING_REF),
    );

    await expect(provider.resolve()).rejects.toThrow("REJECT_VIEWER_CAPABILITY_PROJECT");
  });

  it("rejects an installed capability bound to a different context binding", async () => {
    const repository = new InMemoryArtifactRepository();
    const capability = await seed(repository);
    const provider = new LocalizationViewerCapabilityProvider(
      repository,
      { ...config, capabilityArtifactId: capability.artifact_id, expectedContextBindingId: "some-other-binding" },
      () => NOW,
      currentBindingProviderStub(BINDING_REF),
    );

    await expect(provider.resolve()).rejects.toThrow("REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING");
  });

  it("resolves an installed, owner-issued V2 capability and verifies its full trust chain", async () => {
    const repository = new InMemoryArtifactRepository();
    const capability = await seed(repository);

    await expect(
      new LocalizationViewerCapabilityProvider(repository, { ...config, capabilityArtifactId: capability.artifact_id }, () => NOW, currentBindingProviderStub(BINDING_REF)).resolve(),
    ).resolves.toMatchObject({
      artifact_id: capability.artifact_id,
      release_hash: { value: RELEASE_HASH },
      viewer_identity_ref: { artifact_id: VIEWER_IDENTITY_REF.artifact_id },
    });
  });

  it("gives ViewerKernel the verified V2 capability's exact viewer identity and project/context binding -- neither masquerading as the other", async () => {
    const repository = new InMemoryArtifactRepository();
    const capability = await seed(repository);
    const evidence = existenceEvidence();
    await repository.put({ artifact_id: evidence.artifact_id, content_hash: evidence.content_hash, body: evidence });

    const runtime = await createLocalizationViewerRuntime({
      artifactRepository: repository,
      config: { ...config, capabilityArtifactId: capability.artifact_id },
      now: () => NOW,
      currentBindingProvider: currentBindingProviderStub(BINDING_REF),
    });
    const exported = await runtime.viewer.exportAsGeoJSON([evidence.artifact_id]);

    expect(runtime.capability.viewer_identity_ref.artifact_id).toBe(VIEWER_IDENTITY_REF.artifact_id);
    expect(capability.payload.project_context_binding_ref.artifact_id).toBe(BINDING_REF.artifact_id);
    expect(runtime.capability.viewer_identity_ref.artifact_id).not.toBe(BINDING_REF.artifact_id);
    expect(exported.features[0]).toMatchObject({
      geometry: null,
      properties: {
        viewer_capability_id: capability.artifact_id,
        viewer_release_hash: RELEASE_HASH,
        viewer_identity_ref: VIEWER_IDENTITY_REF.artifact_id,
      },
    });

    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.resolve(here, "../../server/modules/localization/createLocalizationViewerRuntime.ts"),
      "utf8",
    );
    expect(source).not.toContain("admitViewerCapability");
    expect(source).not.toContain("buildAdmittedViewerCapability");
    expect(source).not.toContain("tests/fixtures");
  });
});
