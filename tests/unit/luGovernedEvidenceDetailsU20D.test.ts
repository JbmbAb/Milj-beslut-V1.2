/**
 * U20-D (LU 72h; U20-U30 spec 1.5 K3/K5, 1.6 U20-D) -- evidence and property-root details, and
 * the governed layer checks, are the SAME live (generate-report), after read-back
 * (resolveCurrentLuAssessmentSummary / GET current-assessment) and in the PDF
 * (exportCurrentLuAssessmentPdf). A tampered evidence fails the read-back closed (424); an older
 * assessment without details gets honest text, never an empty field. Export and verify can be bound
 * to an explicit assessment id and fail closed on a mismatch.
 *
 * Real chain, hermetic: the real GenerateLocalizationReportUseCase runs the REAL internal LU kernel
 * (runLuAssessmentViaKernel, bootstrap admission, as H15's own suite does) over content-addressed
 * spatial evidence in an in-memory CAS; the read-back, PDF, verify and HTTP route read that same
 * CAS. server/db/prisma is the throwing guard; every index is in memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALIZATION_GEOMETRY_UNVERIFIED_SV } from '../../server/modules/localization/localizationOrchestrator';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register() {}
    async listForProject() { return []; }
  },
}));
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => ({
  PrismaLocalizationGeometrySupersessionIndex: class {
    async register() {}
    async listForProject() { return []; }
  },
}));
vi.mock('../../server/repositories/projectAccessRepository', () => ({ assertProjectMembership: vi.fn(async () => undefined) }));
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

const state = vi.hoisted(() => ({
  repository: null as unknown,
  bindingIndex: null as unknown,
  projectionIndex: null as unknown,
  verification: null as unknown,
  context: null as unknown,
  geometry: null as unknown,
  /** U20CDF: optional wrapper around the real re-execution (to add a U30-R2 notice). */
  reExecute: null as null | ((real: (args: unknown) => Promise<unknown>, args: unknown) => Promise<unknown>),
}));

vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MimersIntegration: { create: vi.fn(async () => ({ artifactRepository: state.repository })) },
}));
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    register(...args: unknown[]) { return (state.bindingIndex as { register: (...a: unknown[]) => unknown }).register(...args); }
    resolve(...args: unknown[]) { return (state.bindingIndex as { resolve: (...a: unknown[]) => unknown }).resolve(...args); }
    registerSupersession() { return Promise.resolve(); }
    listBindingRefs(projectId: string) { return (state.bindingIndex as { listBindingRefs: (p: string) => unknown }).listBindingRefs(projectId); }
    listSupersessionRefs() { return Promise.resolve([]); }
  },
}));
vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => ({
  PrismaProjectAssessmentProjectionIndex: class {
    register(...args: unknown[]) { return (state.projectionIndex as { register: (...a: unknown[]) => unknown }).register(...args); }
    listForProject(projectId: string) { return (state.projectionIndex as { listForProject: (p: string) => unknown }).listForProject(projectId); }
  },
}));
vi.mock('../../server/security/projectContextBindingIssuerKey', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getProjectContextBindingIssuerVerifier: () => state.verification,
}));
let capturedPdfData: unknown;
vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: async (_title: string, _subtitle: string | undefined, data: unknown) => {
    capturedPdfData = data;
    return Buffer.from('fake-pdf-bytes-for-test');
  },
}));

// generate-report: the real usecase; only the composition-root collaborators are stubbed, and the
// canonical kernel entry is replaced by the REAL internal kernel (no V3 identity provisioning here).
vi.mock('@miljobeslut/mps-lu', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const kernel = await import('../../packages/mps-lu/src/execution/LuExecutionKernelClient');
  return {
    ...original,
    deriveLuExecutionSeed: vi.fn(() => 'canonical-seed-u20d'),
    reExecuteLocalizationAssessment: (args: unknown) => {
      const real = original.reExecuteLocalizationAssessment as (a: unknown) => Promise<unknown>;
      return state.reExecute ? state.reExecute(real, args) : real(args);
    },
    runCanonicalLuProductAssessment: (input: Record<string, unknown>) =>
      kernel.runLuAssessmentViaKernel({
        site_id: input.site_id as string,
        deterministic_seed: `${String(input.deterministic_seed)}:${Math.random()}`,
        evidence: input.evidence as never,
        document_evidence: input.document_evidence as never,
        verified_document_facts: input.verified_document_facts as never,
        unavailable_layers: input.unavailable_layers as never,
        artifact_repository: input.artifact_repository as never,
        assessment_draft: input.assessment_draft as never,
      }),
  };
});
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: vi.fn(async () => state.context),
}));
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({
  resolveCanonicalProductRelease: vi.fn(async () => ({
    artifact_id: 'product-release-u20d', artifact_type: 'product_release_manifest', release_hash: { value: 'c'.repeat(64) },
  })),
}));
vi.mock('../../server/modules/localization/localizationGeometryService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveOrDeriveCurrentLocalizationGeometry: vi.fn(async () => ({ geometry: state.geometry, wasDerived: false })),
}));
vi.mock('../../src/application/enqueue-lu-execution-ticket', () => ({ enqueueAdmittedLuTicket: vi.fn(async () => 'ticket-u20d') }));
vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: { logAction: vi.fn(async () => undefined) },
  getAuditTrail: vi.fn(async () => []),
}));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import express from 'express';
import request from 'supertest';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '../../packages/mps-compliance/src/artifacts/ArtifactReference';
import {
  buildSpatialEvidenceContentHash,
  classifyVerifyPresentation,
  createCanonicalPropertyGeometryArtifact,
  createGovernedLocalizationAssessment,
  createLocalizationGeometryArtifact,
  createProductLuProjectContextArtifact,
  createProductLuPropertyContextArtifact,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  createProjectPropertyBindingArtifact,
  createPropertyLookupObservationArtifact,
  SPATIAL_STACK_V1,
  type LocalizationAssessmentArtifact,
} from '@miljobeslut/mps-lu';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { installOwnerIssuedProjectContextBinding } from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import { attestProjectContextBindingSupersessionIssuerArtifact } from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { computeGovernedLayerChecks } from '../../server/modules/localization/governedLayerChecks';
import {
  exportCurrentLuAssessmentPdf,
  resolveCurrentLuAssessmentSummary,
  verifyCurrentLuAssessment,
} from '../../server/modules/localization/localizationOrchestrator';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';
import type { AuthUser } from '../../server/security/types';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import { LuReExecutionStorageError } from '../../packages/mps-lu/src/execution/LuReExecutionStorageError';

/** U30-R6 / W-PLUMB-S: the owner's exact wording (2026-10-02), written out here independently of the code (an oracle). */
const OWNER_TEXT_SV =
  'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';
/**
 * W-T1TEXT (owner decision 2026-10-03): the green sentence -- consistency against the SAVED basis, with the reservation
 * (authenticity, origin, current authority NOT verified) -- and the part of it no other result text has.
 */
const GREEN_HEAD_SV = 'Reproducerbar konsistens verifierad mot sparat underlag – resultatet matchar de pinnade artefakterna';
const RESERVATION_SV = 'Äkthet, ursprung (datakälla och vem som matade in underlaget) och aktuell authority är inte verifierade.';
const GREEN_MARKER_SV = 'verifierad mot sparat underlag';

class MemoryRepository {
  readonly values = new Map<string, unknown>();
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    const value = this.values.get(reference.artifact_id);
    if (!value) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return structuredClone(value) as T;
  }
}

class MemoryBindingIndex implements ProjectContextBindingIndex {
  private readonly byProjectAndContext = new Map<string, string>();
  private readonly bindingsByProject = new Map<string, ArtifactReference[]>();
  private key(projectId: string, context: ArtifactReference): string {
    return `${projectId}:${context.artifact_type}:${context.artifact_id}`;
  }
  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    this.byProjectAndContext.set(this.key(binding.payload.project_id, binding.payload.project_context_ref), binding.artifact_id);
    const list = this.bindingsByProject.get(binding.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === binding.artifact_id)) {
      list.push({ artifact_id: binding.artifact_id, artifact_type: binding.artifact_type });
      this.bindingsByProject.set(binding.payload.project_id, list);
    }
  }
  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const bindingId = this.byProjectAndContext.get(this.key(projectId, context));
    if (!bindingId) throw new Error('no binding');
    return bindingId;
  }
  async registerSupersession(): Promise<void> {}
  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.bindingsByProject.get(projectId) ?? [];
  }
  async listSupersessionRefs(): Promise<readonly ArtifactReference[]> {
    return [];
  }
  async findProjectContextRef(): Promise<ArtifactReference> {
    throw new Error('not used by the read-back path under test');
  }
}

class FakeAssessmentProjectionIndex implements ProjectAssessmentProjectionIndex {
  private counter = 0;
  private readonly rowsByProject = new Map<string, ProjectAssessmentProjectionRow[]>();
  async register(row: {
    projectId: string; assessmentArtifactId: string; assessmentArtifactType: string;
    projectContextRef: ArtifactReference; bindingArtifactId: string; releaseArtifactId: string;
    localizationGeometryArtifactId?: string | null;
  }): Promise<void> {
    const list = this.rowsByProject.get(row.projectId) ?? [];
    this.counter += 1;
    list.push({
      projectId: row.projectId, assessmentArtifactId: row.assessmentArtifactId, assessmentArtifactType: row.assessmentArtifactType,
      projectContextRefId: row.projectContextRef.artifact_id, projectContextRefType: row.projectContextRef.artifact_type,
      bindingArtifactId: row.bindingArtifactId, releaseArtifactId: row.releaseArtifactId,
      localizationGeometryArtifactId: row.localizationGeometryArtifactId ?? null, createdAt: new Date(this.counter * 1000),
    });
    this.rowsByProject.set(row.projectId, list);
  }
  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    return [...(this.rowsByProject.get(projectId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

const PROJECT_ID = 'project-u20d-evidence-details';
const AUTH_USER: AuthUser = { id: 'user-u20d', organisationId: 'org-u20d', bankidId: 'bankid:u20d', role: 'CONSULTANT' };
const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-u20d');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-u20d');

/** The registry content hashes (= ADMIT v1 source_sha256) the governed layers are bound to. */
const REGISTRY_HASH: Record<string, string> = {
  water: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
  ebh: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
  protected_area: '983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae',
  natura2000: 'a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02',
  water_protection_area: 'ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18',
};
const PROVIDER: Record<string, string> = {
  water: 'SGU', ebh: 'Länsstyrelsen', protected_area: 'Naturvårdsverket', natura2000: 'Naturvårdsverket', water_protection_area: 'Naturvårdsverket',
};

/** Content-addressed spatial evidence, built the way SpatialProviderPostGIS builds it (V3 contract). */
function evidenceFor(layer: string, matchCount: number, propertyRef: ArtifactReference, locationRef: ArtifactReference) {
  const payload = {
    result_semantics: {
      kind: 'EXISTENCE_WITHIN_DISTANCE' as const,
      query: { subject_ref: propertyRef, srid: 3006, distance_meters: 500 },
      result: { exists: matchCount > 0, match_count_observed: matchCount, max_features_per_layer: 50 },
    },
    property_ref: propertyRef,
    srid: 3006,
    operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
    geometry: null,
    layer_ref: { layer_id: layer, version_hash: REGISTRY_HASH[layer]!, layer_version: 'v1.0' },
    source_metadata: { provider: PROVIDER[layer]!, dataset: layer, dataset_version: REGISTRY_HASH[layer]!, retrieved_at: '2026-10-02T10:00:00.000Z' },
    query_contract: {
      query_contract_version: 'spatial-query-contract-v3' as const,
      spatial_canonical_version: 'sv-canonical-3' as const,
      relation: 'DWITHIN' as const,
      subject: { kind: 'LOCALIZATION_GEOMETRY' as const, property_context_ref: propertyRef, location_ref: locationRef, crs: 'EPSG:3006' as const },
      parameters: { distance_meters: 500, max_features_per_layer: 50 },
      selection: { predicate_semantics: 'EXISTS' as const },
    },
  };
  const content_hash = buildSpatialEvidenceContentHash(payload as never);
  return {
    artifact_id: `evidence-${layer}-${content_hash.value.slice(0, 16)}`,
    artifact_type: 'SPATIAL_EVIDENCE' as const,
    content_hash,
    references: [propertyRef],
    payload,
  };
}

/** water: 3 hits, ebh/protected_area: none, natura2000: the 50-feature cap, wpa: as given. */
const MATCH_COUNTS: Record<string, number> = { water: 3, ebh: 0, protected_area: 0, natura2000: 50, water_protection_area: 0 };

async function setup(options: {
  readonly unavailable?: readonly string[];
  readonly legacyContext?: boolean;
  /** U20CDF2 (G3): replace the provider's result object for these layers (after the evidence was hashed). */
  readonly evidenceResult?: Readonly<Record<string, Record<string, unknown>>>;
  /** U20CDF2 (G3): also report these layers as unavailable, while still returning their evidence. */
  readonly alsoUnavailable?: readonly string[];
} = {}) {
  const repository = new MemoryRepository();
  const bindingIndex = new MemoryBindingIndex();
  const projectionIndex = new FakeAssessmentProjectionIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = pcbSupersessionIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = pcbSupersessionIssuerKey.publicKey;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const supersessionIssuerUnsigned = createProjectContextBindingSupersessionIssuerArtifact({
    issuer_key_id: pcbSupersessionIssuerKey.provider.keyId,
    owner_authority_ref: pcbAuthority,
  });
  const supersessionIssuer = {
    ...supersessionIssuerUnsigned,
    attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: supersessionIssuerUnsigned, signing: pcbSupersessionIssuerKey.provider }),
  };
  await repository.put({ artifact_id: supersessionIssuer.artifact_id, body: supersessionIssuer });

  // The property root, exactly as the bootstrap worker issues it: geometry -> lookup observation ->
  // project-property binding -> product property context.
  const geometry = createCanonicalPropertyGeometryArtifact({ geometry: { type: 'Point', coordinates: [17.63, 59.85] } });
  const geometryRef = { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type };
  const observation = createPropertyLookupObservationArtifact({
    property_identity: 'core.property_unit:u20d-source-key',
    property_designation: 'UPPSALA U20D 1:1',
    source_key: 'u20d-source-key',
    source_dataset: 'core.property_unit',
    source_updated_at: '2026-06-28T00:00:00.000Z',
    municipality: 'Uppsala',
    geometry_ref: geometryRef,
  });
  const propertyBinding = createProjectPropertyBindingArtifact({
    project_id: PROJECT_ID,
    property_identity: observation.payload.property_identity,
    property_designation: observation.payload.property_designation,
    geometry_ref: geometryRef,
    source_refs: [{ artifact_id: observation.artifact_id, artifact_type: observation.artifact_type }],
    resolver_id: 'postgis-property-unit-exact',
    resolver_version: 'canonical-property-observation-v1',
    contract_version: 'project-property-binding-v1',
  });
  const propertyBindingRef = { artifact_id: propertyBinding.artifact_id, artifact_type: propertyBinding.artifact_type } as const;
  const propertyContext = options.legacyContext
    ? {
        // An older, pre-product LU property context: no binding ref, no property identity.
        artifact_id: 'lu-property-context-legacy-u20d',
        artifact_type: 'LU_PROPERTY_CONTEXT' as const,
        content_hash: sha256ContentHash({ legacy: true }),
        references: [],
        payload: { property_ref: 'UPPSALA U20D 1:1', official_name: 'Uppsala U20D 1:1', geometry_ref: geometryRef, municipality: 'Uppsala', coordinates: [59.85, 17.63] as const },
      }
    : createProductLuPropertyContextArtifact({
        property_identity: observation.payload.property_identity,
        property_ref: 'UPPSALA U20D 1:1',
        official_name: 'Uppsala U20D 1:1',
        geometry_ref: geometryRef,
        municipality: 'Uppsala',
        coordinates: [59.85, 17.63],
        project_property_binding_ref: propertyBindingRef,
      });
  for (const artifact of [geometry, observation, propertyBinding, propertyContext]) {
    await repository.put({ artifact_id: artifact.artifact_id, body: artifact });
  }
  const propertyContextRef = { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type } as const;

  // The localization point the run uses -- a real, content-addressed LocalizationGeometryArtifact.
  const localizationGeometry = createLocalizationGeometryArtifact({
    project_id: PROJECT_ID,
    property_context_ref: propertyContextRef,
    wgs84LngLat: [17.63, 59.85],
    sweref99NorthingEasting: [6640000, 648000],
    provenance: 'user_defined',
    label: 'U20-D punkt',
    created_by: AUTH_USER.id,
  });
  await repository.put({ artifact_id: localizationGeometry.artifact_id, body: localizationGeometry });
  const locationRef = { artifact_id: localizationGeometry.artifact_id, artifact_type: localizationGeometry.artifact_type } as const;
  state.geometry = localizationGeometry;

  const projectContext = createProductLuProjectContextArtifact({
    project_id: PROJECT_ID,
    project_name: 'U20-D project',
    description: 'Test project for U20-D evidence details',
    created_by: AUTH_USER.id,
    property_context_ref: propertyContextRef,
    project_property_binding_ref: propertyBindingRef,
  });
  await repository.put({ artifact_id: projectContext.artifact_id, body: projectContext });
  const projectContextRef = { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type } as const;

  const bindingUnsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: projectContextRef, project_property_binding_ref: propertyBindingRef,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-10-02T00:00:00.000Z',
  });
  const binding = { ...bindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: bindingUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index: bindingIndex, binding, verification: pcbVerification });
  const bindingRef = { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type } as const;

  state.repository = repository;
  state.bindingIndex = bindingIndex;
  state.projectionIndex = projectionIndex;
  state.verification = pcbVerification;
  state.context = {
    projectContextRef,
    propertyContextRef,
    geometryRef,
    contextBindingRef: bindingRef,
    propertyIdentity: observation.payload.property_identity,
    coordinates: [6640000, 648000],
    geometry: { type: 'Point', coordinates: [648000, 6640000] },
  };

  const unavailable = new Set(options.unavailable ?? []);
  const runtime = {
    artifactRepository: repository,
    resolveSpatialProvider: () => ({
      query: async () => {
        const evidence = [];
        const unavailable_layers = [];
        for (const layer of Object.keys(MATCH_COUNTS)) {
          if (unavailable.has(layer)) {
            // The provider's raw technical reason: it must not be echoed by the checks or details.
            unavailable_layers.push({ dataset: layer, reason: 'error: relation "env.u20d_missing" does not exist' });
            continue;
          }
          const ev = evidenceFor(layer, MATCH_COUNTS[layer]!, propertyContextRef, locationRef);
          const replaced = options.evidenceResult?.[layer];
          if (replaced) (ev.payload.result_semantics as { result: unknown }).result = replaced;
          await repository.put({ artifact_id: ev.artifact_id, body: ev });
          evidence.push(ev);
          if (options.alsoUnavailable?.includes(layer)) unavailable_layers.push({ dataset: layer, reason: 'SOURCE_UNAVAILABLE' });
        }
        return { evidence, unavailable_layers };
      },
    }),
    sweref99ToWgs84: async () => [59.85, 17.63] as const,
    close: async () => undefined,
  };

  async function runFresh() {
    const report = await new GenerateLocalizationReportUseCase(async () => runtime as never).execute({
      projectId: PROJECT_ID,
      siteAlternatives: [{ id: 'site-u20d', name: 'Alternativ U20-D', lat: 59.85, lng: 17.63 }],
      user: AUTH_USER,
    });
    return report.siteAnalyses[0]!;
  }

  const deps = (extra: { expectedAssessmentArtifactId?: string } = {}) => ({
    authUser: AUTH_USER,
    projectId: PROJECT_ID,
    artifactRepository: repository as never,
    currentBindingProvider: new ProjectContextBindingProvider(repository as never, bindingIndex, pcbVerification),
    assessmentProjectionIndex: projectionIndex,
    ...extra,
  });

  /**
   * For the "older assessment" cases: a governed assessment with no pinned evidence, and (U20CDF)
   * optionally stored findings as an older producer wrote them.
   */
  async function persistBareAssessment(findings: readonly Record<string, unknown>[] = []) {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `u20d-${Math.random()}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-u20d-${Math.random()}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-u20d', artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
    };
    const created = createGovernedLocalizationAssessment({
      draft: { site_id: 'site-u20d-old', project_context_ref: projectContextRef, property_ref: propertyContextRef, evidence_refs: [], system_summary: 'older assessment' },
      findings: findings as never, outcome, attestation: security.attestOutcome(outcome.content_hash),
    });
    // W-U20CDF5 (L2, owner decision 2026-10-02: assessment_contract_version is the epoch marker): an OLDER
    // assessment -- one written before any declared contract -- is a V1 record (no assessment_contract_version,
    // re-identified so its own hash still matches). A V3 record without pinned evidence is not "older": its
    // silent layers break its contract (RECORD_INTEGRITY_ERROR).
    const { assessment_contract_version: _version, canonicalizer_id: _canonicalizer, ...v1Payload } = created.payload;
    const v1Hash = sha256ContentHash({ artifact_type: created.artifact_type, references: created.references, payload: v1Payload });
    const assessment = { ...created, payload: v1Payload, content_hash: v1Hash, artifact_id: `assessment-${v1Hash.value}` } as typeof created;
    await repository.put({ artifact_id: assessment.artifact_id, body: assessment });
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: bindingRef, releaseRef: { artifact_id: 'r', artifact_type: 'product_release' }, index: projectionIndex });
    return assessment;
  }

  return { repository, runFresh, deps, persistBareAssessment, propertyContextRef, observation, locationRef };
}

type Summary = Extract<Awaited<ReturnType<typeof resolveCurrentLuAssessmentSummary>>, { ok: true }>;
type PdfData = Record<string, unknown> & {
  lagerkontroller: Array<Record<string, unknown>>;
  evidensdetaljer: Array<Record<string, unknown>>;
  fastighetsrot: Record<string, unknown>;
  helhetsbedomning: Record<string, unknown>;
};

async function readBack(s: Awaited<ReturnType<typeof setup>>): Promise<Summary> {
  const summary = await resolveCurrentLuAssessmentSummary(s.deps());
  expect(summary.ok, JSON.stringify(summary)).toBe(true);
  return summary as Summary;
}

function app() {
  const server = express();
  server.use(express.json());
  server.use(localizationRoutes);
  return server;
}
const token = () => createTokenPair({ id: AUTH_USER.id, organisationId: AUTH_USER.organisationId, bankidId: AUTH_USER.bankidId, role: 'ADMIN' }).accessToken;

// U30-R5 (K0 model): verify accepts these bootstrap executions only in an EXPLICIT test process -- the flag "1"
// AND NODE_ENV exactly "test" AND APP_ENV exactly "test"/"ci" -- set here, never as a global default; the flag
// outside such a process makes verify refuse (BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST).
const savedBootstrapEnv = new Map<string, string | undefined>();

beforeEach(() => {
  state.reExecute = null;
  capturedPdfData = undefined;
  hermeticPrismaTouches.length = 0;
  for (const key of ['NODE_ENV', 'APP_ENV']) savedBootstrapEnv.set(key, process.env[key]);
  process.env.MPS_LU_BOOTSTRAP_ADMIT = '1';
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'test';
});

afterEach(() => {
  delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  for (const [key, value] of savedBootstrapEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('U20-D: the same governed details live, after read-back and in the PDF', () => {
  it('layer checks, evidence details and property root are identical in the fresh run, the read-back, HTTP and the PDF', async () => {
    const s = await setup({ unavailable: ['water_protection_area'] });
    const fresh = await s.runFresh();
    expect(fresh.executionMotor?.assessment_status).toBe('ASSESSED');

    const summary = await readBack(s);
    expect(summary.assessmentArtifactId).toBe(fresh.executionMotor?.assessment_artifact_id);
    // The server is the one source of the layer checks, fresh and re-opened alike.
    expect(summary.governedLayerChecks).toEqual(fresh.executionMotor?.governed_layer_checks);
    expect(summary.evidenceDetails).toEqual(fresh.executionMotor?.evidence_details);
    expect(summary.propertyRoot).toEqual(fresh.executionMotor?.property_root);
    expect(summary.governedLayerChecks.map((c) => [c.layer, c.coverage_state])).toEqual([
      ['water', 'CHECKED_HIT'],
      ['ebh', 'CHECKED_NO_HIT'],
      ['protected_area', 'CHECKED_NO_HIT'],
      ['natura2000', 'CHECKED_HIT'],
      ['water_protection_area', 'SOURCE_UNAVAILABLE'],
      ['document', 'NOT_CHECKED'],
    ]);
    // The provider's raw technical reason is not echoed by the checks or the details.
    expect(JSON.stringify([summary.governedLayerChecks, summary.evidenceDetails])).not.toContain('does not exist');

    // OD-K0-1: the overall risk only together with its coverage (HIGH from the natura2000 finding).
    expect(summary.overallStatement).toEqual({
      risk_level: 'HIGH',
      // U20CDF2 (G1): a current record -- every layer accounted for, findings and evidence consistent.
      coverage_state: 'DETERMINED',
      coverage_basis: [],
      coverage: {
        checks_total: 6, checks_completed: 4, checks_not_completed: 2, not_completed_layers: ['water_protection_area', 'document'],
        // U20CDF (F6): completed checks resting on a basis with known coverage gaps.
        checks_completed_with_limited_coverage: 2, limited_coverage_layers: ['protected_area', 'natura2000'],
      },
      statement_sv: 'Hög risk i de kontroller som utfördes; underlaget är ofullständigt: 4 av 6 kontroller genomförda.',
    });
    expect(fresh.complianceAnalysis.summary).toBe(summary.overallStatement.statement_sv);
    // Provisional, derived (coordinator item 3): the same derivation, its own field. U20CDF (F10):
    // "provisional" is in the payload, next to "derived".
    expect(summary.overall_summary).toEqual({
      provisional: true,
      derived: true,
      derivation: 'governedVerdictFromFindings + governed layer checks (stored)',
      risk_level: 'HIGH',
      coverage_state: 'DETERMINED',
      checks_completed: 4,
      checks_total: 6,
      not_completed_layers: ['water_protection_area', 'document'],
      coverage_limited_layers: ['protected_area', 'natura2000'],
      document_check_status: 'NOT_CHECKED',
      statement_sv: summary.overallStatement.statement_sv,
    });
    // The point this assessment is bound to, verified from CAS (coordinator item 2).
    expect(summary.localizationGeometry).toMatchObject({
      artifact_id: s.locationRef.artifact_id,
      bound_geometry_status: 'VERIFIED',
      geometry_type: 'POINT',
      coordinates_wgs84: [17.63, 59.85],
      coordinates_sweref99tm: [6640000, 648000],
      srid: 3006,
    });

    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.governedLayerChecks).toEqual(JSON.parse(JSON.stringify(summary.governedLayerChecks)));
    expect(res.body.evidenceDetails).toEqual(JSON.parse(JSON.stringify(summary.evidenceDetails)));
    expect(res.body.propertyRoot).toEqual(JSON.parse(JSON.stringify(summary.propertyRoot)));
    expect(res.body.overallStatement).toEqual(JSON.parse(JSON.stringify(summary.overallStatement)));
    expect(res.body.overall_summary).toEqual(JSON.parse(JSON.stringify(summary.overall_summary)));
    expect(res.body.localizationGeometry.coordinates_wgs84).toEqual([17.63, 59.85]);

    const pdf = await exportCurrentLuAssessmentPdf(s.deps());
    expect(pdf.ok).toBe(true);
    const data = capturedPdfData as PdfData;
    expect(data.lagerkontroller.map((c) => c.tillstand)).toEqual(summary.governedLayerChecks.map((c) => c.coverage_state));
    expect(data.lagerkontroller.map((c) => c.beskrivning)).toEqual(summary.governedLayerChecks.map((c) => c.message_sv));
    expect(data.evidensdetaljer.map((d) => d.evidens_artifact_id)).toEqual(summary.evidenceDetails.map((d) => d.evidence_artifact_id));
    expect(data.helhetsbedomning).toMatchObject({
      risk_level: 'HIGH', tackningsgrad: 'DETERMINED', kontroller_totalt: 6, kontroller_genomforda: 4, text: summary.overallStatement.statement_sv,
    });
    expect(data.lokalisering).toMatchObject({ koordinater_wgs84_lng_lat: [17.63, 59.85], koordinater_sweref99tm_n_e: [6640000, 648000], srid: 3006 });
  });

  it('evidence details carry dataset version, radius, subject, result, cap, time, binding strength and the ADMIT coverage limitation', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    const summary = await readBack(s);
    const byLayer = new Map(summary.evidenceDetails.map((d) => [d.layer, d] as const));

    const water = byLayer.get('water')!;
    expect(water).toMatchObject({
      artifact_type: 'SPATIAL_EVIDENCE', resolution: 'RESOLVED', integrity: 'CONTENT_HASH_VERIFIED', technical_error_class: null,
      provider: 'SGU', dataset_version_hash: REGISTRY_HASH.water, layer_version_label: 'v1.0', import_batch_id: null,
      retrieved_at: '2026-10-02T10:00:00.000Z',
      query: { relation: 'DWITHIN', subject_kind: 'LOCALIZATION_GEOMETRY', location_ref: s.locationRef, distance_meters: 500 },
      result: { semantics_kind: 'EXISTENCE_WITHIN_DISTANCE', exists: true, match_count_observed: 3, max_features_per_layer: 50, cap_reached: false },
      binding_assurance: 'HASH_BOUND_LEDGER_METADATA',
      coverage_limitation_sv: 'Saknas i underlaget',
    });
    // Finding -> Evidence: the water finding cites exactly this evidence.
    const waterFinding = fresh.executionMotor!.findings.find((f) => f.rule_id === 'LU-WATER-001')!;
    expect(water.cited_by_finding_ids).toEqual([waterFinding.finding_id]);
    expect(water.content_hash).toMatch(/^[0-9a-f]{64}$/);

    // Legacy-adopted source per the ADMIT v1 contract: the weakest binding class, said in words.
    const protectedArea = byLayer.get('protected_area')!;
    expect(protectedArea.binding_assurance).toBe('HASH_BOUND_LEGACY_ADOPTED');
    expect(protectedArea.binding_note_sv).toMatch(/legacy-adopterad leverans \(legacy-adopted-2026-07-20\)/);
    // U20CDF (owner directive): what the check was made against, as opposed to full coverage.
    expect(protectedArea.coverage_limitation_sv).toBe(
      'Skyddad natur: kontrollen avser endast inlästa naturreservat, inte fullständig täckning av skyddad natur; ' +
        'övriga skyddsformer ingår inte i underlaget.',
    );
    expect(protectedArea.known_coverage_gaps.map((g) => [g.gap_id, g.kind])).toEqual([['PROTECTED_AREA_NATURRESERVAT_ONLY', 'CONTRACT_SCOPE']]);
    // SI-2: a negative register result is "ingen registrerad träff", a register check -- nothing more.
    expect(byLayer.get('ebh')!.message_sv).toBe(
      'Ingen registrerad träff i Potentiellt förorenade områden (EBH) (Länsstyrelsen) inom 500 m (registerkontroll, inte markundersökning).',
    );
    // The cap: never read as an exact count.
    const natura = byLayer.get('natura2000')!;
    expect(natura.result?.cap_reached).toBe(true);
    expect(natura.message_sv).toContain('minst 50 objekt (taket på 50 träffar nåddes; fler kan finnas)');
    // U20CDF (U20CD verification F1; owner directive 2026-10-02): checked against the loaded SPA basis,
    // not full Natura coverage, AND that basis is known to be incomplete -- never read as "all SPA
    // areas". From the one register (knownCoverageGaps.ts): as text AND as machine-readable entries.
    const NATURA_LIMITATION =
      'Natura 2000: kontrollen avser endast inläst SPA-underlag (fågelskyddsområden), inte fullständig Natura 2000-täckning; ' +
      'särskilda bevarandeområden (SCI/SAC) ingår inte; underlaget är känt ofullständigt (103 av 558 SPA-områden saknas ' +
      'enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell).';
    expect(natura.coverage_limitation_sv).toBe(NATURA_LIMITATION);
    expect(natura.contract?.coverage_limitation_sv).toBe(NATURA_LIMITATION);
    const naturaCheck = summary.governedLayerChecks.find((c) => c.layer === 'natura2000')!;
    expect(naturaCheck.coverage_limitation_sv).toBe(NATURA_LIMITATION);
    const NATURA_GAPS = [
      { gap_id: 'NATURA2000_SPA_ONLY', kind: 'CONTRACT_SCOPE', as_of: '2026-08-08', rechecked_against_current_table: false },
      {
        gap_id: 'NATURA2000_SPA_103_OF_558_ABSENT', kind: 'KNOWN_INCOMPLETE_DATA', as_of: '2026-09-25',
        basis_sv: 'enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell', rechecked_against_current_table: false,
      },
    ];
    for (const gaps of [natura.known_coverage_gaps, naturaCheck.known_coverage_gaps]) {
      expect(gaps).toHaveLength(2);
      gaps.forEach((gap, i) => {
        expect(gap).toMatchObject({ ...NATURA_GAPS[i], layer_id: 'lu.natura2000', source_sha256: REGISTRY_HASH.natura2000 });
        expect(gap.sources.length).toBeGreaterThan(0);
      });
    }
    // Wells: the contracts state nothing -> no entry, never a completeness claim.
    expect(water.known_coverage_gaps).toEqual([]);
    // The same entries reach the HTTP read-back.
    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    const httpNatura = res.body.evidenceDetails.find((d: { layer: string }) => d.layer === 'natura2000');
    expect(httpNatura.known_coverage_gaps).toEqual(JSON.parse(JSON.stringify(natura.known_coverage_gaps)));
    expect(res.body.governedLayerChecks.find((c: { layer: string }) => c.layer === 'natura2000').known_coverage_gaps).toEqual(
      JSON.parse(JSON.stringify(naturaCheck.known_coverage_gaps)),
    );

    await exportCurrentLuAssessmentPdf(s.deps());
    const text = JSON.stringify(capturedPdfData);
    expect(text).toContain('Ingen registrerad träff i Potentiellt förorenade områden (EBH) (Länsstyrelsen) inom 500 m (registerkontroll, inte markundersökning).');
    expect(text).toContain(NATURA_LIMITATION);
    // No full-coverage claim in the governed PDF (the contract id "SPA_Rikstackande" is an identifier).
    expect(text).not.toMatch(/rikstäckande|alla SPA|samtliga SPA/i);
    expect(text).toContain(REGISTRY_HASH.water);
    const pdfWater = (capturedPdfData as PdfData).evidensdetaljer.find((d) => d.evidens_artifact_id === water.evidence_artifact_id)!;
    expect(pdfWater).toMatchObject({ importbatch: 'Saknas i underlaget', sokradie_m: 500, antal_traffar: 3, tak_natt: false, kalla: 'SGU' });
    const pdfNatura = (capturedPdfData as PdfData).evidensdetaljer.find((d) => d.evidens_artifact_id === natura.evidence_artifact_id)!;
    expect(pdfNatura.kanda_tackningsluckor).toEqual([
      expect.objectContaining({ id: 'NATURA2000_SPA_ONLY', typ: 'CONTRACT_SCOPE', datum: '2026-08-08', omkontrollerad_mot_nuvarande_tabell: false }),
      expect.objectContaining({
        id: 'NATURA2000_SPA_103_OF_558_ABSENT', typ: 'KNOWN_INCOMPLETE_DATA', datum: '2026-09-25',
        grund: 'enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell', omkontrollerad_mot_nuvarande_tabell: false,
      }),
    ]);
    const pdfNaturaRow = (capturedPdfData as PdfData).lagerkontroller.find((c) => c.lager === 'natura2000')!;
    expect(pdfNaturaRow.kanda_tackningsluckor).toEqual(pdfNatura.kanda_tackningsluckor);
    // SI-2: never a soil/risk-free claim anywhere in the governed PDF.
    expect(text).not.toMatch(/oförorenad|inga risker|inga avvikelser/i);
  });

  it('the property root is reported with its provenance and its honest, lower assurance', async () => {
    const s = await setup();
    await s.runFresh();
    const summary = await readBack(s);
    expect(summary.propertyRoot).toMatchObject({
      status: 'RESOLVED',
      property_context_artifact_id: s.propertyContextRef.artifact_id,
      property_designation: 'UPPSALA U20D 1:1',
      observation_artifact_id: s.observation.artifact_id,
      observation_contract_version: 'canonical-property-observation-v1',
      source_dataset: 'core.property_unit',
      source_key: 'u20d-source-key',
      source_updated_at: '2026-06-28T00:00:00.000Z',
      dataset_binding: null,
      assurance: 'UNBOUND_METADATA',
    });
    expect(summary.propertyRoot.message_sv).toMatch(/^Rotens datasetbindning saknas \(lägre säkerhet\)\./);

    await exportCurrentLuAssessmentPdf(s.deps());
    expect((capturedPdfData as PdfData).fastighetsrot).toMatchObject({
      status: 'RESOLVED', kalla: 'core.property_unit', datasetbindning: 'Saknas i underlaget', sakerhet: 'UNBOUND_METADATA',
    });
  });
});

describe('U20-D: failure is a class, never a silently missing field', () => {
  // W-U20CDF5-R2 (U20CDF5 verification M1-rest): verify answers a manipulated evidence like the read-back and the map
  // (424) and no longer replays it -- after a TRANSIENT fault H15 reads the content intact and could replay a record whose
  // break is visible only in that content. H15's DENY text is pinned in verifyCurrentLuAssessment.test.ts proof 3.
  it('a manipulated evidence fails the read-back, HTTP, PDF and verify closed (424), verify without a replay', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    const ebhId = fresh.executionMotor!.evidence_details!.find((d) => d.layer === 'ebh')!.evidence_artifact_id;
    const stored = s.repository.values.get(ebhId) as { payload: { result_semantics: { result: { exists: boolean } } } };
    stored.payload.result_semantics.result.exists = true; // flipped after the fact; content_hash unchanged

    const summary = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(summary).toMatchObject({ ok: false, status: 424, code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED', failureClass: 'EVIDENCE_TAMPERED' });
    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(424);
    expect(res.body).toMatchObject({ ok: false, code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED', failureClass: 'EVIDENCE_TAMPERED' });
    expect(await exportCurrentLuAssessmentPdf(s.deps())).toMatchObject({ ok: false, status: 424 });
    expect(capturedPdfData).toBeUndefined();

    const verified = await verifyCurrentLuAssessment(s.deps());
    expect(verified).toMatchObject({ ok: false, status: 424, code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED', failureClass: 'EVIDENCE_TAMPERED' });
    expect(verified).not.toHaveProperty('outcome');
  });

  it('an evidence missing from CAS is a technical error with a class; its layer is TECHNICAL_ERROR, never "no evidence"', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    const waterId = fresh.executionMotor!.evidence_details!.find((d) => d.layer === 'water')!.evidence_artifact_id;
    s.repository.values.delete(waterId);

    const summary = await readBack(s);
    expect(summary.evidenceDetails.find((d) => d.evidence_artifact_id === waterId)).toMatchObject({
      resolution: 'NOT_FOUND', technical_error_class: 'EVIDENCE_NOT_FOUND', binding_assurance: 'NONE',
    });
    expect(summary.governedLayerChecks.find((c) => c.layer === 'water')).toMatchObject({
      status: 'NOT_CHECKED', reason: 'PINNED_EVIDENCE_UNREADABLE', coverage_state: 'TECHNICAL_ERROR', evidence_artifact_id: waterId,
    });
    // U20CDF2 (G2): the record as a whole is an integrity/technical error, never a recount.
    expect(summary.overallStatement).toMatchObject({
      coverage_state: 'PINNED_EVIDENCE_UNREADABLE',
      coverage: null,
      pinned_evidence: { pinned_total: 5, unreadable_artifact_ids: [waterId], technical_error_class: 'EVIDENCE_NOT_FOUND', retryable: false },
    });
  });

  // U20CDF2 (U20CDF verification G2, probe H2 -- exact input): a fresh run reads "Hög risk …; 5 av 6";
  // after its spatial evidence is removed from CAS the read-back and the PDF read "0 av 6" while the
  // HIGH/MEDIUM findings are still stored. Owner: pinned evidence that cannot be read is an
  // integrity/technical error, not a new coverage computation; the known risk never disappears.
  it('G2: a current assessment whose pinned spatial evidence is gone from CAS -> PINNED_EVIDENCE_UNREADABLE (bestående, not retryable), findings named, never "0 av 6"', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    expect(fresh.complianceAnalysis.summary).toBe('Hög risk i de kontroller som utfördes; underlaget är ofullständigt: 5 av 6 kontroller genomförda.');
    const spatialIds = fresh.executionMotor!.evidence_details!.map((d) => d.evidence_artifact_id).sort();
    expect(spatialIds).toHaveLength(5);
    for (const id of spatialIds) s.repository.values.delete(id);
    const storedFindings = (s.repository.values.get(fresh.executionMotor!.assessment_artifact_id!) as LocalizationAssessmentArtifact).payload.findings;
    const EXPECTED_SV =
      'Den pinnade evidensen kan inte verifieras: 5 av 5 bundna evidensobjekt kunde inte läsas ur arkivet (hittades inte). ' +
      'Felet är bestående och löses inte av ett nytt försök. Täckningsgrad och samlad risknivå kan därför inte fastställas. ' +
      'Bedömningens lagrade fynd redovisas var för sig: risknivå hög – Natura 2000; risknivå måttlig – Brunnar.';

    const summary = await readBack(s);
    expect(summary.overallStatement).toEqual({
      risk_level: 'HIGH',
      coverage_state: 'PINNED_EVIDENCE_UNREADABLE',
      coverage_basis: spatialIds.map((id) => `PINNED_EVIDENCE_UNREADABLE:${id}`),
      coverage: null,
      pinned_evidence: { pinned_total: 5, unreadable_artifact_ids: spatialIds, technical_error_class: 'EVIDENCE_NOT_FOUND', retryable: false },
      statement_sv: EXPECTED_SV,
    });
    // Per layer: a technical error, never "no hit" and never "not checked"; the stored risk is named on its row.
    const rows = new Map(summary.governedLayerChecks.map((c) => [c.layer, c] as const));
    for (const layer of ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area']) {
      expect(rows.get(layer)).toMatchObject({ status: 'NOT_CHECKED', reason: 'PINNED_EVIDENCE_UNREADABLE', coverage_state: 'TECHNICAL_ERROR' });
      expect(rows.get(layer)!.message_sv).toMatch(/^Tekniskt fel: den pinnade evidensen för .* kunde inte läsas ur arkivet och kan inte verifieras\./);
    }
    expect(rows.get('natura2000')!.message_sv).toContain('Bedömningens lagrade fynd för lagret (risknivå hög) redovisas var för sig.');
    expect(rows.get('water')!.message_sv).toContain('Bedömningens lagrade fynd för lagret (risknivå måttlig) redovisas var för sig.');
    expect(rows.get('ebh')!.message_sv).toContain('Ingen slutsats om lagret.');
    expect(summary.findings).toEqual(storedFindings);
    expect(summary.overall_summary).toMatchObject({ risk_level: 'HIGH', coverage_state: 'PINNED_EVIDENCE_UNREADABLE', checks_completed: null, checks_total: null });

    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.overallStatement).toEqual(JSON.parse(JSON.stringify(summary.overallStatement)));

    await exportCurrentLuAssessmentPdf(s.deps());
    const data = capturedPdfData as PdfData;
    expect(data.helhetsbedomning).toEqual({
      risk_level: 'HIGH',
      tackningsgrad: 'PINNED_EVIDENCE_UNREADABLE',
      tackningsgrad_grund: summary.overallStatement.coverage_basis,
      kontroller_totalt: null,
      kontroller_genomforda: null,
      text: EXPECTED_SV,
      pinnad_evidens: {
        verifierbar: false, bundna_totalt: 5, olasbara_artifact_ids: spatialIds, tekniskt_fel: 'EVIDENCE_NOT_FOUND', nytt_forsok_kan_lyckas: false,
      },
    });
    expect(data.lagerkontroller.map((c) => c.tillstand)).toEqual([...Array(5).fill('TECHNICAL_ERROR'), 'NOT_CHECKED']);
    for (const text of [JSON.stringify(res.body.overallStatement), JSON.stringify(data.helhetsbedomning), JSON.stringify(data.lagerkontroller)]) {
      expect(text).not.toMatch(/\b\d+ av \d+ kontroller|Ingen samlad risknivå kan presenteras|ingen registrerad träff|låg risk/i);
    }
  });

  it('G2: a pinned evidence whose read fails (not missing) -> EVIDENCE_READ_ERROR, retryable', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    const ebhId = fresh.executionMotor!.evidence_details!.find((d) => d.layer === 'ebh')!.evidence_artifact_id;
    const realResolve = s.repository.resolve.bind(s.repository);
    s.repository.resolve = async <T,>(ref: ArtifactReference): Promise<T> => {
      if (ref.artifact_id === ebhId) throw new Error('EIO: i/o error, read');
      return (await realResolve(ref)) as T;
    };
    const summary = await readBack(s);
    expect(summary.overallStatement).toMatchObject({
      risk_level: 'HIGH',
      coverage_state: 'PINNED_EVIDENCE_UNREADABLE',
      coverage: null,
      pinned_evidence: { pinned_total: 5, unreadable_artifact_ids: [ebhId], technical_error_class: 'EVIDENCE_READ_ERROR', retryable: true },
    });
    expect(summary.overallStatement.statement_sv).toBe(
      'Den pinnade evidensen kan inte verifieras: 1 av 5 bundna evidensobjekt kunde inte läsas ur arkivet (läsfel). ' +
        'Ett nytt försök kan lyckas. Täckningsgrad och samlad risknivå kan därför inte fastställas. ' +
        'Bedömningens lagrade fynd redovisas var för sig: risknivå hög – Natura 2000; risknivå måttlig – Brunnar.',
    );
    expect(summary.governedLayerChecks.find((c) => c.layer === 'ebh')).toMatchObject({ reason: 'PINNED_EVIDENCE_UNREADABLE', coverage_state: 'TECHNICAL_ERROR' });
    expect(JSON.stringify(summary.overallStatement)).not.toContain('EIO');
  });

  it('a manipulated property-root observation fails the read-back closed (424 ROOT_PROVENANCE_TAMPERED)', async () => {
    const s = await setup();
    await s.runFresh();
    const stored = s.repository.values.get(s.observation.artifact_id) as { payload: { source_key: string } };
    stored.payload.source_key = 'some-other-property';
    expect(await resolveCurrentLuAssessmentSummary(s.deps())).toMatchObject({
      ok: false, status: 424, failureClass: 'ROOT_PROVENANCE_TAMPERED',
    });
  });

  // W-TEXT2 delta (F5): the user text of ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED names neither the bound point's
  // id nor the class -- on the result and on both HTTP routes; code, failureClass, reasonCode, status and retryable
  // are exactly as before. The internal-terms pattern is luServerTextsInternalTermsUI1's.
  const INTERNAL_TERMS = /\bCAS\b|\((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?::[^)]*)?\)|[A-Z]{3,}_[A-Z0-9_]{3,}/;
  type GeometryFailureClass = keyof typeof LOCALIZATION_GEOMETRY_UNVERIFIED_SV;
  function expectGeometryUnverifiedText(answer: unknown, failureClass: GeometryFailureClass, geometryId: string) {
    const error = (answer as { error?: unknown }).error;
    expect(typeof error).toBe('string');
    expect(error).not.toMatch(INTERNAL_TERMS);
    expect(error).not.toContain(geometryId);
    expect(error).toBe(LOCALIZATION_GEOMETRY_UNVERIFIED_SV[failureClass]);
  }
  async function expectGeometryUnverifiedHttp(status: 424 | 503, failureClass: GeometryFailureClass, geometryId: string) {
    for (const path of ['current-assessment', 'export-assessment-pdf']) {
      const res = await request(app()).get(`/api/localization/${PROJECT_ID}/${path}`).set('Authorization', `Bearer ${token()}`);
      expect(res.status, path).toBe(status);
      expectGeometryUnverifiedText(res.body, failureClass, geometryId);
      expect(res.body, path).toEqual({
        ok: false,
        error: LOCALIZATION_GEOMETRY_UNVERIFIED_SV[failureClass],
        code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED',
        failureClass,
        reasonCode: failureClass,
        retryable: status === 503,
      });
    }
  }

  it.each<[string, (repo: Map<string, unknown>, id: string) => void, GeometryFailureClass]>([
    ['manipulated', (values, id) => { (values.get(id) as { payload: { coordinates: number[] } }).payload.coordinates = [6640001, 648000]; }, 'LOCALIZATION_GEOMETRY_TAMPERED'],
    ['missing from CAS', (values, id) => { values.delete(id); }, 'LOCALIZATION_GEOMETRY_MISSING'],
  ])('a %s bound localization geometry fails the read-back and the PDF closed (424), never the current point instead', async (_label, damage, failureClass) => {
    const s = await setup();
    await s.runFresh();
    damage(s.repository.values, s.locationRef.artifact_id);
    const result = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(result).toMatchObject({
      ok: false, status: 424, code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED', failureClass, reasonCode: failureClass, retryable: false,
    });
    expectGeometryUnverifiedText(result, failureClass, s.locationRef.artifact_id);
    await expectGeometryUnverifiedHttp(424, failureClass, s.locationRef.artifact_id);
    const pdf = await exportCurrentLuAssessmentPdf(s.deps());
    expect(pdf).toMatchObject({ ok: false, status: 424 });
    expectGeometryUnverifiedText(pdf, failureClass, s.locationRef.artifact_id);
    expect(capturedPdfData).toBeUndefined();
  });

  // U20CDF (U20CD verification F10): the two remaining failure branches of the bound point.
  it('a bound localization geometry of ANOTHER project fails the read-back and the PDF closed (424 LOCALIZATION_GEOMETRY_NOT_BOUND)', async () => {
    const s = await setup();
    // A valid, self-consistent geometry artifact -- but issued for another project.
    const foreign = createLocalizationGeometryArtifact({
      project_id: 'another-project-u20cdf',
      property_context_ref: s.propertyContextRef,
      wgs84LngLat: [17.63, 59.85],
      sweref99NorthingEasting: [6640000, 648000],
      provenance: 'user_defined',
      label: 'U20CDF främmande punkt',
      created_by: AUTH_USER.id,
    });
    await s.repository.put({ artifact_id: foreign.artifact_id, body: foreign });
    state.geometry = foreign;
    const fresh = await s.runFresh();
    expect(fresh.executionMotor?.assessment_status).toBe('ASSESSED');

    const result = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(result).toMatchObject({
      ok: false, status: 424, code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED', failureClass: 'LOCALIZATION_GEOMETRY_NOT_BOUND',
      reasonCode: 'LOCALIZATION_GEOMETRY_NOT_BOUND', retryable: false,
    });
    expectGeometryUnverifiedText(result, 'LOCALIZATION_GEOMETRY_NOT_BOUND', foreign.artifact_id);
    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(424);
    expect(res.body).toMatchObject({ ok: false, failureClass: 'LOCALIZATION_GEOMETRY_NOT_BOUND' });
    await expectGeometryUnverifiedHttp(424, 'LOCALIZATION_GEOMETRY_NOT_BOUND', foreign.artifact_id);
    const pdf = await exportCurrentLuAssessmentPdf(s.deps());
    expect(pdf).toMatchObject({ ok: false, status: 424 });
    expectGeometryUnverifiedText(pdf, 'LOCALIZATION_GEOMETRY_NOT_BOUND', foreign.artifact_id);
    expect(capturedPdfData).toBeUndefined();
  });

  it('an unknown read failure of the bound localization geometry is a retryable technical error (503 LOCALIZATION_GEOMETRY_READ_ERROR), never the current point', async () => {
    const s = await setup();
    await s.runFresh();
    const realResolve = s.repository.resolve.bind(s.repository);
    s.repository.resolve = async <T,>(ref: ArtifactReference): Promise<T> => {
      if (ref.artifact_id === s.locationRef.artifact_id) throw new Error('EIO: i/o error, read');
      return (await realResolve(ref)) as T;
    };

    const result = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(result).toMatchObject({
      ok: false, status: 503, code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED', failureClass: 'LOCALIZATION_GEOMETRY_READ_ERROR',
      reasonCode: 'LOCALIZATION_GEOMETRY_READ_ERROR', retryable: true,
    });
    expectGeometryUnverifiedText(result, 'LOCALIZATION_GEOMETRY_READ_ERROR', s.locationRef.artifact_id);
    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, failureClass: 'LOCALIZATION_GEOMETRY_READ_ERROR' });
    expect(JSON.stringify(res.body)).not.toContain('EIO');
    await expectGeometryUnverifiedHttp(503, 'LOCALIZATION_GEOMETRY_READ_ERROR', s.locationRef.artifact_id);
    const pdf = await exportCurrentLuAssessmentPdf(s.deps());
    expect(pdf).toMatchObject({ ok: false, status: 503 });
    expectGeometryUnverifiedText(pdf, 'LOCALIZATION_GEOMETRY_READ_ERROR', s.locationRef.artifact_id);
    expect(capturedPdfData).toBeUndefined();
  });

  it('an older assessment without details gets honest text in the read-back and the PDF, not empty fields', async () => {
    const s = await setup({ legacyContext: true });
    await s.persistBareAssessment();
    const summary = await readBack(s);
    expect(summary.evidenceDetails).toEqual([]);
    expect(summary.propertyRoot).toMatchObject({ status: 'NOT_RECORDED', assurance: 'UNKNOWN', dataset_binding: null });
    expect(summary.propertyRoot.message_sv).toMatch(/^Rotens datasetbindning saknas \(lägre säkerhet\)\. Fastighetskontexten följer ett äldre kontrakt/);
    expect(summary.governedLayerChecks.map((c) => c.coverage_state)).toEqual(['NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED']);
    for (const check of summary.governedLayerChecks.slice(0, 5)) {
      expect(check.message_sv).toMatch(/^Inte kontrollerat: bedömningen innehåller ingen evidens för /);
    }
    // U20CDF2 (U20CDF verification G1; owner's locked specification): this older record says nothing
    // about any governed layer (no pinned evidence, no NOT_CHECKED finding), so its coverage cannot be
    // established -- it is never presented as "0 av 6" (which U20CDF did here, and the owner rejected).
    // No risk level is named (the machine value risk_level stays what governedVerdictFromFindings derives).
    expect(summary.overallStatement).toMatchObject({
      coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN',
      coverage: null,
      statement_sv: 'Täckningsgrad kan inte fastställas för denna historiska bedömning.',
    });
    expect(summary.overallStatement.coverage_basis).toEqual(
      ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'].map((layer) => `LAYER_NOT_RECORDED:${layer}`),
    );
    expect(summary.overallStatement.statement_sv).not.toMatch(/låg risk|\b0 av \d/i);
    expect(summary.overallStatement.risk_level).toBe('LOW');
    expect(summary.overall_summary).toMatchObject({
      coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN', checks_completed: null, checks_total: null, not_completed_layers: null,
    });
    expect(summary.overall_summary.statement_sv).toBe(summary.overallStatement.statement_sv);
    expect(summary.localizationGeometry).toMatchObject({
      artifact_id: null, bound_geometry_status: 'NOT_RECORDED', coordinates_wgs84: null, coordinates_sweref99tm: null, srid: null,
    });

    await exportCurrentLuAssessmentPdf(s.deps());
    const data = capturedPdfData as PdfData;
    expect(data.helhetsbedomning).toMatchObject({
      tackningsgrad: 'HISTORICAL_COVERAGE_UNKNOWN',
      kontroller_totalt: null,
      kontroller_genomforda: null,
      text: 'Täckningsgrad kan inte fastställas för denna historiska bedömning.',
    });
    expect(JSON.stringify(data.helhetsbedomning)).not.toMatch(/låg risk|\b0 av \d/i);
    expect(data.evidensdetaljer).toEqual([]);
    expect(data.fastighetsrot).toMatchObject({ status: 'NOT_RECORDED', kalla: 'Saknas i underlaget', nyckel: 'Saknas i underlaget' });
    expect(String((data.fastighetsrot as { beskrivning: string }).beskrivning)).toMatch(/Rotens datasetbindning saknas/);
    expect(data.lokalisering).toMatchObject({ koordinater_wgs84_lng_lat: 'Saknas i underlaget', srid: 'Saknas i underlaget' });
  });

  // U20CDF2 (U20CDF verification G1, probe H1 -- exact input): an older assessment without pinned
  // evidence and a stored HIGH ebh finding used to read "Ingen samlad risknivå kan presenteras – 0 av
  // 6 kontroller genomförda." in the read-back and the PDF, with ebh as NOT_CHECKED.
  it('G1: an older assessment with a stored HIGH finding -> HISTORICAL_COVERAGE_UNKNOWN, the finding in full, never "0 av 6"', async () => {
    const s = await setup({ legacyContext: true });
    const stored = {
      finding_id: 'finding-ebh-historical', rule_id: 'LU-EBH-001', rule_version: '2.0', risk_level: 'HIGH',
      explanation: 'Potentiellt förorenat område inom sökradie', evidence_refs: [],
    };
    await s.persistBareAssessment([stored]);
    const EXPECTED_SV =
      'Täckningsgrad kan inte fastställas för denna historiska bedömning. ' +
      'Bedömningens lagrade fynd redovisas var för sig: risknivå hög – Potentiellt förorenade områden (EBH).';

    const summary = await readBack(s);
    expect(summary.overallStatement).toEqual({
      risk_level: 'HIGH',
      coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN',
      coverage_basis: [
        'LAYER_NOT_RECORDED:water', 'FINDING_WITHOUT_CONSISTENT_EVIDENCE:ebh', 'LAYER_NOT_RECORDED:protected_area',
        'LAYER_NOT_RECORDED:natura2000', 'LAYER_NOT_RECORDED:water_protection_area',
      ],
      coverage: null,
      statement_sv: EXPECTED_SV,
    });
    // The stored finding is shown in full, and its layer counts as processed (never NOT_CHECKED).
    expect(summary.findings).toEqual([stored]);
    const ebh = summary.governedLayerChecks.find((c) => c.layer === 'ebh')!;
    expect(ebh).toMatchObject({ status: 'CHECKED_HIT', coverage_state: 'CHECKED_HIT', reason: 'FINDING_WITHOUT_CONSISTENT_EVIDENCE', evidence_artifact_id: null });
    expect(ebh.message_sv).toBe(
      'Träff enligt bedömningens lagrade fynd för Potentiellt förorenade områden (EBH) (risknivå hög). Bedömningen innehåller ' +
        'ingen konsistent evidens för lagret som belägger träffen (evidensen saknas, är negativ, kan inte tolkas eller står ' +
        'bredvid ett fynd om att lagret inte kunde kontrolleras).',
    );
    expect(summary.overall_summary).toMatchObject({ risk_level: 'HIGH', coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN', checks_completed: null, statement_sv: EXPECTED_SV });

    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.overallStatement).toEqual(JSON.parse(JSON.stringify(summary.overallStatement)));
    expect(res.body.findings).toEqual([stored]);

    await exportCurrentLuAssessmentPdf(s.deps());
    const data = capturedPdfData as PdfData;
    expect(data.helhetsbedomning).toEqual({
      risk_level: 'HIGH',
      tackningsgrad: 'HISTORICAL_COVERAGE_UNKNOWN',
      tackningsgrad_grund: summary.overallStatement.coverage_basis,
      kontroller_totalt: null,
      kontroller_genomforda: null,
      text: EXPECTED_SV,
    });
    expect((data as unknown as { findings: unknown[] }).findings).toEqual([
      { finding_id: stored.finding_id, rule_id: 'LU-EBH-001', rule_version: '2.0', risk_level: 'HIGH', explanation: stored.explanation },
    ]);
    for (const text of [JSON.stringify(res.body.overallStatement), JSON.stringify(data.helhetsbedomning)]) {
      expect(text).not.toMatch(/\b0 av \d|låg risk|Ingen samlad risknivå/i);
    }
  });
});

describe('U20-D: export and verify bound to an explicit assessment id', () => {
  it('matching id -> exported and named; a different id -> 409, never another assessment; malformed -> 400; no id -> unchanged', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    const currentId = fresh.executionMotor!.assessment_artifact_id!;
    const auth = { Authorization: `Bearer ${token()}` };

    const ok = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf?assessmentArtifactId=${currentId}`).set(auth);
    expect(ok.status).toBe(200);
    expect(ok.headers['x-assessment-artifact-id']).toBe(currentId);

    capturedPdfData = undefined;
    const otherId = `assessment-${'0'.repeat(64)}`;
    const mismatch = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf?assessmentArtifactId=${otherId}`).set(auth);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toMatchObject({ ok: false, code: 'ASSESSMENT_ID_MISMATCH', failureClass: 'ASSESSMENT_NOT_CURRENT' });
    expect(capturedPdfData).toBeUndefined();

    const verifyMismatch = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set(auth).send({ assessmentArtifactId: otherId });
    expect(verifyMismatch.status).toBe(409);
    expect(verifyMismatch.body.code).toBe('ASSESSMENT_ID_MISMATCH');

    const verifyOk = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set(auth).send({ assessmentArtifactId: currentId });
    expect(verifyOk.status).toBe(200);
    expect(verifyOk.body).toMatchObject({ ok: true, outcome: 'PASS', assessmentArtifactId: currentId });
    // U20CDF (U30-R2 follow-up): the machine notices travel with the answer.
    // U30-R6 / W-PLUMB-S (owner 2026-10-02): this fresh run is a legacy site-scoped bootstrap execution, accepted only in
    // the explicit test bootstrap -- its PASS carries the mandatory legacy-unbound notice, and only that, with the
    // strength LEGACY_UNBOUND_FORM (marking it FULLY_BOUND would be a false machine claim: the same execution is
    // EXECUTION_SUBJECT_UNBOUND in the product configuration).
    expect(verifyOk.body.notices).toEqual([
      expect.objectContaining({ code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY', basis: 'LEGACY_UNBOUND', authenticity_verified: false, current_authority_verified: false }),
    ]);
    expect(verifyOk.body.verification_binding).toBe('LEGACY_UNBOUND_FORM');
    expect(verifyOk.body.presentation).toBe('LEGACY_UNBOUND_NOTICE');
    // U20CDF2 (add-on 3; owner): consistency/replay wording -- never "verifierad/identisk/intakt". W-PLUMB-S: over a
    // legacy-unbound form the main text is exactly the owner's, never the green sentence (it names authenticity only as
    // NOT verified).
    expect(verifyOk.body.outcome_sv).toBe(OWNER_TEXT_SV);
    expect(verifyOk.body.outcome_sv).not.toContain(GREEN_MARKER_SV);
    expect(verifyOk.body.outcome_sv).not.toMatch(/identisk|intakt|har verifierats/i);
    expect(classifyVerifyPresentation(verifyOk.body)).toBe('LEGACY_UNBOUND_NOTICE');

    const malformed = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf?assessmentArtifactId=${encodeURIComponent('a b;c')}`).set(auth);
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_ASSESSMENT_ARTIFACT_ID');

    const legacy = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`).set(auth);
    expect(legacy.status).toBe(200);
    expect(legacy.headers['x-assessment-artifact-id']).toBe(currentId);
  });
});

describe('U20CDF (U30-R2 verification follow-up): a stored NOT_CHECKED cause text never reaches the user', () => {
  const NEUTRAL = (layer: string) =>
    `Lagret "${layer}" kunde inte kontrolleras: källan kunde inte frågas vid bedömningen. Ej kontrollerbart - underlag saknas.`;

  it('an older assessment whose NOT_CHECKED finding embeds SQL/provider text: read-back, HTTP and PDF show only the neutral text', async () => {
    const s = await setup({ legacyContext: true });
    const RAW = 'Lagret "protected_area" kunde inte kontrolleras (error: relation "env.protected_area" does not exist; SQLSTATE 42P01 at 10.0.0.5:5432). Ej kontrollerbart - underlag saknas.';
    const stored = {
      finding_id: 'finding-notchecked-protected_area', rule_id: 'LU-PROTECTED-001', rule_version: '2.0',
      risk_level: 'NOT_CHECKED', explanation: RAW, evidence_refs: [],
    };
    const assessment = await s.persistBareAssessment([stored]);
    // The stored artifact keeps its bytes (and so its identity and replay): only the presentation changes.
    expect((s.repository.values.get(assessment.artifact_id) as { payload: { findings: Array<{ explanation: string }> } }).payload.findings[0]!.explanation).toBe(RAW);

    const summary = await readBack(s);
    expect(summary.findings).toEqual([{ ...stored, explanation: NEUTRAL('protected_area') }]);

    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.findings[0]).toMatchObject({ finding_id: stored.finding_id, risk_level: 'NOT_CHECKED', explanation: NEUTRAL('protected_area') });

    await exportCurrentLuAssessmentPdf(s.deps());
    const pdfFindings = (capturedPdfData as { findings: Array<Record<string, unknown>> }).findings;
    expect(pdfFindings[0]).toMatchObject({ finding_id: stored.finding_id, risk_level: 'NOT_CHECKED', explanation: NEUTRAL('protected_area') });
    for (const text of [JSON.stringify(res.body), JSON.stringify(capturedPdfData)]) {
      for (const fragment of ['does not exist', 'SQLSTATE', '42P01', '10.0.0.5']) expect(text).not.toContain(fragment);
    }
  });

  it('the neutral text is exactly what the real rule engine writes today (fresh run with an unavailable layer)', async () => {
    const s = await setup({ unavailable: ['water_protection_area'] });
    const fresh = await s.runFresh();
    const notChecked = fresh.executionMotor!.findings.find((f) => f.finding_id === 'finding-notchecked-water_protection_area')!;
    expect(notChecked.explanation).toBe(NEUTRAL('water_protection_area'));
    const summary = await readBack(s);
    expect(summary.findings.find((f) => f.finding_id === notChecked.finding_id)).toEqual(notChecked);
  });
});

describe('U20CDF (U30-R2 follow-up): verify carries the re-execution notices and says them honestly', () => {
  it('PASS with NOT_CHECKED_CAUSE_NOT_PINNED -> notices in the answer, and "identiskt" only with the unsaved cause stated', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    const currentId = fresh.executionMotor!.assessment_artifact_id!;
    const notice = {
      code: 'NOT_CHECKED_CAUSE_NOT_PINNED',
      finding_ids: ['finding-notchecked-protected_area'],
      detail: 'reproduced from the attested execution; the stored cause text was never pinned',
    };
    // W-PLUMB-S: the wrapped result is a FULLY BOUND PASS with the NOT_CHECKED notice (as a genuine V4 gives it, the
    // package's 19b) -- this fixture's own run is legacy-unbound, and a LEGACY_UNBOUND_FORM strength without its
    // mandatory notice is never verified (asserted in the matrix below).
    state.reExecute = async (real, args) => ({ ...((await real(args)) as object), verification_binding: 'FULLY_BOUND', notices: [notice] });

    const direct = await verifyCurrentLuAssessment(s.deps());
    expect(direct).toMatchObject({ ok: true, outcome: 'PASS', notices: [notice], verification_binding: 'FULLY_BOUND', presentation: 'FULLY_BOUND_GREEN' });
    const res = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', `Bearer ${token()}`).send({ assessmentArtifactId: currentId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, outcome: 'PASS', mismatches: [], notices: [notice], verification_binding: 'FULLY_BOUND', presentation: 'FULLY_BOUND_GREEN' });
    expect(res.body.outcome_sv).toBe(
      `${GREEN_HEAD_SV}, men orsaken till att lagret inte kontrollerades sparades inte (Skyddad natur). ${RESERVATION_SV}`,
    );
    // W-T1TEXT: apart from the negated reservation, nothing claims manipulation, forgery, identity, integrity or authenticity.
    expect(res.body.outcome_sv.split(RESERVATION_SV).join('')).not.toMatch(/manipul|förfalsk|identisk|intakt|äkt/i);

    // Two layers -> plural, both named.
    state.reExecute = async (real, args) => ({
      ...((await real(args)) as object),
      verification_binding: 'FULLY_BOUND',
      notices: [{ ...notice, finding_ids: ['finding-notchecked-natura2000', 'finding-notchecked-water'] }],
    });
    const two = await verifyCurrentLuAssessment(s.deps());
    expect((two as { outcome_sv: string }).outcome_sv).toBe(
      `${GREEN_HEAD_SV}, men orsaken till att lagren inte kontrollerades sparades inte (Natura 2000, Brunnar). ${RESERVATION_SV}`,
    );

    // W-PLUMB-S: the same NOT_CHECKED notice on this fixture's own (legacy-unbound) PASS, after its mandatory notice:
    // the owner's text is the main text, the NOT_CHECKED notice travels in `notices` -- never the green sentence.
    state.reExecute = async (real, args) => {
      const r = (await real(args)) as { notices: unknown[] };
      return { ...r, notices: [...r.notices, notice] };
    };
    const legacy = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', `Bearer ${token()}`).send({ assessmentArtifactId: currentId });
    expect(legacy.status).toBe(200);
    expect(legacy.body).toMatchObject({ outcome: 'PASS', verification_binding: 'LEGACY_UNBOUND_FORM', presentation: 'LEGACY_UNBOUND_NOTICE', outcome_sv: OWNER_TEXT_SV });
    expect(legacy.body.notices.map((n: { code: string }) => n.code)).toEqual(['LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY', 'NOT_CHECKED_CAUSE_NOT_PINNED']);
  });
});

/**
 * W-PLUMB-S (owner decision 2026-10-02, BINDING; U30R6-REPORT K2-K4, K21): the verify answer's presentation is decided in
 * the SERVER by classifyVerifyPresentation (the package root) -- one source, fail-closed -- and the route's JSON
 * classifies exactly as the package's result does. Through the REAL orchestrator and route; only the re-execution's
 * result is replaced (state.reExecute), so every form of result can be presented.
 */
describe('W-PLUMB-S: the verify answer is never green unless the result is a well-formed FULLY_BOUND PASS', () => {
  const NEUTRAL_SV =
    'Reproducerbarheten kan inte visas som verifierad: kontrollens svar är ofullständigt eller motsägelsefullt (utfall, ' +
    'bindningsstyrka eller obligatorisk notis saknas eller stämmer inte överens). Det är inget fynd om att underlaget har ändrats.';
  const DENY_SV = 'Reproducerbarheten kunde inte bekräftas: återexekveringen gav inte samma resultat som den sparade bedömningen.';
  const UNBOUND_SV =
    'Reproducerbarheten kan inte bekräftas: körningen bakom bedömningen saknar ett styrt exekveringssubjekt (äldre eller ' +
    'obunden körningsform) och kan inte bindas till bedömningen. Resultatet påstår inte att underlaget har ändrats.';
  const GREEN_SV = `${GREEN_HEAD_SV}. ${RESERVATION_SV}`;
  const legacyNotice = (overrides: Record<string, unknown> = {}) => ({
    code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY', basis: 'V1_FORM', authenticity_verified: false, current_authority_verified: false,
    text_sv: OWNER_TEXT_SV, finding_ids: [], detail: 'the pinned execution outcome is a V1-format outcome', ...overrides,
  });
  const notCheckedNotice = { code: 'NOT_CHECKED_CAUSE_NOT_PINNED', finding_ids: ['finding-notchecked-ebh'], detail: 'x' };
  const pass = (overrides: Record<string, unknown>) => ({ outcome: 'PASS', mismatches: [], notices: [], fresh_findings: [], fresh_rule_refs: [], ...overrides });
  const deny = (mismatches: unknown[], overrides: Record<string, unknown> = {}) => ({ outcome: 'DENY', verification_binding: null, mismatches, notices: [], fresh_findings: [], fresh_rule_refs: [], ...overrides });

  type Expected = { presentation: string; binding: string | null; outcome_sv: string };
  const cases: Array<[string, () => Record<string, unknown>, Expected]> = [
    ['a fully bound PASS', () => pass({ verification_binding: 'FULLY_BOUND' }), { presentation: 'FULLY_BOUND_GREEN', binding: 'FULLY_BOUND', outcome_sv: GREEN_SV }],
    ['a fully bound PASS with NOT_CHECKED', () => pass({ verification_binding: 'FULLY_BOUND', notices: [notCheckedNotice] }),
      { presentation: 'FULLY_BOUND_GREEN', binding: 'FULLY_BOUND', outcome_sv: `${GREEN_HEAD_SV}, men orsaken till att lagret inte kontrollerades sparades inte (Potentiellt förorenade områden (EBH)). ${RESERVATION_SV}` }],
    ['a V1-form PASS with its notice', () => pass({ verification_binding: 'LEGACY_UNBOUND_FORM', notices: [legacyNotice()] }),
      { presentation: 'LEGACY_UNBOUND_NOTICE', binding: 'LEGACY_UNBOUND_FORM', outcome_sv: OWNER_TEXT_SV }],
    ['a legacy-unbound PASS with its notice and NOT_CHECKED', () => pass({ verification_binding: 'LEGACY_UNBOUND_FORM', notices: [legacyNotice({ basis: 'LEGACY_UNBOUND' }), notCheckedNotice] }),
      { presentation: 'LEGACY_UNBOUND_NOTICE', binding: 'LEGACY_UNBOUND_FORM', outcome_sv: OWNER_TEXT_SV }],
    ['a PASS with a null strength (strictNullChecks off)', () => pass({ verification_binding: null }), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: NEUTRAL_SV }],
    ['a PASS without a strength (the answer before U30-R6)', () => pass({}), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: NEUTRAL_SV }],
    ['a PASS with an unknown strength', () => pass({ verification_binding: 'FULLY_BOUND ' }), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: NEUTRAL_SV }],
    ['FULLY_BOUND WITH the legacy notice', () => pass({ verification_binding: 'FULLY_BOUND', notices: [legacyNotice()] }), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: NEUTRAL_SV }],
    ['LEGACY_UNBOUND_FORM WITHOUT the notice', () => pass({ verification_binding: 'LEGACY_UNBOUND_FORM' }), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: NEUTRAL_SV }],
    ['the notice with the green sentence as its text', () => pass({ verification_binding: 'LEGACY_UNBOUND_FORM', notices: [legacyNotice({ text_sv: GREEN_SV })] }), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: NEUTRAL_SV }],
    ['FULLY_BOUND with an unknown notice', () => pass({ verification_binding: 'FULLY_BOUND', notices: [{ code: 'SOMETHING_NEW' }] }), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: NEUTRAL_SV }],
    ['a strength only inherited (in process)', () => Object.assign(Object.create({ verification_binding: 'FULLY_BOUND' }), pass({})), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: NEUTRAL_SV }],
    ['a DENY (findings)', () => deny([{ code: 'FINDINGS_MISMATCH', detail: 'x' }]), { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: DENY_SV }],
    ['a DENY that claims FULLY_BOUND (the `!== LEGACY_UNBOUND_FORM` consumer)', () => deny([{ code: 'FINDINGS_MISMATCH', detail: 'x' }], { verification_binding: 'FULLY_BOUND' }),
      { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: DENY_SV }],
    ['a DENY EXECUTION_SUBJECT_UNBOUND (its own text)', () => deny([{ code: 'EXECUTION_SUBJECT_UNBOUND', detail: 'execution subject binding: x', text_sv: UNBOUND_SV }]),
      { presentation: 'NOT_VERIFIED', binding: null, outcome_sv: UNBOUND_SV }],
  ];

  it.each(cases)('%s', async (_label, make, expected) => {
    const s = await setup();
    const fresh = await s.runFresh();
    const currentId = fresh.executionMotor!.assessment_artifact_id!;
    const seen: { produced?: Record<string, unknown> } = {};
    state.reExecute = async () => {
      const produced = make();
      produced.assessment_artifact_id = currentId;
      seen.produced = produced;
      return produced;
    };

    const direct = (await verifyCurrentLuAssessment(s.deps())) as Record<string, unknown>;
    const packageClass = classifyVerifyPresentation(seen.produced);
    expect(packageClass).toBe(expected.presentation);
    expect(direct).toMatchObject({ ok: true, presentation: expected.presentation, verification_binding: expected.binding, outcome_sv: expected.outcome_sv });
    expect(classifyVerifyPresentation(JSON.parse(JSON.stringify(direct)))).toBe(expected.presentation);

    const res = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', `Bearer ${token()}`).send({ assessmentArtifactId: currentId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, assessmentArtifactId: currentId, presentation: expected.presentation, verification_binding: expected.binding, outcome_sv: expected.outcome_sv });
    // The route's JSON classifies exactly as the package's result.
    expect(classifyVerifyPresentation(res.body)).toBe(packageClass);
    if (expected.presentation !== 'FULLY_BOUND_GREEN') expect(res.body.outcome_sv).not.toContain(GREEN_MARKER_SV);
    if (expected.presentation === 'FULLY_BOUND_GREEN') expect(res.body.outcome_sv.endsWith(RESERVATION_SV)).toBe(true);
    // The existing machine fields are kept.
    expect(res.body.outcome).toBe(seen.produced!.outcome);
    expect(Array.isArray(res.body.mismatches) && Array.isArray(res.body.notices)).toBe(true);
  });
});

describe('U20-D: computeGovernedLayerChecks decides the contradictory cases (M2b findings 8 and 9)', () => {
  const ev = (semantics: Record<string, unknown>) => ({
    artifact_id: 'evidence-water-x',
    payload: { source_metadata: { dataset: 'water' }, result_semantics: semantics as { result: unknown } },
  });
  it.each<[string, Record<string, unknown>]>([
    ['an unadmitted result semantics kind', { kind: 'FEATURE_GEOMETRY', result: { exists: true, match_count_observed: 1 } }],
    ['exists:false with a positive count', { kind: 'EXISTENCE_WITHIN_DISTANCE', result: { exists: false, match_count_observed: 3 } }],
    ['exists:true with a zero count', { kind: 'EXISTENCE_WITHIN_DISTANCE', result: { exists: true, match_count_observed: 0 } }],
  // U20CDF4 (owner decision 2026-10-03 (4) point 2): each of these DECLARES the result contract
  // (result_semantics present) and breaks it -- an integrity error (EVIDENCE_VIOLATES_RESULT_CONTRACT),
  // still NOT_CHECKED, never a hit or a no-hit.
  ])('%s -> NOT_CHECKED / EVIDENCE_VIOLATES_RESULT_CONTRACT, never a hit or a no-hit', (_label, semantics) => {
    expect(computeGovernedLayerChecks({ requestedLayers: ['water'], evidence: [ev(semantics)], unavailableLayers: [], findings: [] })).toEqual([
      { layer: 'water', rule_id: 'LU-WATER-001', status: 'NOT_CHECKED', evidence_artifact_id: 'evidence-water-x', reason: 'EVIDENCE_VIOLATES_RESULT_CONTRACT' },
    ]);
  });

  it('an evidence from before the result contract (no result_semantics) -> NOT_CHECKED / UNRECOGNIZED_RESULT, never a hit or a no-hit', () => {
    const older = { artifact_id: 'evidence-water-x', payload: { source_metadata: { dataset: 'water' } } };
    expect(computeGovernedLayerChecks({ requestedLayers: ['water'], evidence: [older as never], unavailableLayers: [], findings: [] })).toEqual([
      { layer: 'water', rule_id: 'LU-WATER-001', status: 'NOT_CHECKED', evidence_artifact_id: 'evidence-water-x', reason: 'UNRECOGNIZED_RESULT' },
    ]);
  });
});

describe('U20CDF2 (G3): an evidence outside the common normal form fails the fresh run closed before the rule engine', () => {
  // U20CDF3 (U20CDF2 verification H6 / low 6): the rejection is reported as what it is -- its own
  // machine code plus the violation, and a Swedish text -- never as "ExecutionKernel error" /
  // EXECUTION_KERNEL_ERROR: the kernel is never reached.
  it.each<[string, Parameters<typeof setup>[0], string, string]>([
    ['exists:true with match count 0 (verifier probe F1)', { evidenceResult: { water: { exists: true, match_count_observed: 0, max_features_per_layer: 50 } } },
      'MATCH_COUNT_CONTRADICTS_EXISTS', 'antalet träffar motsäger träffuppgiften för lagret Brunnar'],
    ['exists:false with a positive match count', { evidenceResult: { ebh: { exists: false, match_count_observed: 4, max_features_per_layer: 50 } } },
      'MATCH_COUNT_CONTRADICTS_EXISTS', 'antalet träffar motsäger träffuppgiften för lagret Potentiellt förorenade områden (EBH)'],
    ['exists not a boolean', { evidenceResult: { protected_area: { exists: 'true', match_count_observed: 1, max_features_per_layer: 50 } } },
      'EXISTS_NOT_BOOLEAN', 'träffuppgiften är inte ett sant/falskt-värde för lagret Skyddad natur'],
    ['evidence and an unavailable entry for the same layer', { alsoUnavailable: ['natura2000'] },
      'EVIDENCE_AND_UNAVAILABLE', 'samma lager redovisas både med evidens och som otillgängligt för lagret Natura 2000'],
  ])('%s -> EXECUTION_FAILED with REJECT_SPATIAL_EVIDENCE_FORM, no assessment, no verdict', async (_label, options, violation, what) => {
    const s = await setup(options);
    const fresh = await s.runFresh();
    expect(fresh.executionMotor).toMatchObject({ admitted: false, assessment_status: 'EXECUTION_FAILED', assessment_artifact_id: null, findings: [] });
    expect(fresh.executionMotor?.reason_codes).toEqual(['REJECT_SPATIAL_EVIDENCE_FORM', violation]);
    expect(fresh.warnings).toEqual([
      `Spatialt underlag avvisat: ${what} (REJECT_SPATIAL_EVIDENCE_FORM: ${violation}). Ingen bedömning gjordes; regelmotorn nåddes aldrig.`,
    ]);
    expect(JSON.stringify(fresh)).not.toMatch(/EXECUTION_KERNEL_ERROR|ExecutionKernel error/);
    const verdict = fresh.complianceAnalysis as { overallRisk?: unknown; permitProbability?: unknown };
    expect(verdict.overallRisk ?? null).toBeNull();
    expect(verdict.permitProbability ?? null).toBeNull();
    // The rule engine was never reached: nothing was assessed or persisted as an assessment.
    const stored = [...s.repository.values.values()] as Array<{ artifact_type?: string }>;
    expect(stored.some((artifact) => artifact.artifact_type === 'LOCALIZATION_ASSESSMENT')).toBe(false);
  });

  it('the same provider outcome in the normal form is assessed as before (control)', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    expect(fresh.executionMotor?.assessment_status).toBe('ASSESSED');
    expect(fresh.warnings).toEqual([]);
  });
});

describe('U20CDF2 (coordinator add-on 1; OD-R2): a storage fault during re-execution is a technical 503, never a 500 or a verdict', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['a transient read error (EIO)', Object.assign(new Error('EIO: i/o error, read C:/cas/ab/cd'), { code: 'EIO' }), true],
    ['a stored object gone from CAS (MIMERS_ARTIFACT_OBJECT_MISSING)', Object.assign(new Error('object missing'), { code: 'MIMERS_ARTIFACT_OBJECT_MISSING' }), false],
    ['a torn index entry (MIMERS_ARTIFACT_INDEX_READ_FAILED / MALFORMED)', Object.assign(new Error('torn'), { code: 'MIMERS_ARTIFACT_INDEX_READ_FAILED', reason: 'MALFORMED' }), false],
    ['corrupt bytes (CASIntegrityError)', Object.assign(new Error('digest mismatch'), { name: 'CASIntegrityError' }), false],
  ];
  it.each(cases)('%s -> 503 LU_REEXECUTION_STORAGE_FAULT, retryable as the fault is', async (_label, cause, retryable) => {
    const s = await setup();
    const fresh = await s.runFresh();
    const currentId = fresh.executionMotor!.assessment_artifact_id!;
    state.reExecute = async () => {
      throw new LuReExecutionStorageError('pinned_evidence', { artifact_id: 'evidence-water-x', artifact_type: 'SPATIAL_EVIDENCE' }, 'resolve', { cause });
    };
    const res = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', `Bearer ${token()}`).send({ assessmentArtifactId: currentId });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      code: 'LU_REEXECUTION_STORAGE_FAULT',
      failureClass: 'REEXECUTION_STORAGE_FAULT',
      reasonCode: 'PINNED_EVIDENCE',
      retryable,
      // W-T1TEXT (T1-WORDING-AUDIT top 6): a reproducibility check, not a "verification"; the code is unchanged.
      error:
        'Reproducerbarhetskontrollen kunde inte genomföras: ett tekniskt lagringsfel uppstod vid återexekveringen (steg: pinned_evidence). ' +
        'Det är inget kontrollutfall. ' +
        (retryable ? 'Ett nytt försök kan lyckas.' : 'Felet är bestående och löses inte av ett nytt försök.'),
    });
    expect(res.body.error).not.toMatch(/Verifieringen|verifieringsutfall/);
    expect(JSON.stringify(res.body)).not.toMatch(/EIO|C:\/cas|digest mismatch|torn|evidence-water-x/);
  });
});

describe('U20CDF2 (coordinator add-on 2; OD-R2): an assessment that cannot be READ is a technical 503, never "no assessment" (404)', () => {
  /** The projection's own read of the assessment succeeds; the identity resolution's re-read fails. */
  function failSecondAssessmentRead(s: Awaited<ReturnType<typeof setup>>, assessmentId: string, fault: unknown) {
    const realResolve = s.repository.resolve.bind(s.repository);
    let reads = 0;
    s.repository.resolve = async <T,>(ref: ArtifactReference): Promise<T> => {
      if (ref.artifact_id === assessmentId) {
        reads += 1;
        if (reads % 2 === 0) throw fault;
      }
      return (await realResolve(ref)) as T;
    };
  }

  it.each<[string, unknown, string, boolean, string]>([
    [
      'a read error (EIO)', Object.assign(new Error('EIO: i/o error, read C:/cas/x'), { code: 'EIO' }),
      'ASSESSMENT_READ_ERROR', true,
      'Bedömningen kunde inte läsas ur arkivet (tekniskt fel). Den saknas inte, men kan inte visas nu. Ett nytt försök kan lyckas.',
    ],
    [
      'a lasting storage fault (object missing behind its index entry)', Object.assign(new Error('gone'), { code: 'MIMERS_ARTIFACT_OBJECT_MISSING' }),
      'ASSESSMENT_STORAGE_INTEGRITY_FAULT', false,
      'Bedömningen kunde inte läsas ur arkivet (bestående lagringsfel). Felet är bestående och löses inte av ett nytt försök.',
    ],
  ])('%s -> 503 %s in read-back, HTTP, PDF and verify', async (_label, fault, failureClass, retryable, error) => {
    const s = await setup();
    const fresh = await s.runFresh();
    const assessmentId = fresh.executionMotor!.assessment_artifact_id!;
    failSecondAssessmentRead(s, assessmentId, fault);
    const expected = { ok: false, status: 503, code: 'ASSESSMENT_READ_ERROR', failureClass, reasonCode: failureClass, retryable, error };
    expect(await resolveCurrentLuAssessmentSummary(s.deps())).toEqual(expected);
    expect(await exportCurrentLuAssessmentPdf(s.deps())).toEqual(expected);
    expect(capturedPdfData).toBeUndefined();
    expect(await verifyCurrentLuAssessment(s.deps())).toEqual(expected);
    const res = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, code: 'ASSESSMENT_READ_ERROR', failureClass, reasonCode: failureClass, retryable, error });
    expect(JSON.stringify(res.body)).not.toMatch(/EIO|C:\/cas|gone/);
  });

  // W-GAP1 (F1; owner decision Round 15-16, 2026-10-03): REVOKED expectation. It read "a genuine absence (the repository
  // says 'Artifact not found') keeps the existing contract: 404". The assessment was selected by the projection one read
  // earlier, so its exact "Artifact not found: <id>" at the second read is a LOST referenced artifact -- the same lasting
  // integrity fault the selection itself answers for the same event -- never absence; 404 stays only for the selection's
  // own REJECT_ASSESSMENT_PROJECTION_NOT_FOUND / _NOT_CURRENT (the tests above).
  it('W-GAP1 F1: the selected assessment\'s exact "Artifact not found" at its second read -> 503 ASSESSMENT_STORAGE_INTEGRITY_FAULT / CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT, not retryable; never 404 (it was 404)', async () => {
    const s = await setup();
    const fresh = await s.runFresh();
    const assessmentId = fresh.executionMotor!.assessment_artifact_id!;
    failSecondAssessmentRead(s, assessmentId, new Error(`Artifact not found: ${assessmentId}`));
    const result = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(result).toMatchObject({
      ok: false, status: 503, code: 'ASSESSMENT_READ_ERROR', failureClass: 'ASSESSMENT_STORAGE_INTEGRITY_FAULT', reasonCode: 'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT', retryable: false,
    });
    expect((result as { error: string }).error).not.toMatch(/No current governed|Artifact not found/);
    expect(JSON.stringify(result)).not.toContain(assessmentId);
  });

  it('the projection index cannot be read -> 503 ASSESSMENT_RESOLUTION_ERROR, not "no assessment"', async () => {
    const s = await setup();
    await s.runFresh();
    const deps = { ...s.deps(), assessmentProjectionIndex: { register: async () => undefined, listForProject: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); } } };
    const result = await resolveCurrentLuAssessmentSummary(deps as never);
    expect(result).toEqual({
      ok: false, status: 503, code: 'ASSESSMENT_READ_ERROR', failureClass: 'ASSESSMENT_RESOLUTION_ERROR', reasonCode: 'ASSESSMENT_RESOLUTION_ERROR', retryable: true,
      error: 'Den aktuella bedömningen kunde inte fastställas på grund av ett tekniskt fel. Ett nytt försök kan lyckas.',
    });
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });
});

// Type-only use, keeps the import honest for readers of this file.
export type _AssessmentForReaders = LocalizationAssessmentArtifact;
