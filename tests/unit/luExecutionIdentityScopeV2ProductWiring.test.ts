import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V2-WIRING-01.
 *
 * A real runtime proof through the ACTUAL product entrypoint (GenerateLocalizationReportUseCase),
 * not LuExecutionKernelClient in isolation. Every non-CAS external boundary is mocked (spatial
 * audit/compliance/NVR/RAA/VISS/SGU/SLU/audit-trail/logger/ticket-queue -- exactly the existing
 * HM1B/HM1C/P4A-LU-05 pattern) so what remains real is: CAS artifact resolution, the full
 * ProjectContextBinding/supersession authority chain, ExecutionIdentity V2 issuance and
 * verification, and ExecutionKernel admission.
 *
 * server/repositories/projectContextBindingRepository's PrismaProjectContextBindingIndex is
 * replaced with an in-memory equivalent (same public shape: register, registerSupersession,
 * resolve, listBindingRefs, listSupersessionRefs, findProjectContextRef) backed by a
 * module-scoped store, so every `new PrismaProjectContextBindingIndex()` instantiated anywhere in
 * the real call graph (resolveCanonicalProjectContext, installVerifiedProductLuContext, the
 * supersession install path) reads/writes the SAME shared "table" -- exactly how the real
 * Postgres-backed index behaves regardless of how many instances exist.
 */
vi.mock('../../server/repositories/projectContextBindingRepository', () => {
  type BindingRow = {
    binding_artifact_id: string;
    project_context_artifact_id: string;
    project_context_artifact_type: string;
  };
  const bindingsByProject = new Map<string, BindingRow[]>();
  const supersessionsByProject = new Map<string, string[]>();

  class FakeProjectContextBindingIndex {
    async register(binding: {
      artifact_id: string;
      payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } };
    }) {
      const rows = bindingsByProject.get(binding.payload.project_id) ?? [];
      if (!rows.some((r) => r.binding_artifact_id === binding.artifact_id)) {
        rows.push({
          binding_artifact_id: binding.artifact_id,
          project_context_artifact_id: binding.payload.project_context_ref.artifact_id,
          project_context_artifact_type: binding.payload.project_context_ref.artifact_type,
        });
        bindingsByProject.set(binding.payload.project_id, rows);
      }
      const resolved = await this.resolve(binding.payload.project_id, binding.payload.project_context_ref);
      if (resolved !== binding.artifact_id) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_CONFLICT');
    }

    async registerSupersession(supersession: { artifact_id: string; payload: { project_id: string } }) {
      const rows = supersessionsByProject.get(supersession.payload.project_id) ?? [];
      if (!rows.includes(supersession.artifact_id)) {
        rows.push(supersession.artifact_id);
        supersessionsByProject.set(supersession.payload.project_id, rows);
      }
    }

    async resolve(projectId: string, projectContextRef: { artifact_id: string; artifact_type: string }) {
      const rows = (bindingsByProject.get(projectId) ?? []).filter(
        (r) =>
          r.project_context_artifact_id === projectContextRef.artifact_id &&
          r.project_context_artifact_type === projectContextRef.artifact_type,
      );
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return rows[0]!.binding_artifact_id;
    }

    async listBindingRefs(projectId: string) {
      return (bindingsByProject.get(projectId) ?? []).map((r) => ({
        artifact_id: r.binding_artifact_id,
        artifact_type: 'project_context_binding',
      }));
    }

    async listSupersessionRefs(projectId: string) {
      return (supersessionsByProject.get(projectId) ?? []).map((id) => ({
        artifact_id: id,
        artifact_type: 'project_context_binding_supersession',
      }));
    }

    async findProjectContextRef(projectId: string) {
      const rows = bindingsByProject.get(projectId) ?? [];
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return {
        artifact_id: rows[0]!.project_context_artifact_id,
        artifact_type: rows[0]!.project_context_artifact_type,
      };
    }
  }

  return { PrismaProjectContextBindingIndex: FakeProjectContextBindingIndex };
});

vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: vi.fn().mockResolvedValue({
    protectedAreaHits: [],
    protectedAreaAvailable: true,
    isProtected: false,
    sgu: { riskLevel: 'LOW', manualReviewRequired: false, summary: 'OK' },
    insar: { riskLevel: 'LOW' },
    distanceToWaterMeters: 50,
    distanceToWaterAvailable: true,
    text: 'OK',
    sources: [],
  }),
}));
vi.mock('../../server/services/complianceRuleEngine', () => ({
  evaluateComplianceRules: vi.fn().mockReturnValue({
    overallRisk: 'LOW',
    permitProbability: 0.8,
    restrictions: [],
    rules: [],
    summary: 'OK',
    violations: [],
    warnings: [],
    feasibilityScore: 80,
    recommendations: [],
    requiredActions: [],
    notes: [],
  }),
}));
vi.mock('../../server/services/nvrService', () => ({ fetchProtectedAreas: vi.fn().mockResolvedValue([]) }));
vi.mock('../../server/services/raaService', () => ({ fetchAncientMonuments: vi.fn().mockResolvedValue([]) }));
vi.mock('../../server/services/vissService', () => ({
  queryVissPoint: vi.fn().mockResolvedValue({ ok: true, primaryWaterStatus: null }),
}));
vi.mock('../../server/services/sguRiskService', () => ({ toGeologicalData: vi.fn().mockReturnValue({}) }));
vi.mock('../../server/services/sluService', () => ({
  searchSluByCoordinates: vi.fn().mockResolvedValue([]),
  getSpeciesInformation: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/application/enqueue-lu-execution-ticket', () => ({
  enqueueAdmittedLuTicket: vi.fn().mockResolvedValue(null),
}));

import {
  LocalPemSigningKeyProvider,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import {
  orchestrator,
  createLuRegistryRuntime,
  deriveLuExecutionSeed,
  createCanonicalPropertyGeometryArtifact,
  createPropertyLookupObservationArtifact,
  createProjectPropertyBindingArtifact,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProductLuPropertyContextArtifact,
  createProductLuProjectContextArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  createLocalizationGeometryArtifactV2,
  quantizeToLocalizationGeometryGrid,
  LU_SITE_ASSESSMENT_CAPABILITY_KEY,
  type ISpatialProvider,
  type ProjectContextBindingSupersessionIssuerArtifact,
} from '@miljobeslut/mps-lu';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';
import type { LocalizationSpatialRuntime } from '../../server/modules/localization/createLocalizationSpatialRuntime';
import { prisma } from '../../server/db/prisma';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import {
  installVerifiedProductLuContext,
  attestProjectContextBindingArtifact,
} from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProjectContextBindingSupersessionArtifact,
  attestProjectContextBindingSupersessionIssuerArtifact,
} from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import { __resetLuExecutionAuthoritySigningProviderForTests } from '../../server/security/luExecutionAuthoritySigningKey';
import { __resetLuExecutionAuthorityVerifierForTests } from '../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { installOwnerIssuedProjectContextBindingSupersession } from '../../server/modules/localization/installProjectContextBinding';
import {
  issueExecutionIdentity,
  issueExecutionIdentityV2,
  issueExecutionIdentityV3,
} from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import { LU_EXECUTION_PRINCIPAL_ID } from '../../packages/mps-lu/src/execution/LuExecutionKernelClient';
import type {
  ExecutionIdentitySubjectV2,
  ExecutionIdentitySubjectV3,
} from '../../packages/mps-runtime/src/execution/ExecutionIdentityScopeV2';
import {
  createProductReleaseIssuerArtifact,
  createProductReleaseManifestArtifact,
  type ProductReleaseManifestArtifact,
} from '../../packages/mps-governance/src/release/ProductReleaseAuthority';
import { attestProductRelease } from '../../server/modules/release/productReleaseAuthority';
import { ensureLocalizationProjectionProject } from '../../packages/mps-lu/tests/fixtures/ensureLocalizationProjectionProject';

const ISSUER_KEY_ID = 'ed25519:pcb-issuer-v2-wiring-test';
const issuerKey = LocalPemSigningKeyProvider.generate(ISSUER_KEY_ID);
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate(
  'ed25519:pcb-supersession-issuer-v2-wiring-test',
);
// PRODUCT-RELEASE-AUTHORITY-BINDING-V1 (H13): two real, distinctly-content-addressed signed
// releases, not bare id/hash literals -- the canonical resolver now requires trusted-issuer
// verification, so "release A" and "release B" must each be a real signed artifact.
const releaseIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:product-release-issuer-v2-wiring-test');
const releaseIssuer = createProductReleaseIssuerArtifact(releaseIssuerKey.provider.keyId);
let RELEASE_A_ID: string;
let RELEASE_A_HASH: string;
let RELEASE_B_ID: string;
let RELEASE_B_HASH: string;
let releaseArtifactsByLabel: Record<'A' | 'B', ProductReleaseManifestArtifact>;

async function buildSignedRelease(label: 'A' | 'B'): Promise<ProductReleaseManifestArtifact> {
  const unsigned = createProductReleaseManifestArtifact({
    product_name: `Miljobeslut-wiring-test-${label}`,
    package_lock_sha256: 'a'.repeat(64),
    package_manifest_sha256: 'b'.repeat(64),
    runtime_entrypoint_sha256: (label === 'A' ? 'c' : 'd').repeat(64),
    issuer_ref: { artifact_id: releaseIssuer.artifact_id, artifact_type: releaseIssuer.artifact_type },
    issued_at: '2026-08-21T00:00:00.000Z',
  });
  return {
    ...unsigned,
    attestation: await attestProductRelease({
      release: unsigned,
      issuer: releaseIssuer,
      signing: releaseIssuerKey.provider,
    }),
  };
}

// PRODUCT-LU-LOCALIZATION-GEOMETRY-01: the inverse of the property's own SWEREF coordinates
// ([6580000, 674000], set on the property in provisionRealProject below) -- used by the usecase's
// resolve-or-derive-current-localization-geometry step. Any consistent WGS84 point works here
// (the real transform isn't under test); DERIVED_WGS84_LAT_LNG is what deriveExpectedGeometryRef
// below must reuse verbatim so a test's precomputed V3 identity matches the artifact_id the real
// usecase actually derives.
const DERIVED_WGS84_LAT_LNG: readonly [number, number] = [59.33, 18.07];

function runtime(repository: InMemoryArtifactRepository): LocalizationSpatialRuntime {
  const provider: ISpatialProvider = { query: vi.fn().mockResolvedValue([]) };
  return {
    artifactRepository: repository,
    resolveSpatialProvider: () => provider,
    wgs84ToSweref99: vi.fn().mockResolvedValue([6580000, 674000]),
    sweref99ToWgs84: vi.fn().mockResolvedValue(DERIVED_WGS84_LAT_LNG),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Mirrors exactly what generate-localization-report.usecase.ts derives when a project has no
 * explicit LocalizationGeometryArtifact yet: the property's own centroid, transformed via the
 * mocked sweref99ToWgs84 above. A test that wants to pre-issue the matching V3 identity must
 * compute the SAME artifact_id, or admission would correctly (and misleadingly, for the test's
 * purpose) DENY on a real, un-derived mismatch.
 */
function deriveExpectedGeometryRef(
  projectId: string,
  propertyContextRef: { artifact_id: string; artifact_type: string },
  swerefNorthingEasting: readonly [number, number] = [6580000, 674000],
): { artifact_id: string; artifact_type: string } {
  const [lat, lng] = DERIVED_WGS84_LAT_LNG;
  // LOCALIZATION-GEOMETRY-CANONICALIZATION-V2: the real derive path now quantizes to the
  // canonical 0.1m grid and constructs a V2 artifact -- replicate that exactly.
  const geometry = createLocalizationGeometryArtifactV2({
    project_id: projectId,
    property_context_ref: propertyContextRef,
    wgs84LngLat: [lng, lat],
    sweref99NorthingEasting: [
      quantizeToLocalizationGeometryGrid(swerefNorthingEasting[0]),
      quantizeToLocalizationGeometryGrid(swerefNorthingEasting[1]),
    ],
    provenance: 'derived_from_property_boundary',
    label: 'Fastighetens centrumpunkt (automatiskt härledd)',
    created_by: 'system',
  });
  return { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type };
}

async function provisionRealProject(args: {
  repo: InMemoryArtifactRepository;
  issuer: ReturnType<typeof createProjectContextBindingIssuerArtifact>;
  signing: SigningKeyProvider;
  projectId: string;
  propertyDesignation: string;
}) {
  await ensureLocalizationProjectionProject({
    projectId: args.projectId,
    propertyDesignation: args.propertyDesignation,
  });

  const geometry = createCanonicalPropertyGeometryArtifact({
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [14, 61],
          [14.1, 61],
          [14, 61.1],
          [14, 61],
        ],
      ],
    },
  });
  const observation = createPropertyLookupObservationArtifact({
    property_identity: `property:test:${args.projectId}`,
    property_designation: args.propertyDesignation,
    source_key: args.projectId,
    source_dataset: 'test-source',
    source_updated_at: '2026-08-21T00:00:00.000Z',
    municipality: 'TESTKOMMUN',
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
  });
  const propertyBindingUnsigned = createProjectPropertyBindingArtifact({
    project_id: args.projectId,
    property_identity: observation.payload.property_identity,
    property_designation: args.propertyDesignation,
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    source_refs: [{ artifact_id: observation.artifact_id, artifact_type: observation.artifact_type }],
    resolver_id: 'test-resolver',
    resolver_version: 'v1',
    contract_version: 'project-property-binding-v1',
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
    municipality: 'TESTKOMMUN',
    coordinates: [6580000, 674000],
    project_property_binding_ref: propertyBindingRef,
  });
  const projectContext = createProductLuProjectContextArtifact({
    project_id: args.projectId,
    project_name: args.propertyDesignation,
    description: 'PRODUCT-LU-EXECUTION-IDENTITY-V2-WIRING-01 real runtime proof',
    created_by: 'test-owner',
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
    binding_version: 'project-context-binding-v2',
    authority_ref: { artifact_id: args.issuer.artifact_id, artifact_type: args.issuer.artifact_type },
    created_at: '2026-08-21T00:00:00.000Z',
  });
  const contextBinding = {
    ...contextBindingUnsigned,
    attestation: await attestProjectContextBindingArtifact({
      artifact: contextBindingUnsigned,
      issuer: args.issuer,
      signing: args.signing,
    }),
  };

  const verification = new (await import('@miljobeslut/mimers-brunn-core')).LocalPemVerificationKeyProvider(
    args.issuer.payload.issuer_key_id,
    issuerKey.publicKey,
  );
  await installVerifiedProductLuContext({
    artifactRepository: args.repo,
    index: new PrismaProjectContextBindingIndex(),
    issuer: args.issuer,
    verification,
    geometryArtifact: geometry,
    propertyObservation: observation,
    propertyBinding,
    propertyContext,
    projectContext,
    contextBinding,
  });

  return {
    contextBindingRef: {
      artifact_id: contextBinding.artifact_id,
      artifact_type: contextBinding.artifact_type,
    },
    projectContextRef: {
      artifact_id: projectContext.artifact_id,
      artifact_type: projectContext.artifact_type,
    },
    propertyContextRef: {
      artifact_id: propertyContext.artifact_id,
      artifact_type: propertyContext.artifact_type,
    },
    propertyIdentity: observation.payload.property_identity,
    verification,
  };
}

async function supersede(args: {
  repo: InMemoryArtifactRepository;
  issuer: ProjectContextBindingSupersessionIssuerArtifact;
  signing: SigningKeyProvider;
  verification: VerificationKeyProvider;
  projectId: string;
  supersededBindingRef: { artifact_id: string; artifact_type: string };
  successorBindingRef: { artifact_id: string; artifact_type: string };
}) {
  const unsigned = createProjectContextBindingSupersessionArtifact({
    contract_version: 'PROJECT_CONTEXT_BINDING_SUPERSESSION_V1',
    project_id: args.projectId,
    superseded_binding_ref: args.supersededBindingRef,
    successor_binding_ref: args.successorBindingRef,
    reason_code: 'TEST_SUPERSESSION',
    issuer_ref: { artifact_id: args.issuer.artifact_id, artifact_type: args.issuer.artifact_type },
    issuer_key_id: args.signing.keyId,
    issued_at: '2026-08-21T01:00:00.000Z',
  });
  const supersession = {
    ...unsigned,
    attestation: await attestProjectContextBindingSupersessionArtifact({
      artifact: unsigned,
      issuer: args.issuer,
      signing: args.signing,
    }),
  };
  await installOwnerIssuedProjectContextBindingSupersession({
    artifactRepository: args.repo,
    index: new PrismaProjectContextBindingIndex(),
    supersession,
    verification: args.verification,
  });
}

async function installAssessmentProjectionFailureFixture(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "_vb1_assessment_projection_failure_projects" (
      "project_id" text PRIMARY KEY
    )
  `;
  await prisma.$executeRaw`
    CREATE OR REPLACE FUNCTION "_vb1_fail_marked_assessment_projection"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM "_vb1_assessment_projection_failure_projects"
        WHERE "project_id" = NEW."project_id"
      ) THEN
        RAISE EXCEPTION 'VB1_TEST_INJECTED_ASSESSMENT_PROJECTION_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $$;
  `;
  await prisma.$executeRaw`
    DROP TRIGGER IF EXISTS "_vb1_fail_marked_assessment_projection_trigger"
    ON "project_assessment_projections"
  `;
  await prisma.$executeRaw`
    CREATE TRIGGER "_vb1_fail_marked_assessment_projection_trigger"
    BEFORE INSERT ON "project_assessment_projections"
    FOR EACH ROW
    EXECUTE FUNCTION "_vb1_fail_marked_assessment_projection"()
  `;
}

async function forceAssessmentProjectionFailure(projectId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "_vb1_assessment_projection_failure_projects" ("project_id")
    VALUES (${projectId})
    ON CONFLICT ("project_id") DO NOTHING
  `;
}

describe('PRODUCT-LU-EXECUTION-IDENTITY-V2-WIRING-01 — real runtime proof through the actual usecase', () => {
  let repo: InMemoryArtifactRepository;
  let issuer: ReturnType<typeof createProjectContextBindingIssuerArtifact>;
  let supersessionIssuer: ProjectContextBindingSupersessionIssuerArtifact;
  let registry: ReturnType<typeof createLuRegistryRuntime>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await installAssessmentProjectionFailureFixture();
    vi.spyOn(orchestrator, 'generateDocumentEvidence').mockResolvedValue([]);
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
    repo = new InMemoryArtifactRepository();
    issuer = createProjectContextBindingIssuerArtifact({
      issuer_key_id: issuerKey.provider.keyId,
      issuer_version: 'project-context-binding-issuer-v2',
    });
    // Only the verifier (public key) is read via env by resolveCanonicalProjectContext /
    // installVerifiedProductLuContext -- signing here always uses issuerKey.provider directly.
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = issuerKey.provider.keyId;
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = issuerKey.publicKey;
    // PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1: a dedicated, differently-keyed issuer --
    // never the ordinary binding issuer above -- is the only one authorized to sign a supersession.
    process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = pcbSupersessionIssuerKey.provider.keyId;
    process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM =
      pcbSupersessionIssuerKey.publicKey;
    __resetProjectContextBindingSupersessionVerifierForTests(null);
    const supersessionIssuerUnsigned = createProjectContextBindingSupersessionIssuerArtifact({
      issuer_key_id: pcbSupersessionIssuerKey.provider.keyId,
      owner_authority_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    });
    supersessionIssuer = {
      ...supersessionIssuerUnsigned,
      attestation: await attestProjectContextBindingSupersessionIssuerArtifact({
        issuer: supersessionIssuerUnsigned,
        signing: pcbSupersessionIssuerKey.provider,
      }),
    };
    await repo.put({
      artifact_id: supersessionIssuer.artifact_id,
      content_hash: supersessionIssuer.content_hash,
      body: supersessionIssuer,
    });
    const luKey = LocalPemSigningKeyProvider.generate('ed25519:lu-execution-authority-v1');
    process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = luKey.provider.keyId;
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = luKey.privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = luKey.publicKey;
    delete process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM;
    process.env.PRODUCT_RELEASE_ISSUER_KEY_ID = releaseIssuerKey.provider.keyId;
    process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM = releaseIssuerKey.publicKey;
    await repo.put({
      artifact_id: releaseIssuer.artifact_id,
      content_hash: releaseIssuer.content_hash,
      body: releaseIssuer,
    });
    const releaseA = await buildSignedRelease('A');
    const releaseB = await buildSignedRelease('B');
    releaseArtifactsByLabel = { A: releaseA, B: releaseB };
    RELEASE_A_ID = releaseA.artifact_id;
    RELEASE_A_HASH = releaseA.release_hash.value;
    RELEASE_B_ID = releaseB.artifact_id;
    RELEASE_B_HASH = releaseB.release_hash.value;
    process.env.PRODUCT_RELEASE_ARTIFACT_ID = RELEASE_A_ID;
    registry = createLuRegistryRuntime();
  });

  afterEach(() => {
    delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID;
    delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM;
    delete process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID;
    delete process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM;
    __resetProjectContextBindingSupersessionVerifierForTests(null);
    delete process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
    delete process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    delete process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM;
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
    delete process.env.PRODUCT_RELEASE_ARTIFACT_ID;
    delete process.env.PRODUCT_RELEASE_ISSUER_KEY_ID;
    delete process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM;
  });

  async function putRelease(id: string, _hash: string) {
    const label: 'A' | 'B' = id === RELEASE_B_ID ? 'B' : 'A';
    const release = releaseArtifactsByLabel[label];
    await repo.put({ artifact_id: release.artifact_id, content_hash: release.content_hash, body: release });
  }

  function subjectFor(
    projectId: string,
    propertyIdentity: string,
    contextBindingRef: { artifact_id: string; artifact_type: string },
    releaseRef: { artifact_id: string; artifact_type: string } = {
      artifact_id: RELEASE_A_ID,
      artifact_type: 'product_release_manifest',
    },
  ): ExecutionIdentitySubjectV2 {
    return {
      site_id: propertyIdentity,
      project_context_binding_ref: contextBindingRef,
      product_release_ref: releaseRef,
      execution_contract_version: 'lu-execution-identity-v1',
    };
  }

  it('CURRENT HEAD + matching V2 identity -> ACCEPT', async () => {
    await putRelease(RELEASE_A_ID, RELEASE_A_HASH);
    const projectId = `project-v2-accept-${Date.now()}`;
    const { contextBindingRef, projectContextRef, propertyContextRef, propertyIdentity } =
      await provisionRealProject({
        repo,
        issuer,
        signing: issuerKey.provider,
        projectId,
        propertyDesignation: 'V2 ACCEPT 1:1',
      });
    await forceAssessmentProjectionFailure(projectId);

    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    const subject = subjectFor(projectId, propertyIdentity, contextBindingRef);
    // PRODUCT-LU-LOCALIZATION-GEOMETRY-01: current product issuance is V3, scoped by the
    // localization point too -- the project has no explicit point yet, so the usecase derives one
    // from the property centroid. deriveExpectedGeometryRef reproduces that exact derivation so
    // the identity minted here matches what the real usecase will look up.
    const geometryRef = deriveExpectedGeometryRef(projectId, propertyContextRef);
    const subjectV3: ExecutionIdentitySubjectV3 = { ...subject, localization_geometry_ref: geometryRef };
    // Mirrors exactly what generate-localization-report.usecase.ts derives internally, from the
    // SAME three distinct refs resolveCanonicalProjectContext returns (project/property/binding
    // are not interchangeable) -- otherwise this test would prove nothing about real wiring.
    const seed = deriveLuExecutionSeed({
      site_id: propertyIdentity,
      project_id: projectId,
      project_context_ref: projectContextRef,
      property_context_ref: propertyContextRef,
      project_context_binding_ref: contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_A_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_A_HASH,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      localization_geometry_ref: geometryRef,
    });
    await issueExecutionIdentityV3({
      subject: subjectV3,
      deterministic_seed: seed,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    const report = await new GenerateLocalizationReportUseCase(async () => runtime(repo)).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    const motor = report.siteAnalyses[0].executionMotor;
    expect(motor?.admitted, JSON.stringify(motor)).toBe(true);

    // H2/VB1: the fixture now creates the real Project row required by localization-geometry
    // projection. A DB-level, project-scoped trigger then makes only the assessment projection
    // fail here -- proving, through the real usecase (not a mocked entrypoint), that a projection
    // failure after CAS persistence (a) does NOT invalidate the already admitted assessment, and
    // (b) is surfaced on the returned report as explicit false rather than a log-only loss.
    expect(motor?.assessment_artifact_id).toBeTruthy();
    expect(motor?.assessment_projection_registered).toBe(false);
  });

  it('same exact product state replayed twice -> deterministic acceptance both times', async () => {
    await putRelease(RELEASE_A_ID, RELEASE_A_HASH);
    const projectId = `project-v2-replay-${Date.now()}`;
    const { contextBindingRef, projectContextRef, propertyContextRef, propertyIdentity } =
      await provisionRealProject({
        repo,
        issuer,
        signing: issuerKey.provider,
        projectId,
        propertyDesignation: 'V2 REPLAY',
      });
    await forceAssessmentProjectionFailure(projectId);
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    const subject = subjectFor(projectId, propertyIdentity, contextBindingRef);
    const geometryRef = deriveExpectedGeometryRef(projectId, propertyContextRef);
    const subjectV3: ExecutionIdentitySubjectV3 = { ...subject, localization_geometry_ref: geometryRef };
    const seed = deriveLuExecutionSeed({
      site_id: propertyIdentity,
      project_id: projectId,
      project_context_ref: projectContextRef,
      property_context_ref: propertyContextRef,
      project_context_binding_ref: contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_A_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_A_HASH,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      localization_geometry_ref: geometryRef,
    });
    await issueExecutionIdentityV3({
      subject: subjectV3,
      deterministic_seed: seed,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    const runOnce = () =>
      new GenerateLocalizationReportUseCase(async () => runtime(repo)).execute({
        projectId,
        siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
      });
    const first = await runOnce();
    const second = await runOnce();
    expect(
      first.siteAnalyses[0].executionMotor?.admitted,
      JSON.stringify(first.siteAnalyses[0].executionMotor),
    ).toBe(true);
    expect(
      second.siteAnalyses[0].executionMotor?.admitted,
      JSON.stringify(second.siteAnalyses[0].executionMotor),
    ).toBe(true);
    expect(second.siteAnalyses[0].executionMotor?.assessment_artifact_id).toBe(
      first.siteAnalyses[0].executionMotor?.assessment_artifact_id,
    );
    expect(first.siteAnalyses[0].executionMotor?.assessment_projection_registered).toBe(false);
    expect(second.siteAnalyses[0].executionMotor?.assessment_projection_registered).toBe(false);
  });

  it('superseded context binding: identity minted under the OLD head -> DENY on current execution', async () => {
    await putRelease(RELEASE_A_ID, RELEASE_A_HASH);
    const projectId = `project-v2-superseded-${Date.now()}`;
    const first = await provisionRealProject({
      repo,
      issuer,
      signing: issuerKey.provider,
      projectId,
      propertyDesignation: 'V2 SUPERSEDED (old head)',
    });

    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    // Identity minted against the binding that is about to be superseded.
    const staleSubject = subjectFor(projectId, first.propertyIdentity, first.contextBindingRef);
    const staleSeed = deriveLuExecutionSeed({
      site_id: first.propertyIdentity,
      project_id: projectId,
      project_context_ref: first.projectContextRef,
      property_context_ref: first.propertyContextRef,
      project_context_binding_ref: first.contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_A_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_A_HASH,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    });
    await issueExecutionIdentityV2({
      subject: staleSubject,
      deterministic_seed: staleSeed,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    // Now provision a corrected chain for the SAME project (same shape as the real ORSA
    // correction: same project_id, a new context binding) and supersede the old one with it. No
    // new identity is minted for the corrected head.
    const second = await provisionRealProject({
      repo,
      issuer,
      signing: issuerKey.provider,
      projectId,
      propertyDesignation: 'V2 SUPERSEDED (new head)',
    });
    await supersede({
      repo,
      issuer: supersessionIssuer,
      signing: pcbSupersessionIssuerKey.provider,
      verification: first.verification,
      projectId,
      supersededBindingRef: first.contextBindingRef,
      successorBindingRef: second.contextBindingRef,
    });

    const report = await new GenerateLocalizationReportUseCase(async () => runtime(repo)).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    // The current head is now `second`'s binding; the only minted identity is scoped to the OLD
    // (now-superseded) binding, so admission must fail closed rather than silently accept it.
    expect(report.siteAnalyses[0].executionMotor?.admitted).toBe(false);
  });

  it('wrong project: identity minted for a different project/context -> DENY', async () => {
    await putRelease(RELEASE_A_ID, RELEASE_A_HASH);
    const projectIdA = `project-v2-wrongproject-a-${Date.now()}`;
    const projectIdB = `project-v2-wrongproject-b-${Date.now()}`;
    await provisionRealProject({
      repo,
      issuer,
      signing: issuerKey.provider,
      projectId: projectIdA,
      propertyDesignation: 'V2 WRONG PROJECT A',
    });
    const provisionedB = await provisionRealProject({
      repo,
      issuer,
      signing: issuerKey.provider,
      projectId: projectIdB,
      propertyDesignation: 'V2 WRONG PROJECT B',
    });

    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    // Mint an identity for project B's real context, then try to use it for project A's run.
    const subjectB = subjectFor(projectIdB, provisionedB.propertyIdentity, provisionedB.contextBindingRef);
    const seedB = deriveLuExecutionSeed({
      site_id: provisionedB.propertyIdentity,
      project_id: projectIdB,
      project_context_ref: provisionedB.projectContextRef,
      property_context_ref: provisionedB.propertyContextRef,
      project_context_binding_ref: provisionedB.contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_A_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_A_HASH,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    });
    await issueExecutionIdentityV2({
      subject: subjectB,
      deterministic_seed: seedB,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    // No identity was ever minted for project A's real site/binding -- running A's report must
    // fail closed, not accidentally resolve B's identity.
    const report = await new GenerateLocalizationReportUseCase(async () => runtime(repo)).execute({
      projectId: projectIdA,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(report.siteAnalyses[0].executionMotor?.admitted).toBe(false);
  });

  it('wrong release: identity minted against a release the caller does not currently expect -> DENY', async () => {
    await putRelease(RELEASE_A_ID, RELEASE_A_HASH);
    await putRelease(RELEASE_B_ID, RELEASE_B_HASH);
    const projectId = `project-v2-wrongrelease-${Date.now()}`;
    const { contextBindingRef, projectContextRef, propertyContextRef, propertyIdentity } =
      await provisionRealProject({
        repo,
        issuer,
        signing: issuerKey.provider,
        projectId,
        propertyDesignation: 'V2 WRONG RELEASE',
      });
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;

    // Identity minted against release B, while the environment's current release (per
    // PRODUCT_RELEASE_ARTIFACT_ID/HASH, set in beforeEach) is release A.
    const subjectWrongRelease = subjectFor(projectId, propertyIdentity, contextBindingRef, {
      artifact_id: RELEASE_B_ID,
      artifact_type: 'product_release_manifest',
    });
    const seedWrongRelease = deriveLuExecutionSeed({
      site_id: propertyIdentity,
      project_id: projectId,
      project_context_ref: projectContextRef,
      property_context_ref: propertyContextRef,
      project_context_binding_ref: contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_B_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_B_HASH,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    });
    await issueExecutionIdentityV2({
      subject: subjectWrongRelease,
      deterministic_seed: seedWrongRelease,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    const report = await new GenerateLocalizationReportUseCase(async () => runtime(repo)).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(report.siteAnalyses[0].executionMotor?.admitted).toBe(false);
  });

  it('V1 identity on a V2-required product path -> DENY', async () => {
    await putRelease(RELEASE_A_ID, RELEASE_A_HASH);
    const projectId = `project-v2-legacy-${Date.now()}`;
    const { propertyIdentity, projectContextRef, propertyContextRef, contextBindingRef } =
      await provisionRealProject({
        repo,
        issuer,
        signing: issuerKey.provider,
        projectId,
        propertyDesignation: 'V2 LEGACY V1 IDENTITY',
      });
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    // A legacy V1 identity minted for the exact same site_id, with a seed that even matches the
    // real canonical tuple -- still must not satisfy a V2-required current execution.
    const seed = deriveLuExecutionSeed({
      site_id: propertyIdentity,
      project_id: projectId,
      project_context_ref: projectContextRef,
      property_context_ref: propertyContextRef,
      project_context_binding_ref: contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_A_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_A_HASH,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    });
    await issueExecutionIdentity({
      site_id: propertyIdentity,
      deterministic_seed: seed,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    const report = await new GenerateLocalizationReportUseCase(async () => runtime(repo)).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(report.siteAnalyses[0].executionMotor?.admitted).toBe(false);
  });

  it('tampered subject_v2: identity content altered after signing -> DENY', async () => {
    await putRelease(RELEASE_A_ID, RELEASE_A_HASH);
    const projectId = `project-v2-tampered-${Date.now()}`;
    const { contextBindingRef, projectContextRef, propertyContextRef, propertyIdentity } =
      await provisionRealProject({
        repo,
        issuer,
        signing: issuerKey.provider,
        projectId,
        propertyDesignation: 'V2 TAMPERED',
      });
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    const subject = subjectFor(projectId, propertyIdentity, contextBindingRef);
    const seed = deriveLuExecutionSeed({
      site_id: propertyIdentity,
      project_id: projectId,
      project_context_ref: projectContextRef,
      property_context_ref: propertyContextRef,
      project_context_binding_ref: contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_A_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_A_HASH,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    });
    const issued = await issueExecutionIdentityV2({
      subject,
      deterministic_seed: seed,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });

    // Rewrite the persisted identity in place with a different subject, WITHOUT a valid
    // re-signature -- exactly what an attacker (or a bug) without the authority's private key
    // would be limited to.
    await repo.put({
      artifact_id: issued.artifact_id,
      content_hash: issued.content_hash,
      body: {
        ...issued,
        subject_v2: {
          ...subject,
          project_context_binding_ref: {
            artifact_id: 'project-context-binding-attacker-chosen',
            artifact_type: 'project_context_binding',
          },
        },
      },
    });

    const report = await new GenerateLocalizationReportUseCase(async () => runtime(repo)).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(report.siteAnalyses[0].executionMotor?.admitted).toBe(false);
  });
});
