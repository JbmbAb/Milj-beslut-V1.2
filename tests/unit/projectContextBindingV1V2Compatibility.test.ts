import { describe, expect, it } from "vitest";
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import { InMemoryArtifactRepository } from "@miljobeslut/mps-runtime";
import {
  createCanonicalPropertyGeometryArtifact,
  createProductLuProjectContextArtifact,
  createProductLuPropertyContextArtifact,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectPropertyBindingArtifact,
  createPropertyLookupObservationArtifact,
} from "@miljobeslut/mps-lu";
import {
  attestProjectContextBindingArtifact,
  installVerifiedProductLuContext,
} from "../../server/modules/localization/projectContextBindingAuthority";
import type { ProjectContextBindingIndex } from "../../server/repositories/projectContextBindingRepository";

class MemoryBindingIndex implements ProjectContextBindingIndex {
  async register(): Promise<void> {}
  async resolve(): Promise<string> {
    throw new Error("not used by this proof");
  }
}

const keys = LocalPemSigningKeyProvider.generate("ed25519:project-context-binding-compatibility-test");
const verification = new LocalPemVerificationKeyProvider(keys.provider.keyId, keys.publicKey);
const v1Issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: keys.provider.keyId });
const v2Issuer = createProjectContextBindingIssuerArtifact({
  issuer_key_id: keys.provider.keyId,
  issuer_version: "project-context-binding-issuer-v2",
});

async function fixture(propertyIssuer = v1Issuer) {
  const geometry = createCanonicalPropertyGeometryArtifact({
    geometry: { type: "Polygon", coordinates: [[[14, 61], [14.1, 61], [14, 61.1], [14, 61]]] },
  });
  const observation = createPropertyLookupObservationArtifact({
    property_identity: "property:lantmateriet:orsa-stackmora-3-12",
    property_designation: "ORSA STACKMORA 3:12",
    source_key: "orsa-stackmora-3-12",
    source_dataset: "lantmateriet-property-unit",
    source_updated_at: "2026-08-21T00:00:00.000Z",
    municipality: "ORSA",
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
  });
  const property = createProjectPropertyBindingArtifact({
    project_id: "project-a",
    property_identity: observation.payload.property_identity,
    property_designation: observation.payload.property_designation,
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    source_refs: [{ artifact_id: observation.artifact_id, artifact_type: observation.artifact_type }],
    resolver_id: "postgis-property-unit-v1",
    resolver_version: "v1",
    contract_version: "project-property-binding-v1",
  });
  const propertyBinding = {
    ...property,
    attestation: await attestProjectContextBindingArtifact({ artifact: property, issuer: propertyIssuer, signing: keys.provider }),
  };
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: property.payload.property_identity,
    property_ref: property.payload.property_designation,
    official_name: property.payload.property_designation,
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    municipality: "ORSA",
    coordinates: [6760000, 500000],
    project_property_binding_ref: { artifact_id: property.artifact_id, artifact_type: property.artifact_type },
  });
  const projectContext = createProductLuProjectContextArtifact({
    project_id: property.payload.project_id,
    project_name: "LU Golden Path - Millbygard",
    description: "V1/V2 compatibility proof",
    created_by: "owner-user",
    property_context_ref: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type },
    project_property_binding_ref: { artifact_id: property.artifact_id, artifact_type: property.artifact_type },
  });
  const unsignedBinding = createProjectContextBindingArtifact({
    project_id: property.payload.project_id,
    project_context_ref: { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type },
    project_property_binding_ref: { artifact_id: property.artifact_id, artifact_type: property.artifact_type },
    binding_version: "project-context-binding-v2",
    authority_ref: { artifact_id: v2Issuer.artifact_id, artifact_type: v2Issuer.artifact_type },
    created_at: "2026-08-21T00:00:00.000Z",
  });
  return {
    geometry,
    observation,
    propertyBinding,
    propertyContext,
    projectContext,
    contextBinding: {
      ...unsignedBinding,
      attestation: await attestProjectContextBindingArtifact({ artifact: unsignedBinding, issuer: v2Issuer, signing: keys.provider }),
    },
  };
}

async function install(input: Awaited<ReturnType<typeof fixture>>, propertyBindingIssuerRef?: { artifact_id: string; artifact_type: string }) {
  const repository = new InMemoryArtifactRepository();
  await repository.put({ artifact_id: v1Issuer.artifact_id, content_hash: v1Issuer.content_hash, body: v1Issuer });
  await installVerifiedProductLuContext({
    artifactRepository: repository,
    index: new MemoryBindingIndex(),
    issuer: v2Issuer,
    verification,
    geometryArtifact: input.geometry,
    propertyObservation: input.observation,
    propertyBinding: input.propertyBinding,
    propertyBindingIssuerRef,
    propertyContext: input.propertyContext,
    projectContext: input.projectContext,
    contextBinding: input.contextBinding,
  });
}

describe("PROJECT-CONTEXT-BINDING-V1-V2-COMPATIBILITY-01", () => {
  it("accepts a V1 property binding only when its V1 issuer is explicit", async () => {
    const input = await fixture();
    await expect(install(input, { artifact_id: v1Issuer.artifact_id, artifact_type: v1Issuer.artifact_type })).resolves.toBeUndefined();
    await expect(install(input)).rejects.toThrow("REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_SCOPE");
  });

  it("rejects unavailable, wrong-version, and tampered issuer provenance", async () => {
    const input = await fixture();
    await expect(install(input, { artifact_id: "missing-v1-issuer", artifact_type: v1Issuer.artifact_type })).rejects.toThrow();
    await expect(install(input, { artifact_id: v2Issuer.artifact_id, artifact_type: v2Issuer.artifact_type }))
      .rejects.toThrow("REJECT_PROJECT_CONTEXT_BINDING_PROPERTY_BINDING_ISSUER_VERSION");
    await expect(install({ ...input, propertyBinding: { ...input.propertyBinding, attestation: { ...input.propertyBinding.attestation!, signer: "tampered" } } }, {
      artifact_id: v1Issuer.artifact_id,
      artifact_type: v1Issuer.artifact_type,
    })).rejects.toThrow("REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_MISSING");
  });

  it("keeps V2 property bindings on the V2 issuer path without an override", async () => {
    await expect(install(await fixture(v2Issuer))).resolves.toBeUndefined();
  });
});
