import {
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import { type InMemoryArtifactRepository } from "../../mps-runtime/src/index";
import {
  createCanonicalPropertyGeometryArtifact,
  createProductLuProjectContextArtifact,
  createProductLuPropertyContextArtifact,
  createProjectContextBindingArtifact,
  createProjectPropertyBindingArtifact,
  createPropertyLookupObservationArtifact,
  createProjectContextBindingIssuerArtifact,
} from "../../src/index";
import { PrismaProjectContextBindingIndex } from "../../../../server/repositories/projectContextBindingRepository";
import {
  attestProjectContextBindingArtifact,
  installVerifiedProductLuContext,
} from "../../../../server/modules/localization/projectContextBindingAuthority";

export interface CanonicalLuContextFixture {
  readonly contextBindingRef: { artifact_id: string; artifact_type: string };
  readonly projectContextRef: { artifact_id: string; artifact_type: string };
  readonly propertyContextRef: { artifact_id: string; artifact_type: string };
  readonly propertyIdentity: string;
}

/**
 * Installs the same signed, content-addressed context chain that the product entrypoint resolves.
 * Tests still exercise the production authority verifier and current-binding index; they merely
 * use an in-memory repository instead of persistent CAS/Postgres.
 */
export async function provisionCanonicalLuContext(args: {
  readonly repository: InMemoryArtifactRepository;
  readonly issuer: ReturnType<typeof createProjectContextBindingIssuerArtifact>;
  readonly signing: SigningKeyProvider;
  readonly verification: VerificationKeyProvider;
  readonly projectId: string;
  readonly propertyDesignation: string;
}): Promise<CanonicalLuContextFixture> {
  const geometry = createCanonicalPropertyGeometryArtifact({
    geometry: {
      type: "Polygon",
      coordinates: [[[14, 61], [14.1, 61], [14, 61.1], [14, 61]]],
    },
  });
  const observation = createPropertyLookupObservationArtifact({
    property_identity: `property:test:${args.projectId}`,
    property_designation: args.propertyDesignation,
    source_key: args.projectId,
    source_dataset: "test-source",
    source_updated_at: "2026-08-23T00:00:00.000Z",
    municipality: "TESTKOMMUN",
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
  });
  const propertyBindingUnsigned = createProjectPropertyBindingArtifact({
    project_id: args.projectId,
    property_identity: observation.payload.property_identity,
    property_designation: args.propertyDesignation,
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    source_refs: [{ artifact_id: observation.artifact_id, artifact_type: observation.artifact_type }],
    resolver_id: "test-resolver",
    resolver_version: "v1",
    contract_version: "project-property-binding-v1",
  });
  const propertyBinding = {
    ...propertyBindingUnsigned,
    attestation: await attestProjectContextBindingArtifact({
      artifact: propertyBindingUnsigned,
      issuer: args.issuer,
      signing: args.signing,
    }),
  };
  const propertyBindingRef = {
    artifact_id: propertyBinding.artifact_id,
    artifact_type: propertyBinding.artifact_type,
  };
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: observation.payload.property_identity,
    property_ref: args.propertyDesignation,
    official_name: args.propertyDesignation,
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    municipality: "TESTKOMMUN",
    coordinates: [6580000, 674000],
    project_property_binding_ref: propertyBindingRef,
  });
  const projectContext = createProductLuProjectContextArtifact({
    project_id: args.projectId,
    project_name: args.propertyDesignation,
    description: "Canonical product entrypoint test fixture",
    created_by: "test-owner",
    property_context_ref: {
      artifact_id: propertyContext.artifact_id,
      artifact_type: propertyContext.artifact_type,
    },
    project_property_binding_ref: propertyBindingRef,
  });
  const contextBindingUnsigned = createProjectContextBindingArtifact({
    project_id: args.projectId,
    project_context_ref: {
      artifact_id: projectContext.artifact_id,
      artifact_type: projectContext.artifact_type,
    },
    project_property_binding_ref: propertyBindingRef,
    binding_version: "project-context-binding-v2",
    authority_ref: { artifact_id: args.issuer.artifact_id, artifact_type: args.issuer.artifact_type },
    created_at: "2026-08-23T00:00:00.000Z",
  });
  const contextBinding = {
    ...contextBindingUnsigned,
    attestation: await attestProjectContextBindingArtifact({
      artifact: contextBindingUnsigned,
      issuer: args.issuer,
      signing: args.signing,
    }),
  };

  await installVerifiedProductLuContext({
    artifactRepository: args.repository,
    index: new PrismaProjectContextBindingIndex(),
    issuer: args.issuer,
    verification: args.verification,
    geometryArtifact: geometry,
    propertyObservation: observation,
    propertyBinding,
    propertyContext,
    projectContext,
    contextBinding,
  });

  return {
    contextBindingRef: { artifact_id: contextBinding.artifact_id, artifact_type: contextBinding.artifact_type },
    projectContextRef: { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type },
    propertyContextRef: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type },
    propertyIdentity: observation.payload.property_identity,
  };
}
