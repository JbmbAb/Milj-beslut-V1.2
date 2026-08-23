/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 — Phase B proof matrix, part 2: end-to-end product proofs
 * through the ACTUAL entrypoint (GenerateLocalizationReportUseCase), not any layer in isolation.
 *
 * PROOF-ONLY. No new runtime design in this file. Mirrors the established real-runtime-proof
 * pattern from tests/unit/luExecutionIdentityScopeV2ProductWiring.test.ts: every non-CAS external
 * boundary is mocked (spatial audit/compliance/NVR/RAA/VISS/SGU/SLU/audit-trail/logger/ticket
 * queue), and the ProjectContextBinding repository is replaced with an in-memory fake with the
 * SAME public contract as the real Postgres-backed one -- so what remains real is: CAS artifact
 * resolution, the full ProjectContextBinding authority chain, LocalizationGeometryArtifact
 * creation/validation, the current-geometry and current-assessment projections, ExecutionIdentity
 * V3 issuance/verification, and ExecutionKernel admission.
 *
 * The localization-geometry and assessment projection repositories are ALSO replaced with
 * in-memory fakes (same technique) rather than a real Postgres Project row, because provisioning
 * a real Project/Organisation FK chain is out of scope for what this unit needs to prove: the
 * fakes implement the exact same register/listForProject contract the real Prisma-backed indexes
 * do (including ON CONFLICT DO NOTHING idempotency), so "current" resolution is proven against the
 * real selection algorithm in localizationGeometryProjection.ts / assessmentProjection.ts, not a
 * stand-in for it.
 *
 * Covers proof-matrix items: 2 (full), 3, 10, 11 (product-level), and the legacy-compatibility
 * proof. Artifact/identity/provider-boundary proofs (1, 4-9, 12, negative V3) live in
 * localizationGeometryContractProofs.test.ts.
 */
vi.mock('../../server/repositories/projectContextBindingRepository', () => {
  type BindingRow = { binding_artifact_id: string; project_context_artifact_id: string; project_context_artifact_type: string };
  const bindingsByProject = new Map<string, BindingRow[]>();
  const supersessionsByProject = new Map<string, string[]>();

  class FakeProjectContextBindingIndex {
    async register(binding: { artifact_id: string; payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } } }) {
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
        (r) => r.project_context_artifact_id === projectContextRef.artifact_id && r.project_context_artifact_type === projectContextRef.artifact_type,
      );
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return rows[0]!.binding_artifact_id;
    }

    async listBindingRefs(projectId: string) {
      return (bindingsByProject.get(projectId) ?? []).map((r) => ({ artifact_id: r.binding_artifact_id, artifact_type: 'project_context_binding' }));
    }

    async listSupersessionRefs(projectId: string) {
      return (supersessionsByProject.get(projectId) ?? []).map((id) => ({ artifact_id: id, artifact_type: 'project_context_binding_supersession' }));
    }

    async findProjectContextRef(projectId: string) {
      const rows = bindingsByProject.get(projectId) ?? [];
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return { artifact_id: rows[0]!.project_context_artifact_id, artifact_type: rows[0]!.project_context_artifact_type };
    }
  }

  return { PrismaProjectContextBindingIndex: FakeProjectContextBindingIndex };
});

vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => {
  type Row = {
    projectId: string;
    geometryArtifactId: string;
    propertyContextRefId: string;
    propertyContextRefType: string;
    createdAt: Date;
  };
  const rows: Row[] = [];

  class FakeLocalizationGeometryProjectionIndex {
    async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: { artifact_id: string; artifact_type: string } }) {
      if (rows.some((r) => r.projectId === row.projectId && r.geometryArtifactId === row.geometryArtifactId)) return;
      rows.push({
        projectId: row.projectId,
        geometryArtifactId: row.geometryArtifactId,
        propertyContextRefId: row.propertyContextRef.artifact_id,
        propertyContextRefType: row.propertyContextRef.artifact_type,
        createdAt: new Date(Date.now() + rows.length),
      });
    }
    async listForProject(projectId: string) {
      return rows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  }

  return { PrismaLocalizationGeometryProjectionIndex: FakeLocalizationGeometryProjectionIndex };
});

vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => {
  type Row = {
    projectId: string;
    assessmentArtifactId: string;
    assessmentArtifactType: string;
    projectContextRefId: string;
    projectContextRefType: string;
    bindingArtifactId: string;
    releaseArtifactId: string;
    localizationGeometryArtifactId: string | null;
    createdAt: Date;
  };
  const rows: Row[] = [];

  class FakeProjectAssessmentProjectionIndex {
    async register(row: {
      projectId: string;
      assessmentArtifactId: string;
      assessmentArtifactType: string;
      projectContextRef: { artifact_id: string; artifact_type: string };
      bindingArtifactId: string;
      releaseArtifactId: string;
      localizationGeometryArtifactId?: string | null;
    }) {
      if (rows.some((r) => r.projectId === row.projectId && r.assessmentArtifactId === row.assessmentArtifactId)) return;
      rows.push({
        projectId: row.projectId,
        assessmentArtifactId: row.assessmentArtifactId,
        assessmentArtifactType: row.assessmentArtifactType,
        projectContextRefId: row.projectContextRef.artifact_id,
        projectContextRefType: row.projectContextRef.artifact_type,
        bindingArtifactId: row.bindingArtifactId,
        releaseArtifactId: row.releaseArtifactId,
        localizationGeometryArtifactId: row.localizationGeometryArtifactId ?? null,
        createdAt: new Date(Date.now() + rows.length),
      });
    }
    async listForProject(projectId: string) {
      return rows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  }

  return { PrismaProjectAssessmentProjectionIndex: FakeProjectAssessmentProjectionIndex };
});

vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => {
  type Row = { projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date };
  const rows: Row[] = [];
  class FakeLocalizationGeometrySupersessionIndex {
    async register(row: { projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string }) {
      if (rows.some((r) => r.projectId === row.projectId && r.supersessionArtifactId === row.supersessionArtifactId)) return;
      rows.push({ ...row, createdAt: new Date(Date.now() + rows.length) });
    }
    async listForProject(projectId: string) {
      return rows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  }
  return { PrismaLocalizationGeometrySupersessionIndex: FakeLocalizationGeometrySupersessionIndex };
});

vi.mock('../../server/services/spatialAuditService', () => ({ runSpatialAudit: vi.fn().mockResolvedValue({ protectedAreaHits: [], protectedAreaAvailable: true, isProtected: false, sgu: { riskLevel: 'LOW', manualReviewRequired: false, summary: 'OK' }, insar: { riskLevel: 'LOW' }, distanceToWaterMeters: 50, distanceToWaterAvailable: true, text: 'OK', sources: [] }) }));
vi.mock('../../server/services/complianceRuleEngine', () => ({ evaluateComplianceRules: vi.fn().mockReturnValue({ overallRisk: 'LOW', permitProbability: 0.8, restrictions: [], rules: [], summary: 'OK', violations: [], warnings: [], feasibilityScore: 80, recommendations: [], requiredActions: [], notes: [] }) }));
vi.mock('../../server/services/nvrService', () => ({ fetchProtectedAreas: vi.fn().mockResolvedValue([]) }));
vi.mock('../../server/services/raaService', () => ({ fetchAncientMonuments: vi.fn().mockResolvedValue([]) }));
vi.mock('../../server/services/vissService', () => ({ queryVissPoint: vi.fn().mockResolvedValue({ ok: true, primaryWaterStatus: null }) }));
vi.mock('../../server/services/sguRiskService', () => ({ toGeologicalData: vi.fn().mockReturnValue({}) }));
vi.mock('../../server/services/sluService', () => ({ searchSluByCoordinates: vi.fn().mockResolvedValue([]), getSpeciesInformation: vi.fn().mockResolvedValue([]) }));
vi.mock('../../server/services/auditTrailService', () => ({ auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/application/enqueue-lu-execution-ticket', () => ({ enqueueAdmittedLuTicket: vi.fn().mockResolvedValue(null) }));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalPemSigningKeyProvider, type SigningKeyProvider, type VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
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
  createLocalizationGeometryArtifact,
  createLocalizationGeometryArtifactV2,
  quantizeToLocalizationGeometryGrid,
  createLocalizationGeometrySupersessionIssuerArtifact,
  createLocalizationGeometrySupersessionArtifact,
  LU_SITE_ASSESSMENT_CAPABILITY_KEY,
  type ISpatialProvider,
  type SpatialQueryRequest,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import {
  attestLocalizationGeometrySupersessionIssuerArtifact,
  attestLocalizationGeometrySupersessionArtifact,
} from '../../server/modules/localization/localizationGeometrySupersessionAuthority';
import { PrismaLocalizationGeometrySupersessionIndex } from '../../server/repositories/localizationGeometrySupersessionRepository';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';
import type { LocalizationSpatialRuntime } from '../../server/modules/localization/createLocalizationSpatialRuntime';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import {
  installVerifiedProductLuContext,
  attestProjectContextBindingArtifact,
} from '../../server/modules/localization/projectContextBindingAuthority';
import { issueExecutionIdentityV3 } from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import { LU_EXECUTION_PRINCIPAL_ID } from '../../packages/mps-lu/src/execution/LuExecutionKernelClient';
import type { ExecutionIdentitySubjectV3 } from '../../packages/mps-runtime/src/execution/ExecutionIdentityScopeV2';
import { registerLocalizationGeometry, resolveCurrentLocalizationGeometry } from '../../server/modules/localization/localizationGeometryProjection';
import { resolveCurrentAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { getProjectContextBindingIssuerVerifier } from '../../server/security/projectContextBindingIssuerKey';

const ISSUER_KEY_ID = 'ed25519:pcb-issuer-product-proofs';
const issuerKey = LocalPemSigningKeyProvider.generate(ISSUER_KEY_ID);
const RELEASE_ID = 'product-release-geometry-proofs';
const RELEASE_HASH = 'c'.repeat(64);

// Property centroid used by provisionRealProject below -- deliberately DIFFERENT from both
// explicit points (A, B) used in these proofs, so proof 11 ("uses the exact point, not the
// centroid") is a real, discriminating assertion rather than a coincidence.
const PROPERTY_CENTROID_SWEREF: readonly [number, number] = [6580000, 674000];
const PROPERTY_CENTROID_WGS84: readonly [number, number] = [59.30, 18.00]; // [lat, lng] -- distinct from A/B

const geometrySupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-issuer-product-proofs');

/** Mints, attests, CAS-persists, and registers a real signed geometry supersession edge -- the
 * exact real-world sequence the worker performs, invoked directly here since these proofs test
 * the projection/resolution layer, not the async provisioning queue itself. */
async function supersedeGeometry(args: {
  readonly repo: InMemoryArtifactRepository;
  readonly projectId: string;
  readonly predecessor: LocalizationGeometryArtifact;
  readonly successor: LocalizationGeometryArtifact;
}): Promise<void> {
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: geometrySupersessionIssuerKey.provider.keyId,
    owner_authority_ref: { artifact_id: 'owner-authority-test', artifact_type: 'owner_authority_attestation' },
  });
  const issuer = { ...bareIssuer, attestation: await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing: geometrySupersessionIssuerKey.provider }) };
  await args.repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });

  const bareArtifact = createLocalizationGeometrySupersessionArtifact({
    project_id: args.projectId,
    predecessor_geometry_ref: { artifact_id: args.predecessor.artifact_id, artifact_type: args.predecessor.artifact_type },
    successor_geometry_ref: { artifact_id: args.successor.artifact_id, artifact_type: args.successor.artifact_type },
    reason_code: 'USER_LOCALIZATION_CHANGE_V1',
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: geometrySupersessionIssuerKey.provider.keyId,
    issued_at: '2026-08-23T00:00:00.000Z',
  });
  const artifact = { ...bareArtifact, attestation: await attestLocalizationGeometrySupersessionArtifact({ artifact: bareArtifact, issuer, signing: geometrySupersessionIssuerKey.provider }) };
  await args.repo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });

  await new PrismaLocalizationGeometrySupersessionIndex().register({
    projectId: args.projectId,
    supersessionArtifactId: artifact.artifact_id,
    predecessorGeometryArtifactId: args.predecessor.artifact_id,
    successorGeometryArtifactId: args.successor.artifact_id,
  });

  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = geometrySupersessionIssuerKey.provider.keyId;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = geometrySupersessionIssuerKey.publicKey;
}

function makeRuntime(
  repository: InMemoryArtifactRepository,
  queryRecorder: SpatialQueryRequest[],
): LocalizationSpatialRuntime {
  const provider: ISpatialProvider = {
    query: vi.fn(async (request: SpatialQueryRequest) => {
      queryRecorder.push(request);
      return [];
    }),
  };
  return {
    artifactRepository: repository,
    resolveSpatialProvider: () => provider,
    wgs84ToSweref99: vi.fn().mockResolvedValue(PROPERTY_CENTROID_SWEREF),
    sweref99ToWgs84: vi.fn().mockResolvedValue(PROPERTY_CENTROID_WGS84),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function provisionRealProject(args: {
  repo: InMemoryArtifactRepository;
  issuer: ReturnType<typeof createProjectContextBindingIssuerArtifact>;
  signing: SigningKeyProvider;
  projectId: string;
  propertyDesignation: string;
}) {
  const geometry = createCanonicalPropertyGeometryArtifact({
    geometry: { type: 'Polygon', coordinates: [[[14, 61], [14.1, 61], [14, 61.1], [14, 61]]] },
  });
  const observation = createPropertyLookupObservationArtifact({
    property_identity: `property:test:${args.projectId}`,
    property_designation: args.propertyDesignation,
    source_key: args.projectId,
    source_dataset: 'test-source',
    source_updated_at: '2026-08-22T00:00:00.000Z',
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
    attestation: await attestProjectContextBindingArtifact({ artifact: propertyBindingUnsigned, issuer: args.issuer, signing: args.signing }),
  };
  const propertyBindingRef = { artifact_id: propertyBinding.artifact_id, artifact_type: propertyBinding.artifact_type };
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: observation.payload.property_identity,
    property_ref: args.propertyDesignation,
    official_name: args.propertyDesignation,
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    municipality: 'TESTKOMMUN',
    coordinates: PROPERTY_CENTROID_SWEREF,
    project_property_binding_ref: propertyBindingRef,
  });
  const projectContext = createProductLuProjectContextArtifact({
    project_id: args.projectId,
    project_name: args.propertyDesignation,
    description: 'PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B proof',
    created_by: 'test-owner',
    property_context_ref: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type },
    project_property_binding_ref: propertyBindingRef,
  });
  const contextBindingUnsigned = createProjectContextBindingArtifact({
    project_id: args.projectId,
    project_context_ref: { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type },
    project_property_binding_ref: propertyBindingRef,
    binding_version: 'project-context-binding-v2',
    authority_ref: { artifact_id: args.issuer.artifact_id, artifact_type: args.issuer.artifact_type },
    created_at: '2026-08-22T00:00:00.000Z',
  });
  const contextBinding = {
    ...contextBindingUnsigned,
    attestation: await attestProjectContextBindingArtifact({ artifact: contextBindingUnsigned, issuer: args.issuer, signing: args.signing }),
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
    contextBindingRef: { artifact_id: contextBinding.artifact_id, artifact_type: contextBinding.artifact_type },
    projectContextRef: { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type },
    propertyContextRef: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type },
    propertyIdentity: observation.payload.property_identity,
  };
}

describe('PRODUCT-LU-LOCALIZATION-GEOMETRY-01 — end-to-end product proofs through the real usecase', () => {
  let repo: InMemoryArtifactRepository;
  let issuer: ReturnType<typeof createProjectContextBindingIssuerArtifact>;
  let registry: ReturnType<typeof createLuRegistryRuntime>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(orchestrator, 'generateDocumentEvidence').mockResolvedValue([]);
    repo = new InMemoryArtifactRepository();
    issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    registry = createLuRegistryRuntime();

    process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = issuerKey.provider.keyId;
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = issuerKey.publicKey;
    const luKey = LocalPemSigningKeyProvider.generate('ed25519:lu-execution-authority-geometry-proofs');
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = luKey.privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = luKey.publicKey;
    process.env.PRODUCT_RELEASE_ARTIFACT_ID = RELEASE_ID;
    process.env.PRODUCT_RELEASE_HASH = RELEASE_HASH;
  });

  afterEach(() => {
    delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID;
    delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM;
    delete process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
    delete process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    delete process.env.PRODUCT_RELEASE_ARTIFACT_ID;
    delete process.env.PRODUCT_RELEASE_HASH;
  });

  async function putRelease() {
    await repo.put({
      artifact_id: RELEASE_ID,
      content_hash: { algorithm: 'sha256', value: 'irrelevant-for-this-proof' },
      body: { artifact_id: RELEASE_ID, artifact_type: 'product_release_manifest', release_hash: { value: RELEASE_HASH } },
    });
  }

  async function issueV3For(args: {
    projectId: string;
    propertyIdentity: string;
    contextBindingRef: { artifact_id: string; artifact_type: string };
    projectContextRef: { artifact_id: string; artifact_type: string };
    propertyContextRef: { artifact_id: string; artifact_type: string };
    geometryRef: { artifact_id: string; artifact_type: string };
  }) {
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    const subject: ExecutionIdentitySubjectV3 = {
      site_id: args.propertyIdentity,
      project_context_binding_ref: args.contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_ID, artifact_type: 'product_release_manifest' },
      execution_contract_version: 'lu-execution-identity-v1',
      localization_geometry_ref: args.geometryRef,
    };
    const seed = deriveLuExecutionSeed({
      site_id: args.propertyIdentity,
      project_id: args.projectId,
      project_context_ref: args.projectContextRef,
      property_context_ref: args.propertyContextRef,
      project_context_binding_ref: args.contextBindingRef,
      product_release_ref: { artifact_id: RELEASE_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_HASH,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      localization_geometry_ref: args.geometryRef,
    });
    return issueExecutionIdentityV3({
      subject,
      deterministic_seed: seed,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repo,
    });
  }

  it('proof 10 + compatibility: existing project with no explicit geometry -> exactly one derived_from_property_boundary POINT is created and reused, and the run executes', async () => {
    await putRelease();
    const projectId = `project-geometry-derive-${Date.now()}`;
    const provisioned = await provisionRealProject({ repo, issuer, signing: issuerKey.provider, projectId, propertyDesignation: 'DERIVE 1:1' });

    // No LocalizationGeometryArtifact ever registered for this project -- the legacy/pre-Phase-B
    // state EVERY existing project is in. resolveCurrentLocalizationGeometry must refuse (nothing
    // to resolve yet); the usecase derives one from the property centroid.
    await expect(
      resolveCurrentLocalizationGeometry({ projectId, artifactRepository: repo }),
    ).rejects.toThrow(/REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND/);

    // LOCALIZATION-GEOMETRY-CANONICALIZATION-V2: the real derive path
    // (resolveOrDeriveCurrentLocalizationGeometry) now quantizes the centroid to the canonical
    // 0.1m grid and constructs a V2 artifact -- replicate that exactly, not the old V1 path,
    // or this pinned geometryRef will never match what the real code actually derives.
    const derivedGeometry = createLocalizationGeometryArtifactV2({
      project_id: projectId,
      property_context_ref: provisioned.propertyContextRef,
      wgs84LngLat: [PROPERTY_CENTROID_WGS84[1], PROPERTY_CENTROID_WGS84[0]],
      sweref99NorthingEasting: [
        quantizeToLocalizationGeometryGrid(PROPERTY_CENTROID_SWEREF[0]),
        quantizeToLocalizationGeometryGrid(PROPERTY_CENTROID_SWEREF[1]),
      ],
      provenance: 'derived_from_property_boundary',
      label: 'Fastighetens centrumpunkt (automatiskt härledd)',
      created_by: 'system',
    });
    await issueV3For({ ...provisioned, projectId, geometryRef: { artifact_id: derivedGeometry.artifact_id, artifact_type: derivedGeometry.artifact_type } });

    const queryRecorder: SpatialQueryRequest[] = [];
    const runtimeFactory = async () => makeRuntime(repo, queryRecorder);

    const firstReport = await new GenerateLocalizationReportUseCase(runtimeFactory).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(firstReport.siteAnalyses[0].executionMotor?.admitted).toBe(true);

    const currentAfterFirst = await resolveCurrentLocalizationGeometry({ projectId, artifactRepository: repo });
    expect(currentAfterFirst.geometryArtifactId).toBe(derivedGeometry.artifact_id);

    // Replay: the SAME derived geometry must be reused, never a second derived artifact minted.
    const secondReport = await new GenerateLocalizationReportUseCase(runtimeFactory).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(secondReport.siteAnalyses[0].executionMotor?.admitted).toBe(true);
    const currentAfterSecond = await resolveCurrentLocalizationGeometry({ projectId, artifactRepository: repo });
    expect(currentAfterSecond.geometryArtifactId).toBe(derivedGeometry.artifact_id);
    expect(secondReport.siteAnalyses[0].executionMotor?.assessment_artifact_id).toBe(
      firstReport.siteAnalyses[0].executionMotor?.assessment_artifact_id,
    );
  });

  it('proof 2 + 3 + 11: move point A -> B changes identity/manifest, keeps A historical, and the spatial query uses B exactly', async () => {
    await putRelease();
    const projectId = `project-geometry-move-${Date.now()}`;
    const provisioned = await provisionRealProject({ repo, issuer, signing: issuerKey.provider, projectId, propertyDesignation: 'MOVE 1:1' });

    const pointA = createLocalizationGeometryArtifact({
      project_id: projectId,
      property_context_ref: provisioned.propertyContextRef,
      wgs84LngLat: [18.07, 59.33],
      sweref99NorthingEasting: [6590000, 675000],
      provenance: 'user_defined',
      label: 'Point A',
      created_by: 'test-user',
    });
    await repo.put({ artifact_id: pointA.artifact_id, content_hash: pointA.content_hash, body: pointA });
    await registerLocalizationGeometry({ projectId, geometry: pointA });

    const identityA = await issueV3For({
      ...provisioned,
      projectId,
      geometryRef: { artifact_id: pointA.artifact_id, artifact_type: pointA.artifact_type },
    });

    const queryRecorderA: SpatialQueryRequest[] = [];
    const reportA = await new GenerateLocalizationReportUseCase(async () => makeRuntime(repo, queryRecorderA)).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(reportA.siteAnalyses[0].executionMotor?.admitted).toBe(true);
    expect(queryRecorderA[0]?.location_ref?.artifact_id).toBe(pointA.artifact_id);
    const assessmentA = reportA.siteAnalyses[0].executionMotor!.assessment_artifact_id!;
    const manifestA = reportA.siteAnalyses[0].executionMotor!.manifest_id!;

    // --- move the point: point B becomes current (later createdAt than A) ---
    const pointB = createLocalizationGeometryArtifact({
      project_id: projectId,
      property_context_ref: provisioned.propertyContextRef,
      wgs84LngLat: [18.20, 59.40],
      sweref99NorthingEasting: [6600000, 680000],
      provenance: 'user_defined',
      label: 'Point B',
      created_by: 'test-user',
    });
    await repo.put({ artifact_id: pointB.artifact_id, content_hash: pointB.content_hash, body: pointB });
    // LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1: registering B alone no longer makes it
    // current -- currentness requires the explicit signed predecessor->successor supersession
    // edge (this is exactly the H4/H9 fix; createdAt has no authority here anymore).
    await registerLocalizationGeometry({ projectId, geometry: pointB });
    await supersedeGeometry({ repo, projectId, predecessor: pointA, successor: pointB });

    const current = await resolveCurrentLocalizationGeometry({ projectId, artifactRepository: repo });
    expect(current.geometryArtifactId).toBe(pointB.artifact_id);
    expect(current.geometryArtifactId).not.toBe(pointA.artifact_id);

    // Running now, with ONLY identityA issued (no identity for B yet), must DENY -- the old
    // identity cannot authorize the new point.
    const denyRecorder: SpatialQueryRequest[] = [];
    const denyReport = await new GenerateLocalizationReportUseCase(async () => makeRuntime(repo, denyRecorder)).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(denyReport.siteAnalyses[0].executionMotor?.admitted).toBe(false);

    // Now issue the matching V3 identity for point B and re-run: must ACCEPT with a DISTINCT
    // identity/manifest, and the spatial query must have used B's exact coordinates.
    await issueV3For({
      ...provisioned,
      projectId,
      geometryRef: { artifact_id: pointB.artifact_id, artifact_type: pointB.artifact_type },
    });
    const queryRecorderB: SpatialQueryRequest[] = [];
    const reportB = await new GenerateLocalizationReportUseCase(async () => makeRuntime(repo, queryRecorderB)).execute({
      projectId,
      siteAlternatives: [{ id: 'alt-1', lat: 59.33, lng: 18.07 }],
    });
    expect(reportB.siteAnalyses[0].executionMotor?.admitted).toBe(true);
    expect(queryRecorderB[0]?.location_ref?.artifact_id).toBe(pointB.artifact_id);
    // Proof 11: the exact point reached the spatial provider, not the property centroid, and not A.
    expect(queryRecorderB[0]?.location_ref?.artifact_id).not.toBe(pointA.artifact_id);

    const assessmentB = reportB.siteAnalyses[0].executionMotor!.assessment_artifact_id!;
    const manifestB = reportB.siteAnalyses[0].executionMotor!.manifest_id!;

    // Proof 2: new geometry ref, new manifest, distinct assessment.
    expect(manifestB).not.toBe(manifestA);
    expect(assessmentB).not.toBe(assessmentA);

    // Proof 3: A remains readable by its exact ref (immutable historical evidence)...
    const historicalA = await repo.resolve<{ artifact_id: string }>({ artifact_id: assessmentA, artifact_type: 'LOCALIZATION_ASSESSMENT' });
    expect(historicalA.artifact_id).toBe(assessmentA);
    // ...but "current assessment" for the project now resolves to B, never A.
    const currentBindingProvider = new ProjectContextBindingProvider(repo, new PrismaProjectContextBindingIndex(), getProjectContextBindingIssuerVerifier());
    const currentGeometryNow = await resolveCurrentLocalizationGeometry({ projectId, artifactRepository: repo });
    const currentAssessment = await resolveCurrentAssessmentProjection({
      projectId,
      artifactRepository: repo,
      currentBindingProvider,
      currentLocalizationGeometryArtifactId: currentGeometryNow.geometryArtifactId,
    });
    expect(currentAssessment.assessmentArtifactId).toBe(assessmentB);
    expect(currentAssessment.assessmentArtifactId).not.toBe(assessmentA);
  });
});
