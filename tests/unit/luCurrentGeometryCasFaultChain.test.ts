/**
 * W-M1aClose: OD-R1 + OD-R2/ADV-1 through the WHOLE chain, on a REAL FileCAS.
 *
 * Owner requirement (2026-10-02): M1a stays CORRECTION_REQUIRED until OD-R1 (an unverifiable current
 * point never lets an older point win) and OD-R2 (CAS/index faults are technical errors, never
 * "missing") hold through the whole chain. This file builds a project whose localization point moved
 * A -> B (a real signed supersession edge) and which has a persisted governed assessment for EACH
 * point, all stored through the production storage stack in a fresh temp directory:
 *
 *   FileCASRepository (temp dir) -> MimersByteStorageBackend -> CasBackedArtifactRepository
 *     -> LocalizationGeometryCurrentProvider -> D9(a) classifier
 *     -> HTTP: POST generate-report (real GenerateLocalizationReportUseCase),
 *              GET current-assessment, GET export-assessment-pdf, POST verify-assessment
 *              (real orchestrator, real ProjectContextBindingProvider, real assessment projection)
 *
 * Then it damages ONLY the current point B on disk, in each of the four ways the store can fail, and
 * re-reads through a COLD storage stack (a new FileCASRepository, so no in-process cache can hide
 * the damage):
 *
 *   B's CAS object missing (index entry intact)  -> MIMERS_ARTIFACT_OBJECT_MISSING -> 503 CURRENTNESS_STORAGE_INTEGRITY_FAULT (M1a-F1: not retryable)
 *   B's index entry missing                       -> "Artifact not found" -> OD-R1  -> 409 CURRENT_GEOMETRY_UNVERIFIED
 *   B's index entry unreadable (a directory)      -> MIMERS_ARTIFACT_INDEX_READ_FAILED (IO) -> 503 CURRENTNESS_RESOLUTION_ERROR (retryable)
 *   B's index entry torn (half-written)           -> MIMERS_ARTIFACT_INDEX_READ_FAILED (MALFORMED) -> 503 CURRENTNESS_STORAGE_INTEGRITY_FAULT
 *   B's CAS bytes corrupted                       -> CASIntegrityError -> OD-R1        -> 409 CURRENT_GEOMETRY_UNVERIFIED
 *
 * M1a-F1 adds, on the same real store: damage to the SUPERSEDED point A is skipped consistently (B
 * stays current, also when A's object is gone); the double fault "edge B -> C unverifiable AND C's
 * projection row lost" fails closed (never B); and the accepted KNOWN_LIMITATION (B's row AND the
 * A -> B edge row both lost) is pinned with its label, not as approved behaviour.
 *
 * and asserts that every endpoint fails closed with that class, that the report run never reaches the
 * spatial query or the kernel, that no PDF is rendered, and that the old point-A assessment is never
 * presented as current. A control run on the intact store shows the same wiring resolves B and serves
 * B's assessment, so every fail-closed answer below comes from the damaged point, not from the harness.
 *
 * Replaced (hermetic): server/db/prisma (guard that throws and records), the four Prisma projection
 * repositories (in-memory, same contract), external data services, the kernel call, the PDF renderer,
 * auth persistence. Never a real CAS root: the root is mkdtemp() under the OS temp directory.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kernelMock = vi.fn();
const queryMock = vi.fn();
const pdfMock = vi.fn(async () => Buffer.from('%PDF-chain-test'));

const state = vi.hoisted(() => ({
  repo: null as unknown,
  canonicalContext: null as unknown,
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  supersessionRows: [] as Array<{ projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date }>,
  assessmentRows: [] as Array<Record<string, unknown>>,
  assessmentListCalls: 0,
  bindingRows: [] as Array<{ projectId: string; bindingArtifactId: string; contextId: string; contextType: string }>,
  bindingSupersessions: [] as Array<{ projectId: string; artifactId: string }>,
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: { artifact_id: string; artifact_type: string } }) {
      if (state.geometryRows.some((r) => r.projectId === row.projectId && r.geometryArtifactId === row.geometryArtifactId)) return;
      state.geometryRows.push({
        projectId: row.projectId, geometryArtifactId: row.geometryArtifactId,
        propertyContextRefId: row.propertyContextRef.artifact_id, propertyContextRefType: row.propertyContextRef.artifact_type,
        createdAt: new Date(),
      });
    }
    async listForProject(projectId: string) {
      return state.geometryRows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => ({
  PrismaLocalizationGeometrySupersessionIndex: class {
    async register() {}
    async listForProject(projectId: string) {
      return state.supersessionRows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  },
}));
vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => ({
  PrismaProjectAssessmentProjectionIndex: class {
    async register(row: {
      projectId: string; assessmentArtifactId: string; assessmentArtifactType: string;
      projectContextRef: { artifact_id: string; artifact_type: string }; bindingArtifactId: string; releaseArtifactId: string;
      localizationGeometryArtifactId?: string | null;
    }) {
      if (state.assessmentRows.some((r) => r.projectId === row.projectId && r.assessmentArtifactId === row.assessmentArtifactId)) return;
      state.assessmentRows.push({
        projectId: row.projectId, assessmentArtifactId: row.assessmentArtifactId, assessmentArtifactType: row.assessmentArtifactType,
        projectContextRefId: row.projectContextRef.artifact_id, projectContextRefType: row.projectContextRef.artifact_type,
        bindingArtifactId: row.bindingArtifactId, releaseArtifactId: row.releaseArtifactId,
        localizationGeometryArtifactId: row.localizationGeometryArtifactId ?? null,
        createdAt: new Date(Date.now() + state.assessmentRows.length),
      });
    }
    async listForProject(projectId: string) {
      state.assessmentListCalls += 1;
      return state.assessmentRows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  },
}));
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    async register(binding: { artifact_id: string; payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } } }) {
      if (!state.bindingRows.some((r) => r.bindingArtifactId === binding.artifact_id)) {
        state.bindingRows.push({
          projectId: binding.payload.project_id, bindingArtifactId: binding.artifact_id,
          contextId: binding.payload.project_context_ref.artifact_id, contextType: binding.payload.project_context_ref.artifact_type,
        });
      }
    }
    async registerSupersession(supersession: { artifact_id: string; payload: { project_id: string } }) {
      state.bindingSupersessions.push({ projectId: supersession.payload.project_id, artifactId: supersession.artifact_id });
    }
    async resolve(projectId: string, ref: { artifact_id: string; artifact_type: string }) {
      const rows = state.bindingRows.filter((r) => r.projectId === projectId && r.contextId === ref.artifact_id && r.contextType === ref.artifact_type);
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return rows[0]!.bindingArtifactId;
    }
    async listBindingRefs(projectId: string) {
      return state.bindingRows.filter((r) => r.projectId === projectId).map((r) => ({ artifact_id: r.bindingArtifactId, artifact_type: 'project_context_binding' }));
    }
    async listSupersessionRefs(projectId: string) {
      return state.bindingSupersessions.filter((r) => r.projectId === projectId).map((r) => ({ artifact_id: r.artifactId, artifact_type: 'project_context_binding_supersession' }));
    }
    async findProjectContextRef(projectId: string) {
      const rows = state.bindingRows.filter((r) => r.projectId === projectId);
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return { artifact_id: rows[0]!.contextId, artifact_type: rows[0]!.contextType };
    }
  },
}));
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: vi.fn(async () => undefined) }));
vi.mock('../../server/modules/localization/createLocalizationSpatialRuntime', () => ({
  createLocalizationSpatialRuntime: vi.fn(async () => ({
    artifactRepository: state.repo,
    resolveSpatialProvider: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
    sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const),
    wgs84ToSweref99: vi.fn(async () => [6580943.04, 674571.86] as const),
    close: vi.fn(async () => undefined),
  })),
}));
vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MimersIntegration: { create: vi.fn(async () => ({ artifactRepository: state.repo })) },
}));
vi.mock('@miljobeslut/mps-lu', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LU_SPATIAL_CAPABILITY_KEY: 'lu.spatial',
  runLuAssessmentViaKernel: (...args: unknown[]) => kernelMock(...args),
  runCanonicalLuProductAssessment: (...args: unknown[]) => kernelMock(...args),
  deriveLuExecutionSeed: vi.fn(() => 'canonical-seed'),
  createLuRegistryRuntime: vi.fn(() => ({ getReleaseSnapshot: () => ({ snapshot_id: 'lu-registry-snapshot-test' }) })),
}));
vi.mock('../../server/modules/localization/assessmentProjection', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The report run's own projection write is not part of this proof (the kernel is mocked).
  registerAssessmentProjection: vi.fn(async () => undefined),
}));
vi.mock('../../server/services/complianceRuleEngine', () => ({
  evaluateComplianceRules: vi.fn(() => ({ overallRisk: 'LOW', permitProbability: 0.9, restrictions: [], rules: [], summary: 'legacy', requiredActions: [], notes: [] })),
}));
vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: vi.fn(async () => ({
    protectedAreaHits: [], protectedAreaAvailable: true, isProtected: false,
    sgu: { manualReviewRequired: false, summary: 'ok' }, distanceToWaterMeters: 50, distanceToWaterAvailable: true,
  })),
}));
vi.mock('../../server/services/nvrService', () => ({ fetchProtectedAreas: vi.fn(async () => []) }));
vi.mock('../../server/services/raaService', () => ({ fetchAncientMonuments: vi.fn(async () => []) }));
vi.mock('../../server/services/vissService', () => ({ queryVissPoint: vi.fn(async () => null) }));
vi.mock('../../server/services/sguRiskService', () => ({ toGeologicalData: vi.fn(() => ({})) }));
vi.mock('../../server/services/sluService', () => ({ searchSluByCoordinates: vi.fn(async () => []), getSpeciesInformation: vi.fn(async () => null) }));
vi.mock('../../server/services/auditTrailService', () => ({ auditTrail: { logAction: vi.fn(async () => undefined) } }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/application/enqueue-lu-execution-ticket', () => ({ enqueueAdmittedLuTicket: vi.fn(async () => 'ticket-1') }));
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: vi.fn(async () => state.canonicalContext),
}));
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({
  resolveCanonicalProductRelease: vi.fn(async () => ({
    artifact_id: 'product-release-chain', artifact_type: 'product_release_manifest', release_hash: { value: 'a'.repeat(64) },
  })),
}));
vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: (...args: unknown[]) => pdfMock(...(args as [])),
}));

import { FileCASRepository, LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
  createGovernedLocalizationAssessment,
  createLocalizationGeometryArtifactV2,
  createLocalizationGeometrySupersessionArtifact,
  createLocalizationGeometrySupersessionIssuerArtifact,
  createProductLuProjectContextArtifact,
  createProductLuPropertyContextArtifact,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import {
  attestLocalizationGeometrySupersessionArtifact,
  attestLocalizationGeometrySupersessionIssuerArtifact,
} from '../../server/modules/localization/localizationGeometrySupersessionAuthority';
import { installOwnerIssuedProjectContextBinding } from '../../server/modules/localization/installProjectContextBinding';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import { attestProjectContextBindingSupersessionIssuerArtifact } from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import { createTokenPair } from '../../server/security/auth';
import {
  LocalizationGeometryCurrentnessError,
  resolveLocalizationGeometryCurrentness,
} from '../../server/modules/localization/localizationGeometryCurrentness';
import localizationRoutes from '../../server/routes/localization.routes';

const PROJECT_ID = 'project-cas-fault-chain';
const USER = { id: 'user-cas-fault-chain', organisationId: 'org-cas-fault-chain', bankidId: 'bankid:cas-fault-chain', role: 'ADMIN' as const };
const RELEASE_REF = { artifact_id: 'product-release-chain', artifact_type: 'product_release' } as const;
const SITE = { id: 'site-a', name: 'Alternativ A', lat: 59.33, lng: 18.07 };

const geometryKey = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-issuer-cas-fault-chain');
const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-cas-fault-chain');
const pcbSupersessionKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-cas-fault-chain');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);

interface Fixture {
  readonly casDir: string;
  readonly indexDir: string;
  readonly a: LocalizationGeometryArtifact;
  readonly b: LocalizationGeometryArtifact;
  readonly assessmentA: string;
  readonly assessmentB: string;
  /** M1a-F1: the A -> B edge, and a way to move the point once more (B -> C) on the same store. */
  readonly edgeAB: string;
  readonly moveTo: (from: LocalizationGeometryArtifact, northing: number, issuedAt: string) => Promise<{ readonly point: LocalizationGeometryArtifact; readonly edgeId: string }>;
}

let root: string;

/** A COLD production storage stack on the temp CAS: new FileCASRepository, so no in-process cache. */
function coldRepository(casDir: string, indexDir: string): CasBackedArtifactRepository {
  return new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(casDir, { durabilityMode: 'none' }), indexDir));
}

async function put<T extends { readonly artifact_id: string }>(repo: CasBackedArtifactRepository, artifact: T) {
  const own = (artifact as { readonly content_hash?: unknown }).content_hash;
  await repo.put({
    artifact_id: artifact.artifact_id,
    content_hash: (own as never) ?? sha256ContentHash(artifact),
    body: artifact,
  });
}

async function buildFixture(): Promise<Fixture> {
  const casDir = path.join(root, 'cas');
  const indexDir = path.join(casDir, 'artifact-id-index');
  const cas = new FileCASRepository(casDir, { durabilityMode: 'none' });
  await cas.initialize();
  const repo = new CasBackedArtifactRepository(new MimersByteStorageBackend(cas, indexDir));

  // Governed project context + binding (the real authority chain the read-back verifies).
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = pcbIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = pcbIssuerKey.publicKey;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = pcbSupersessionKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = pcbSupersessionKey.publicKey;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
  await put(repo, pcbIssuer);
  const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
  const bareSupersessionIssuer = createProjectContextBindingSupersessionIssuerArtifact({ issuer_key_id: pcbSupersessionKey.provider.keyId, owner_authority_ref: pcbAuthority });
  await put(repo, {
    ...bareSupersessionIssuer,
    attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: bareSupersessionIssuer, signing: pcbSupersessionKey.provider }),
  });

  const propertyBinding = { artifact_id: 'project-property-binding-cas-fault-chain', artifact_type: 'project_property_binding' } as const;
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: 'property-identity-cas-fault-chain', property_ref: 'GÄVLE KEDJA 1:1', official_name: 'Gävle Kedja 1:1',
    geometry_ref: { artifact_id: 'geometry-cas-fault-chain', artifact_type: 'CANONICAL_GEOMETRY' },
    municipality: 'Gävle', coordinates: [60.67, 17.14], project_property_binding_ref: propertyBinding,
  });
  await put(repo, propertyContext);
  const propertyContextRef = { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type } as const;
  const projectContext = createProductLuProjectContextArtifact({
    project_id: PROJECT_ID, project_name: 'CAS fault chain project', description: 'W-M1aClose chain test',
    created_by: USER.id, property_context_ref: propertyContextRef, project_property_binding_ref: propertyBinding,
  });
  await put(repo, projectContext);
  const projectContextRef = { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type } as const;
  const bareBinding = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: projectContextRef, project_property_binding_ref: propertyBinding,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-10-02T00:00:00.000Z',
  });
  const binding = { ...bareBinding, attestation: await attestProjectContextBindingArtifact({ artifact: bareBinding, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repo, index: new PrismaProjectContextBindingIndex(), binding, verification: pcbVerification });
  const bindingRef = { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type } as const;

  state.canonicalContext = {
    projectContextRef, propertyContextRef,
    geometryRef: { artifact_id: 'geometry-cas-fault-chain', artifact_type: 'CANONICAL_GEOMETRY' },
    contextBindingRef: bindingRef, propertyIdentity: 'property-identity-cas-fault-chain',
    coordinates: [6580743.04, 674571.86], geometry: { type: 'Point', coordinates: [674571.86, 6580743.04] },
  };

  // The moved point: A (superseded) -> B (current), a real signed edge, both projected.
  const point = (northing: number) => createLocalizationGeometryArtifactV2({
    project_id: PROJECT_ID, property_context_ref: propertyContextRef,
    wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, northing],
    provenance: 'user_defined', label: `chain point ${northing}`, created_by: USER.id,
  });
  const a = point(6580743.0);
  const b = point(6580843.0);
  const project = async (g: LocalizationGeometryArtifact) => {
    await put(repo, g);
    state.geometryRows.push({
      projectId: PROJECT_ID, geometryArtifactId: g.artifact_id,
      propertyContextRefId: propertyContextRef.artifact_id, propertyContextRefType: propertyContextRef.artifact_type, createdAt: new Date(),
    });
  };
  for (const g of [a, b]) await project(g);
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: geometryKey.provider.keyId,
    owner_authority_ref: { artifact_id: 'owner-authority-cas-fault-chain', artifact_type: 'owner_authority_attestation' },
  });
  const issuer = { ...bareIssuer, attestation: await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing: geometryKey.provider }) };
  await put(repo, issuer);
  const supersede = async (from: LocalizationGeometryArtifact, to: LocalizationGeometryArtifact, issuedAt: string) => {
    const bareEdge = createLocalizationGeometrySupersessionArtifact({
      contract_version: LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION, project_id: PROJECT_ID,
      predecessor_geometry_ref: { artifact_id: from.artifact_id, artifact_type: from.artifact_type },
      successor_geometry_ref: { artifact_id: to.artifact_id, artifact_type: to.artifact_type },
      reason_code: 'USER_LOCALIZATION_CHANGE_V1',
      issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
      issuer_key_id: geometryKey.provider.keyId, issued_at: issuedAt,
    });
    const edge = { ...bareEdge, attestation: await attestLocalizationGeometrySupersessionArtifact({ artifact: bareEdge, issuer, signing: geometryKey.provider }) };
    await put(repo, edge);
    state.supersessionRows.push({
      projectId: PROJECT_ID, supersessionArtifactId: edge.artifact_id,
      predecessorGeometryArtifactId: from.artifact_id, successorGeometryArtifactId: to.artifact_id, createdAt: new Date(),
    });
    return edge.artifact_id;
  };
  const edgeAB = await supersede(a, b, '2026-10-02T00:00:00.000Z');
  // What the supersession worker writes for one more move: object -> geometry row -> edge row.
  const moveTo = async (from: LocalizationGeometryArtifact, northing: number, issuedAt: string) => {
    const next = point(northing);
    await project(next);
    return { point: next, edgeId: await supersede(from, next, issuedAt) };
  };
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = geometryKey.provider.keyId;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = geometryKey.publicKey;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);

  // A persisted governed assessment for EACH point (the A one is the stale one that must never be
  // presented as current), registered through the real projection writer.
  const { registerAssessmentProjection } = await vi.importActual<typeof import('../../server/modules/localization/assessmentProjection')>(
    '../../server/modules/localization/assessmentProjection',
  );
  const persistAssessment = async (g: LocalizationGeometryArtifact, label: string) => {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `cas-fault-chain-${label}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-cas-fault-chain-${label}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: `attempt-cas-fault-chain-${label}`, artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', label }),
    };
    const assessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-a', project_context_ref: projectContextRef, property_ref: propertyContextRef, evidence_refs: [],
        system_summary: `assessment for point ${label}`,
        localization_geometry_ref: { artifact_id: g.artifact_id, artifact_type: g.artifact_type },
      },
      findings: [], outcome, attestation: security.attestOutcome(outcome.content_hash),
    });
    await repo.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    await registerAssessmentProjection({
      projectId: PROJECT_ID, assessment, contextBindingRef: bindingRef, releaseRef: RELEASE_REF, localizationGeometryArtifactId: g.artifact_id,
    });
    return assessment.artifact_id;
  };
  const assessmentA = await persistAssessment(a, 'A');
  const assessmentB = await persistAssessment(b, 'B');
  return { casDir, indexDir, a, b, assessmentA, assessmentB, edgeAB, moveTo };
}

function indexEntryPath(f: Fixture, artifactId: string): string {
  return path.join(f.indexDir, `${createHash('sha256').update(artifactId).digest('hex')}.idx`);
}

function objectPath(f: Fixture, artifactId: string): string {
  const { hash } = JSON.parse(readFileSync(indexEntryPath(f, artifactId), 'utf8')) as { hash: string };
  return new FileCASRepository(f.casDir).getFilePath(hash);
}

/** Damage ONE stored artifact on disk (by default the current point B). */
const SABOTAGE = {
  'object missing (index entry intact)': (f: Fixture, id = f.b.artifact_id) => unlinkSync(objectPath(f, id)),
  'index entry missing': (f: Fixture, id = f.b.artifact_id) => unlinkSync(indexEntryPath(f, id)),
  'index entry unreadable (EISDIR)': (f: Fixture, id = f.b.artifact_id) => {
    const entry = indexEntryPath(f, id);
    unlinkSync(entry);
    mkdirSync(entry);
  },
  // M1a-F1: a half-written (torn) entry is a persistent integrity fault, not a transient read error.
  'index entry torn (half-written)': (f: Fixture, id = f.b.artifact_id) => writeFileSync(indexEntryPath(f, id), '{"artifact_id":"'),
  'bytes corrupted': (f: Fixture, id = f.b.artifact_id) => writeFileSync(objectPath(f, id), Buffer.from('{"artifact_id":"not-what-the-hash-says"}')),
} as const;

type Expectation = { readonly status: number; readonly failureClass: string; readonly retryable: boolean; readonly assessmentStatus: string };
const TECHNICAL: Expectation = { status: 503, failureClass: 'CURRENTNESS_RESOLUTION_ERROR', retryable: true, assessmentStatus: 'EXECUTION_FAILED' };
// M1a-F1 (1): a stored object that is gone, or a torn index entry, does not heal on a retry.
const STORAGE: Expectation = { status: 503, failureClass: 'CURRENTNESS_STORAGE_INTEGRITY_FAULT', retryable: false, assessmentStatus: 'EXECUTION_FAILED' };
const UNVERIFIED: Expectation = { status: 409, failureClass: 'CURRENT_GEOMETRY_UNVERIFIED', retryable: false, assessmentStatus: 'GOVERNANCE_DENIED' };

const CASES: ReadonlyArray<[keyof typeof SABOTAGE, Expectation, string]> = [
  ['object missing (index entry intact)', STORAGE, 'MIMERS_ARTIFACT_OBJECT_MISSING'],
  ['index entry missing', UNVERIFIED, 'MISSING_FROM_CAS'],
  ['index entry unreadable (EISDIR)', TECHNICAL, 'MIMERS_ARTIFACT_INDEX_READ_FAILED'],
  ['index entry torn (half-written)', STORAGE, 'MALFORMED'],
  ['bytes corrupted', UNVERIFIED, 'CORRUPTED_IN_CAS'],
];

function app() {
  const server = express();
  server.use(express.json());
  server.use(localizationRoutes);
  return server;
}

function bearer(): string {
  return `Bearer ${createTokenPair({ id: USER.id, organisationId: USER.organisationId, bankidId: USER.bankidId, role: USER.role }).accessToken}`;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wm1ac-cas-fault-chain-'));
  state.repo = null;
  state.canonicalContext = null;
  state.geometryRows.length = 0;
  state.supersessionRows.length = 0;
  state.assessmentRows.length = 0;
  state.assessmentListCalls = 0;
  state.bindingRows.length = 0;
  state.bindingSupersessions.length = 0;
  kernelMock.mockReset().mockResolvedValue({
    admitted: true, reason_codes: [], attempt_id: 'a1', outcome_id: 'o1', manifest_id: 'm1',
    findings: [], finding_ids: [], assessment: { artifact_id: 'assessment-from-mocked-kernel' },
  });
  queryMock.mockReset().mockResolvedValue({ evidence: [], unavailable_layers: [] });
  pdfMock.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('control: the intact store resolves B through every endpoint (proves the harness, not the damage, decides below)', () => {
  it('generate-report runs on B; current-assessment and the PDF serve B\'s assessment, never A\'s; verify gets past currentness', async () => {
    const f = await buildFixture();
    state.repo = coldRepository(f.casDir, f.indexDir);
    const auth = bearer();

    const current = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', auth);
    expect(current.status).toBe(200);
    expect(current.body.assessmentArtifactId).toBe(f.assessmentB);
    expect(current.body.localizationGeometry).toMatchObject({ artifact_id: f.b.artifact_id, bound_geometry_status: 'VERIFIED' });

    const pdf = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`).set('Authorization', auth);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['x-assessment-artifact-id']).toBe(f.assessmentB);
    expect(pdfMock).toHaveBeenCalledTimes(1);

    const verify = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', auth).send({});
    expect(verify.body.code).not.toBe('LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED');
    if (verify.status === 200) expect(verify.body.assessmentArtifactId).toBe(f.assessmentB);

    const report = await request(app()).post('/api/localization/generate-report').set('Authorization', auth).send({ projectId: PROJECT_ID, siteAlternatives: [SITE] });
    expect(report.status).toBe(200);
    expect(kernelMock).toHaveBeenCalledTimes(1);
    expect(report.body.siteAnalyses[0].executionMotor.localization_geometry).toMatchObject({ status: 'RESOLVED', artifact_id: f.b.artifact_id });
  });
});

describe('damage to the CURRENT point B on disk fails every endpoint closed with the right class; A never becomes current', () => {
  it.each(CASES)('B %s -> %j through generate-report, current-assessment, PDF and verify', async (sabotage, expected, technicalMarker) => {
    const f = await buildFixture();
    SABOTAGE[sabotage](f);
    state.repo = coldRepository(f.casDir, f.indexDir); // a cold process: nothing cached
    const auth = bearer();
    const failure = {
      ok: false, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: expected.failureClass, reasonCode: `LOCALIZATION_GEOMETRY_${expected.failureClass}`, retryable: expected.retryable,
    };

    // generate-report: stops before the spatial query and the kernel, reports the class, never point A.
    const report = await request(app()).post('/api/localization/generate-report').set('Authorization', auth).send({ projectId: PROJECT_ID, siteAlternatives: [SITE] });
    expect(report.status).toBe(200);
    const motor = report.body.siteAnalyses[0].executionMotor;
    expect(motor.localization_geometry?.artifact_id ?? null, 'generate-report ran on the SUPERSEDED point A').not.toBe(f.a.artifact_id);
    expect(kernelMock, 'the kernel ran although the current point is unverifiable').not.toHaveBeenCalled();
    expect(motor).toMatchObject({
      admitted: false, assessment_artifact_id: null, assessment_status: expected.assessmentStatus,
      // M1a-F1 (1): the generate-report record carries the same retryable flag as the other endpoints.
      localization_geometry: { status: 'FAILED_CLOSED', artifact_id: null, failure_class: expected.failureClass, retryable: expected.retryable },
    });
    expect(queryMock).not.toHaveBeenCalled();
    expect(kernelMock).not.toHaveBeenCalled();

    // current-assessment: the class on the wire; neither B's nor (the stale) A's assessment.
    const current = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', auth);
    expect(current.body.assessmentArtifactId, 'current-assessment presented the STALE point-A assessment as current').not.toBe(f.assessmentA);
    expect(current.status).toBe(expected.status);
    expect(current.body).toMatchObject(failure);
    expect(current.body.error).toMatch(/Ingen bedömning görs/);
    expect(current.body.assessmentArtifactId).toBeUndefined();
    expect(JSON.stringify(current.body)).not.toContain(f.assessmentA);

    // PDF: the class, no PDF rendered.
    const pdf = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`).set('Authorization', auth);
    expect(pdf.headers['x-assessment-artifact-id'], 'the PDF exported the STALE point-A assessment').not.toBe(f.assessmentA);
    expect(pdf.status).toBe(expected.status);
    expect(pdf.body).toMatchObject(failure);
    expect(pdfMock).not.toHaveBeenCalled();

    // verify: the class, nothing verified in place of the current assessment.
    const verify = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', auth).send({});
    expect(verify.body.assessmentArtifactId, 'verify verified the STALE point-A assessment').not.toBe(f.assessmentA);
    expect(verify.status).toBe(expected.status);
    expect(verify.body).toMatchObject(failure);
    expect(verify.body.assessmentArtifactId).toBeUndefined();

    // None of the read paths consulted the assessment index: currentness failed first.
    expect(state.assessmentListCalls).toBe(0);

    // The cause survives server-side (log detail), naming the storage layer that failed and point B.
    const typed = await resolveLocalizationGeometryCurrentness({ projectId: PROJECT_ID, artifactRepository: state.repo as never }).then(
      (resolution) => resolution,
      (error: unknown) => error,
    );
    expect(typed).toBeInstanceOf(LocalizationGeometryCurrentnessError);
    expect((typed as LocalizationGeometryCurrentnessError).failureClass).toBe(expected.failureClass);
    expect((typed as LocalizationGeometryCurrentnessError).technicalDetail).toContain(technicalMarker);
    expect((typed as LocalizationGeometryCurrentnessError).technicalDetail).toContain(f.b.artifact_id);
  });
});

describe('M1a-F1 (2): damage to the SUPERSEDED point A is skipped consistently -- B stays current, also when A\'s object is gone', () => {
  it.each([
    'object missing (index entry intact)',
    'index entry torn (half-written)',
    'index entry missing',
    'bytes corrupted',
  ] as const)('A %s under the verified A -> B edge -> current-assessment serves B\'s assessment; generate-report runs on B', async (sabotage) => {
    const f = await buildFixture();
    SABOTAGE[sabotage](f, f.a.artifact_id);
    state.repo = coldRepository(f.casDir, f.indexDir);
    const auth = bearer();

    const current = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', auth);
    expect(current.status, JSON.stringify(current.body)).toBe(200);
    expect(current.body.assessmentArtifactId).toBe(f.assessmentB);
    expect(current.body.localizationGeometry).toMatchObject({ artifact_id: f.b.artifact_id });

    const report = await request(app()).post('/api/localization/generate-report').set('Authorization', auth).send({ projectId: PROJECT_ID, siteAlternatives: [SITE] });
    expect(report.status).toBe(200);
    expect(report.body.siteAnalyses[0].executionMotor.localization_geometry).toMatchObject({ status: 'RESOLVED', artifact_id: f.b.artifact_id });
    expect(kernelMock).toHaveBeenCalledTimes(1);
  });
});

describe('M1a-F1 (a): the double fault "edge B -> C unverifiable AND C\'s projection row lost" fails closed -- never the superseded B', () => {
  it('B -> C moved, then C\'s geometry row and the B -> C edge\'s index entry are lost -> 409 CURRENT_GEOMETRY_UNVERIFIED on every endpoint; B\'s (stale) assessment is never served', async () => {
    const f = await buildFixture();
    const { point: c, edgeId: edgeBC } = await f.moveTo(f.b, 6580943.0, '2026-10-02T00:00:01.000Z');
    // Control on the intact store: C is current, so B's assessment is now the stale one.
    state.repo = coldRepository(f.casDir, f.indexDir);
    const auth = bearer();
    const intact = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', auth);
    expect(intact.body.code ?? null).not.toBe('LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED');
    expect(intact.body.assessmentArtifactId ?? null).not.toBe(f.assessmentB);

    // The double fault: C's projection row lost, and the B -> C edge's index entry lost.
    state.geometryRows.splice(state.geometryRows.findIndex((r) => r.geometryArtifactId === c.artifact_id), 1);
    unlinkSync(indexEntryPath(f, edgeBC));
    state.repo = coldRepository(f.casDir, f.indexDir);
    const failure = {
      ok: false, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'CURRENT_GEOMETRY_UNVERIFIED', reasonCode: 'LOCALIZATION_GEOMETRY_CURRENT_GEOMETRY_UNVERIFIED', retryable: false,
    };

    const report = await request(app()).post('/api/localization/generate-report').set('Authorization', auth).send({ projectId: PROJECT_ID, siteAlternatives: [SITE] });
    const motor = report.body.siteAnalyses[0].executionMotor;
    expect(motor.localization_geometry?.artifact_id ?? null, 'generate-report ran on the SUPERSEDED point B').not.toBe(f.b.artifact_id);
    expect(motor).toMatchObject({
      admitted: false, assessment_status: 'GOVERNANCE_DENIED',
      localization_geometry: { status: 'FAILED_CLOSED', failure_class: 'CURRENT_GEOMETRY_UNVERIFIED', retryable: false },
    });
    expect(kernelMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();

    const current = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', auth);
    expect(current.body.assessmentArtifactId, 'current-assessment presented the SUPERSEDED point-B assessment as current').not.toBe(f.assessmentB);
    expect(current.status).toBe(409);
    expect(current.body).toMatchObject(failure);

    const pdf = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`).set('Authorization', auth);
    expect(pdf.headers['x-assessment-artifact-id'], 'the PDF exported the SUPERSEDED point-B assessment').not.toBe(f.assessmentB);
    expect(pdf.status).toBe(409);
    expect(pdf.body).toMatchObject(failure);
    expect(pdfMock).not.toHaveBeenCalled();

    const verify = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', auth).send({});
    expect(verify.status).toBe(409);
    expect(verify.body).toMatchObject(failure);

    const typed = await resolveLocalizationGeometryCurrentness({ projectId: PROJECT_ID, artifactRepository: state.repo as never }).catch((e: unknown) => e);
    expect((typed as LocalizationGeometryCurrentnessError).technicalDetail).toContain(edgeBC);
    expect((typed as LocalizationGeometryCurrentnessError).technicalDetail).toContain('EDGE_MISSING_FROM_CAS');
    expect((typed as LocalizationGeometryCurrentnessError).technicalDetail).toContain(c.artifact_id);
  });
});

describe('KNOWN_LIMITATION (LOCALIZATION_GEOMETRY_CURRENTNESS_CORRELATED_METADATA_LOSS) -- M1a-F1 (b), accepted for 72h by the owner, NOT approved behaviour', () => {
  it('KNOWN_LIMITATION: B\'s geometry row AND the A -> B edge row both lost -> current-assessment serves A\'s assessment although B and the edge are intact in CAS', async () => {
    const f = await buildFixture();
    state.geometryRows.splice(state.geometryRows.findIndex((r) => r.geometryArtifactId === f.b.artifact_id), 1);
    state.supersessionRows.splice(state.supersessionRows.findIndex((r) => r.supersessionArtifactId === f.edgeAB), 1);
    state.repo = coldRepository(f.casDir, f.indexDir);
    // B and the signed edge are still readable from CAS -- nothing visible refers to them any more.
    const repo = state.repo as CasBackedArtifactRepository;
    expect(await repo.resolve<{ artifact_id: string }>({ artifact_id: f.b.artifact_id, artifact_type: 'localization_geometry' })).toMatchObject({ artifact_id: f.b.artifact_id });
    expect(await repo.resolve<{ artifact_id: string }>({ artifact_id: f.edgeAB, artifact_type: 'localization_geometry_supersession' })).toMatchObject({ artifact_id: f.edgeAB });

    const current = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', bearer());
    // KNOWN_LIMITATION, pinned: "currentness är fail-closed för detekterbara fel men inte bevisad mot
    // korrelerad förlust av all metadata som visar att en nyare punkt existerat". Invert this to a
    // fail-closed expectation when a CAS head pointer exists.
    expect(current.status).toBe(200);
    expect(current.body.assessmentArtifactId).toBe(f.assessmentA);
  });
});
