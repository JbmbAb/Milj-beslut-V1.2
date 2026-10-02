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

async function setup(options: { readonly unavailable?: readonly string[]; readonly legacyContext?: boolean } = {}) {
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
          await repository.put({ artifact_id: ev.artifact_id, body: ev });
          evidence.push(ev);
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

  /** For the "older assessment" case: a governed assessment with no pinned evidence at all. */
  async function persistBareAssessment() {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `u20d-${Math.random()}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-u20d-${Math.random()}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-u20d', artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
    };
    const assessment = createGovernedLocalizationAssessment({
      draft: { site_id: 'site-u20d-old', project_context_ref: projectContextRef, property_ref: propertyContextRef, evidence_refs: [], system_summary: 'older assessment' },
      findings: [], outcome, attestation: security.attestOutcome(outcome.content_hash),
    });
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

beforeEach(() => {
  capturedPdfData = undefined;
  hermeticPrismaTouches.length = 0;
  process.env.MPS_LU_BOOTSTRAP_ADMIT = '1';
});

afterEach(() => {
  delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
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
      coverage: { checks_total: 6, checks_completed: 4, checks_not_completed: 2, not_completed_layers: ['water_protection_area', 'document'] },
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
    expect(data.helhetsbedomning).toMatchObject({ risk_level: 'HIGH', kontroller_totalt: 6, kontroller_genomforda: 4, text: summary.overallStatement.statement_sv });
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
  it('a manipulated evidence fails the read-back, HTTP and PDF closed (424); verify still reaches H15 and DENYs', async () => {
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
    expect(verified).toMatchObject({ ok: true, outcome: 'DENY' });
    expect((verified as unknown as { mismatches: Array<{ code: string }> }).mismatches.map((m) => m.code)).toContain('TAMPERED_EVIDENCE');
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
      status: 'NOT_CHECKED', reason: 'PINNED_EVIDENCE_UNREADABLE', coverage_state: 'TECHNICAL_ERROR',
    });
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

  it.each<[string, (repo: Map<string, unknown>, id: string) => void, string]>([
    ['manipulated', (values, id) => { (values.get(id) as { payload: { coordinates: number[] } }).payload.coordinates = [6640001, 648000]; }, 'LOCALIZATION_GEOMETRY_TAMPERED'],
    ['missing from CAS', (values, id) => { values.delete(id); }, 'LOCALIZATION_GEOMETRY_MISSING'],
  ])('a %s bound localization geometry fails the read-back and the PDF closed (424), never the current point instead', async (_label, damage, failureClass) => {
    const s = await setup();
    await s.runFresh();
    damage(s.repository.values, s.locationRef.artifact_id);
    expect(await resolveCurrentLuAssessmentSummary(s.deps())).toMatchObject({
      ok: false, status: 424, code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED', failureClass,
    });
    expect(await exportCurrentLuAssessmentPdf(s.deps())).toMatchObject({ ok: false, status: 424 });
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
    // U20CDF (U20CD verification F2): with no completed check the text names no risk level at all
    // (the machine value risk_level stays what governedVerdictFromFindings derives).
    expect(summary.overallStatement.statement_sv).toBe('Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.');
    expect(summary.overallStatement.statement_sv).not.toMatch(/låg risk/i);
    expect(summary.overallStatement.risk_level).toBe('LOW');
    expect(summary.overall_summary.statement_sv).toBe(summary.overallStatement.statement_sv);
    expect(summary.localizationGeometry).toMatchObject({
      artifact_id: null, bound_geometry_status: 'NOT_RECORDED', coordinates_wgs84: null, coordinates_sweref99tm: null, srid: null,
    });

    await exportCurrentLuAssessmentPdf(s.deps());
    const data = capturedPdfData as PdfData;
    expect(data.helhetsbedomning).toMatchObject({
      kontroller_genomforda: 0,
      text: 'Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.',
    });
    expect(JSON.stringify(data.helhetsbedomning)).not.toMatch(/låg risk/i);
    expect(data.evidensdetaljer).toEqual([]);
    expect(data.fastighetsrot).toMatchObject({ status: 'NOT_RECORDED', kalla: 'Saknas i underlaget', nyckel: 'Saknas i underlaget' });
    expect(String((data.fastighetsrot as { beskrivning: string }).beskrivning)).toMatch(/Rotens datasetbindning saknas/);
    expect(data.lokalisering).toMatchObject({ koordinater_wgs84_lng_lat: 'Saknas i underlaget', srid: 'Saknas i underlaget' });
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

    const malformed = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf?assessmentArtifactId=${encodeURIComponent('a b;c')}`).set(auth);
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_ASSESSMENT_ARTIFACT_ID');

    const legacy = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`).set(auth);
    expect(legacy.status).toBe(200);
    expect(legacy.headers['x-assessment-artifact-id']).toBe(currentId);
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
  ])('%s -> NOT_CHECKED / UNRECOGNIZED_RESULT, never a hit or a no-hit', (_label, semantics) => {
    expect(computeGovernedLayerChecks({ requestedLayers: ['water'], evidence: [ev(semantics)], unavailableLayers: [], findings: [] })).toEqual([
      { layer: 'water', rule_id: 'LU-WATER-001', status: 'NOT_CHECKED', evidence_artifact_id: 'evidence-water-x', reason: 'UNRECOGNIZED_RESULT' },
    ]);
  });
});

// Type-only use, keeps the import honest for readers of this file.
export type _AssessmentForReaders = LocalizationAssessmentArtifact;
