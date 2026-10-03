/**
 * W-APR: OD-R1 + OD-R2 for the CURRENT-ASSESSMENT selection, through the whole read chain on a REAL
 * FileCAS (owner decisions 2026-10-02: forward-only; a CAS/read error is a technical error, never
 * "missing"; an older record never becomes current just because the newer one cannot be read).
 *
 * The geometry side of this (M1a) is proven by luCurrentGeometryCasFaultChain.test.ts. This file
 * proves the step after it: with the current point B verified, which persisted assessment for B is
 * "current". Everything is stored through the production storage stack in a fresh temp directory:
 *
 *   FileCASRepository (mkdtemp) -> MimersByteStorageBackend -> CasBackedArtifactRepository
 *     -> LocalizationGeometryCurrentProvider (real, signed A -> B edge)
 *     -> resolveCurrentAssessmentProjection (real) -> orchestrator (real)
 *     -> HTTP: GET current-assessment, GET export-assessment-pdf, POST verify-assessment
 *
 * Fault cases: point B carries TWO persisted assessments (the older B-1 and the newer B-2, both
 * registered by the real projection writer). Intact, that is an unresolved conflict (404, as
 * before). Then ONLY the newer B-2 is damaged on disk, in each way the store can fail, and re-read
 * through a COLD storage stack (new FileCASRepository, no cache):
 *
 *   B-2's object missing (index entry intact) -> MIMERS_ARTIFACT_OBJECT_MISSING -> lasting
 *   B-2's index entry missing                   -> "Artifact not found" for a registered row -> lasting
 *   B-2's index entry unreadable (a directory)   -> MIMERS_ARTIFACT_INDEX_READ_FAILED (IO) -> retryable
 *   B-2's index entry torn (half-written)        -> MIMERS_ARTIFACT_INDEX_READ_FAILED (MALFORMED) -> lasting
 *   B-2's bytes corrupted                        -> CASIntegrityError -> lasting
 *   B-2's content tampered (valid CAS object)    -> content no longer hashes to its id -> lasting
 *   B-2's index entry names B-1's object         -> another artifact under the id -> lasting
 *
 * Every endpoint must answer 503 with the typed class and an honest retryable flag, render no PDF,
 * and never present the OLDER B-1 (or anything else) as current. The same damage to the ONLY
 * assessment of B gives the same class instead of 404 "no assessment" (OD-R2).
 *
 * Normal flows are asserted unchanged and byte-identical: several assessments (superseded point A +
 * current point B) serve B's; damage to A's assessment (provably not current: never read) changes
 * not one byte of the read-back, PDF data or verify answer; a new run on top of an old one (point
 * moved B -> C, C assessed) serves C's, and damage to the now-older B assessment changes nothing.
 * Keys are derived from fixed seeds and Date is fixed, so the bytes are reproducible across runs.
 *
 * Replaced (hermetic): server/db/prisma (guard that throws and records), the Prisma projection
 * repositories (in-memory, same contract), external data services, the PDF renderer, auth
 * persistence. Never a real CAS root: the root is mkdtemp() under the OS temp directory.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdfMock = vi.fn(async (_title: string, _subtitle: string | undefined, _data: unknown) => Buffer.from('%PDF-apr-chain'));

const state = vi.hoisted(() => ({
  repo: null as unknown,
  reads: [] as string[],
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  supersessionRows: [] as Array<{ projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date }>,
  assessmentRows: [] as Array<Record<string, unknown>>,
  /** When set, listing the assessment projection rows fails with this error. */
  listError: null as Error | null,
  bindingRows: [] as Array<{ projectId: string; bindingArtifactId: string; contextId: string; contextType: string }>,
  bindingSupersessions: [] as Array<{ projectId: string; artifactId: string }>,
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register() {}
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
        createdAt: new Date(Date.parse('2026-10-02T00:00:00.000Z') + state.assessmentRows.length * 1000),
      });
    }
    async listForProject(projectId: string) {
      if (state.listError) throw state.listError;
      // ORDER BY created_at DESC, as the Prisma index: the newest registration comes first.
      return state.assessmentRows
        .filter((r) => r.projectId === projectId)
        .map((r) => ({ ...r }))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
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
  createLocalizationSpatialRuntime: vi.fn(async () => {
    throw new Error('W-APR chain: the spatial runtime is not part of the read chain');
  }),
}));
vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MimersIntegration: { create: vi.fn(async () => ({ artifactRepository: state.repo })) },
}));
vi.mock('../../server/services/complianceRuleEngine', () => ({ evaluateComplianceRules: vi.fn() }));
vi.mock('../../server/services/spatialAuditService', () => ({ runSpatialAudit: vi.fn() }));
vi.mock('../../server/services/nvrService', () => ({ fetchProtectedAreas: vi.fn(async () => []) }));
vi.mock('../../server/services/raaService', () => ({ fetchAncientMonuments: vi.fn(async () => []) }));
vi.mock('../../server/services/vissService', () => ({ queryVissPoint: vi.fn(async () => null) }));
vi.mock('../../server/services/sguRiskService', () => ({ toGeologicalData: vi.fn(() => ({})) }));
vi.mock('../../server/services/sluService', () => ({ searchSluByCoordinates: vi.fn(async () => []), getSpeciesInformation: vi.fn(async () => null) }));
vi.mock('../../server/services/auditTrailService', () => ({ auditTrail: { logAction: vi.fn(async () => undefined) } }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/application/enqueue-lu-execution-ticket', () => ({ enqueueAdmittedLuTicket: vi.fn(async () => 'ticket-1') }));
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({ resolveCanonicalProjectContext: vi.fn() }));
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({ resolveCanonicalProductRelease: vi.fn() }));
vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: (title: string, subtitle: string | undefined, data: unknown) => pdfMock(title, subtitle, data),
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
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import { createTokenPair } from '../../server/security/auth';
import { registerAssessmentProjection, resolveCurrentAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import {
  exportCurrentLuAssessmentPdf,
  resolveCurrentLuAssessmentSummary,
  verifyCurrentLuAssessment,
} from '../../server/modules/localization/localizationOrchestrator';
import localizationRoutes from '../../server/routes/localization.routes';
import { evidenceRefsOf, negativeLayerEvidence } from '../helpers/luGovernedLayerEvidenceU20CDF5';

const PROJECT_ID = 'project-assessment-cas-fault-chain-apr';
// ADMIN: the per-user rate limit is bypassed for this role, so many calls per test never meet a 429.
const USER = { id: 'user-apr-chain', organisationId: 'org-apr-chain', bankidId: 'bankid:apr-chain', role: 'ADMIN' as const };
const RELEASE_REF = { artifact_id: 'product-release-apr-chain', artifact_type: 'product_release' } as const;
const FIXED_NOW = new Date('2026-10-02T12:00:00.000Z');

/** An Ed25519 key derived from a fixed seed: signatures (and so every artifact byte) are reproducible. */
function fixedEd25519(keyId: string): { readonly provider: LocalPemSigningKeyProvider; readonly publicKey: string } {
  const seed = createHash('sha256').update(`w-apr-chain:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem), publicKey: publicKeyPem };
}
const geometryKey = fixedEd25519('ed25519:geometry-supersession-issuer-apr-chain');
const pcbIssuerKey = fixedEd25519('ed25519:pcb-issuer-apr-chain');
const pcbSupersessionKey = fixedEd25519('ed25519:pcb-supersession-issuer-apr-chain');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);

let root: string;

interface Fixture {
  readonly casDir: string;
  readonly indexDir: string;
  readonly a: LocalizationGeometryArtifact;
  readonly b: LocalizationGeometryArtifact;
  /** The project's (only, current) signed ProjectContextBinding. */
  readonly bindingId: string;
  readonly persistAssessment: (g: LocalizationGeometryArtifact, label: string, contractVersion?: string) => Promise<string>;
  readonly moveTo: (from: LocalizationGeometryArtifact, northing: number, issuedAt: string) => Promise<LocalizationGeometryArtifact>;
}

/** A COLD production storage stack on the temp CAS (new FileCASRepository: no in-process cache); records every read id. */
function coldRepository(f: Fixture): CasBackedArtifactRepository {
  const inner = new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(f.casDir, { durabilityMode: 'none' }), f.indexDir));
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property === 'resolve') {
        return async (ref: { artifact_id: string; artifact_type: string }) => {
          state.reads.push(ref.artifact_id);
          return target.resolve(ref);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function put<T extends { readonly artifact_id: string }>(repo: CasBackedArtifactRepository, artifact: T) {
  const own = (artifact as { readonly content_hash?: unknown }).content_hash;
  await repo.put({ artifact_id: artifact.artifact_id, content_hash: (own as never) ?? sha256ContentHash(artifact), body: artifact });
}

async function buildFixture(): Promise<Fixture> {
  const casDir = path.join(root, 'cas');
  const indexDir = path.join(casDir, 'artifact-id-index');
  const cas = new FileCASRepository(casDir, { durabilityMode: 'none' });
  await cas.initialize();
  const repo = new CasBackedArtifactRepository(new MimersByteStorageBackend(cas, indexDir));

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

  const propertyBinding = { artifact_id: 'project-property-binding-apr-chain', artifact_type: 'project_property_binding' } as const;
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: 'property-identity-apr-chain', property_ref: 'GÄVLE APR 1:1', official_name: 'Gävle Apr 1:1',
    geometry_ref: { artifact_id: 'geometry-apr-chain', artifact_type: 'CANONICAL_GEOMETRY' },
    municipality: 'Gävle', coordinates: [60.67, 17.14], project_property_binding_ref: propertyBinding,
  });
  await put(repo, propertyContext);
  const propertyContextRef = { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type } as const;
  const projectContext = createProductLuProjectContextArtifact({
    project_id: PROJECT_ID, project_name: 'W-APR chain project', description: 'W-APR assessment-selection chain test',
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

  // The moved point: A (superseded) -> B (current), a real signed edge, both projected.
  const point = (northing: number) => createLocalizationGeometryArtifactV2({
    project_id: PROJECT_ID, property_context_ref: propertyContextRef,
    wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, northing],
    provenance: 'user_defined', label: `apr chain point ${northing}`, created_by: USER.id,
  });
  const project = async (g: LocalizationGeometryArtifact) => {
    await put(repo, g);
    state.geometryRows.push({
      projectId: PROJECT_ID, geometryArtifactId: g.artifact_id,
      propertyContextRefId: propertyContextRef.artifact_id, propertyContextRefType: propertyContextRef.artifact_type, createdAt: new Date(),
    });
  };
  const a = point(6580743.0);
  const b = point(6580843.0);
  for (const g of [a, b]) await project(g);
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: geometryKey.provider.keyId,
    owner_authority_ref: { artifact_id: 'owner-authority-apr-chain', artifact_type: 'owner_authority_attestation' },
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
  };
  await supersede(a, b, '2026-10-02T00:00:00.000Z');
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = geometryKey.provider.keyId;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = geometryKey.publicKey;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);

  // A persisted governed assessment, registered through the real projection writer. With
  // `contractVersion`, the payload carries that assessment_contract_version and the artifact is
  // re-identified so its own hash still matches (a self-consistent artifact of an unknown contract).
  // W-U20CDF5 (L2, owner decision 2026-10-02): a V3 record that reads back as a valid assessment pins every
  // governed layer (here one negative evidence per layer); a silent layer in a V3 record is an integrity error.
  const layerEvidence = negativeLayerEvidence(propertyContextRef);
  for (const e of layerEvidence) await repo.put({ artifact_id: e.artifact_id, content_hash: e.content_hash, body: e });
  const persistAssessment = async (g: LocalizationGeometryArtifact, label: string, contractVersion?: string) => {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `apr-chain-${label}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-apr-chain-${label}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: `attempt-apr-chain-${label}`, artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', label }),
    };
    const created = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-a', project_context_ref: projectContextRef, property_ref: propertyContextRef, evidence_refs: evidenceRefsOf(layerEvidence),
        system_summary: `assessment ${label}`,
        localization_geometry_ref: { artifact_id: g.artifact_id, artifact_type: g.artifact_type },
      },
      findings: [], outcome, attestation: security.attestOutcome(outcome.content_hash),
    });
    let assessment = created;
    if (contractVersion !== undefined) {
      const payload = { ...created.payload, assessment_contract_version: contractVersion } as unknown as typeof created.payload;
      const contentHash = sha256ContentHash({ artifact_type: created.artifact_type, references: created.references, payload });
      assessment = { ...created, payload, content_hash: contentHash, artifact_id: `assessment-${contentHash.value}` };
    }
    await repo.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    await registerAssessmentProjection({
      projectId: PROJECT_ID, assessment, contextBindingRef: bindingRef, releaseRef: RELEASE_REF, localizationGeometryArtifactId: g.artifact_id,
    });
    return assessment.artifact_id;
  };
  // One more move (what the supersession worker writes: object -> geometry row -> edge row).
  const moveTo = async (from: LocalizationGeometryArtifact, northing: number, issuedAt: string) => {
    const next = point(northing);
    await project(next);
    await supersede(from, next, issuedAt);
    return next;
  };
  return { casDir, indexDir, a, b, bindingId: binding.artifact_id, persistAssessment, moveTo };
}

function indexEntryPath(f: Fixture, artifactId: string): string {
  return path.join(f.indexDir, `${createHash('sha256').update(artifactId).digest('hex')}.idx`);
}

function storedHash(f: Fixture, artifactId: string): string {
  return (JSON.parse(readFileSync(indexEntryPath(f, artifactId), 'utf8')) as { hash: string }).hash;
}

function objectPath(f: Fixture, artifactId: string): string {
  return new FileCASRepository(f.casDir).getFilePath(storedHash(f, artifactId));
}

type Sabotage = (f: Fixture, id: string, other: string) => Promise<void> | void;
/** Damage ONE stored assessment on disk. */
const SABOTAGE: Record<string, Sabotage> = {
  'object missing (index entry intact)': (f, id) => unlinkSync(objectPath(f, id)),
  'index entry missing': (f, id) => unlinkSync(indexEntryPath(f, id)),
  'index entry unreadable (EISDIR)': (f, id) => {
    const entry = indexEntryPath(f, id);
    unlinkSync(entry);
    mkdirSync(entry);
  },
  'index entry torn (half-written)': (f, id) => writeFileSync(indexEntryPath(f, id), '{"artifact_id":"'),
  'bytes corrupted': (f, id) => writeFileSync(objectPath(f, id), Buffer.from('{"artifact_id":"not-what-the-hash-says"}')),
  // A VALID CAS object (its bytes match its address) whose assessment no longer hashes to its own id.
  'content tampered (valid CAS object)': async (f, id) => {
    const envelope = JSON.parse(readFileSync(objectPath(f, id), 'utf8')) as { body: { payload: Record<string, unknown> } };
    envelope.body.payload = { ...envelope.body.payload, system_summary: 'edited after persistence' };
    const cas = new FileCASRepository(f.casDir, { durabilityMode: 'none' });
    await cas.initialize();
    const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
    writeFileSync(indexEntryPath(f, id), JSON.stringify({ artifact_id: id, hash }));
  },
  // The index entry names ANOTHER assessment's object (a mixed-up index).
  'index entry names another assessment': (f, id, other) => writeFileSync(indexEntryPath(f, id), JSON.stringify({ artifact_id: id, hash: storedHash(f, other) })),
};

const TEXT_LASTING =
  'Projektets aktuella bedömning kan inte fastställas: en bedömning som kan vara den aktuella kunde inte läsas eller ' +
  'verifieras ur arkivet (bestående lagrings- eller integritetsfel). En äldre bedömning visas aldrig i stället. Felet är ' +
  'bestående och löses inte av ett nytt försök. Kontakta systemets administratör.';
const TEXT_TRANSIENT =
  'Projektets aktuella bedömning kan inte fastställas: en bedömning som kan vara den aktuella kunde inte läsas ur arkivet ' +
  '(tekniskt fel). Den saknas inte, men kan inte visas nu. En äldre bedömning visas aldrig i stället. Ett nytt försök kan lyckas.';
const LASTING = { failureClass: 'ASSESSMENT_STORAGE_INTEGRITY_FAULT', reasonCode: 'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT', retryable: false, error: TEXT_LASTING } as const;
const TRANSIENT = { failureClass: 'ASSESSMENT_READ_ERROR', reasonCode: 'CURRENT_ASSESSMENT_CANDIDATE_READ_ERROR', retryable: true, error: TEXT_TRANSIENT } as const;

const CASES: ReadonlyArray<[string, typeof LASTING | typeof TRANSIENT, string]> = [
  ['object missing (index entry intact)', LASTING, 'STORAGE_INTEGRITY_FAULT'],
  ['index entry missing', LASTING, 'MISSING_FROM_CAS'],
  ['index entry unreadable (EISDIR)', TRANSIENT, 'READ_ERROR'],
  ['index entry torn (half-written)', LASTING, 'STORAGE_INTEGRITY_FAULT'],
  ['bytes corrupted', LASTING, 'STORAGE_INTEGRITY_FAULT'],
  ['content tampered (valid CAS object)', LASTING, 'TAMPERED'],
  ['index entry names another assessment', LASTING, 'ARTIFACT_ID_MISMATCH'],
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

const deps = () => ({ authUser: USER, projectId: PROJECT_ID });

/** Every answer of the read chain, as bytes: HTTP read-back, the PDF's data object, HTTP verify, and the direct read-back. */
async function readChain() {
  const auth = bearer();
  const pdfCallsBefore = pdfMock.mock.calls.length;
  const readBack = await request(app()).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', auth);
  const pdf = await request(app()).get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`).set('Authorization', auth);
  const pdfData = pdfMock.mock.calls.slice(pdfCallsBefore).map((call) => call[2]);
  const verify = await request(app()).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', auth).send({});
  const direct = await resolveCurrentLuAssessmentSummary(deps());
  return { readBack, pdf, pdfData, verify, direct };
}

function bytesOf(chain: Awaited<ReturnType<typeof readChain>>): string {
  return JSON.stringify({
    readBack: [chain.readBack.status, chain.readBack.text],
    pdf: [chain.pdf.status, chain.pdf.headers['x-assessment-artifact-id'] ?? null, chain.pdfData],
    verify: [chain.verify.status, chain.verify.text],
    direct: chain.direct,
  });
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
  root = mkdtempSync(path.join(tmpdir(), 'wapr-assessment-chain-'));
  state.repo = null;
  state.reads.length = 0;
  state.geometryRows.length = 0;
  state.supersessionRows.length = 0;
  state.assessmentRows.length = 0;
  state.listError = null;
  state.bindingRows.length = 0;
  state.bindingSupersessions.length = 0;
  pdfMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
  expect(hermeticPrismaTouches).toEqual([]);
});

const TEXT_AMBIGUOUS =
  'Projektets aktuella bedömning kan inte fastställas: det finns flera giltiga bedömningar för den aktuella bindningen ' +
  'och platsen, och ingen av dem är utpekad som den aktuella. Ingen av dem visas som aktuell. Ett nytt försök ändrar inte detta.';
const AMBIGUOUS = {
  ok: false, code: 'ASSESSMENT_CURRENT_UNRESOLVED', failureClass: 'ASSESSMENT_CURRENT_AMBIGUOUS',
  reasonCode: 'REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT', retryable: false, error: TEXT_AMBIGUOUS,
} as const;

describe('W-APR control: two intact assessments for the current point B are an unresolved conflict -- both are real candidates; neither is presented', () => {
  it('B-1 and B-2 both persisted and registered for B -> 409 ASSESSMENT_CURRENT_AMBIGUOUS (a refusal, not "no assessment") on read-back, PDF and verify', async () => {
    const f = await buildFixture();
    await f.persistAssessment(f.a, 'A');
    const older = await f.persistAssessment(f.b, 'B-1');
    const newer = await f.persistAssessment(f.b, 'B-2');
    state.repo = coldRepository(f);

    const chain = await readChain();
    for (const res of [chain.readBack, chain.pdf, chain.verify]) {
      expect(res.status).toBe(409);
      expect(res.body).toEqual(AMBIGUOUS);
      expect(res.text).not.toContain(older);
      expect(res.text).not.toContain(newer);
    }
    expect(chain.direct).toEqual({ status: 409, ...AMBIGUOUS });
    expect(chain.pdfData).toEqual([]);
    expect(state.reads).toEqual(expect.arrayContaining([older, newer]));
  });
});

describe('W-APR: the NEWER assessment of the current point damaged on disk -> every endpoint fails closed with the class; the OLDER one is never current', () => {
  it.each(CASES)('B-2 %s -> 503 %j; B-1 never presented, no PDF', async (sabotage, expected, reason) => {
    const f = await buildFixture();
    await f.persistAssessment(f.a, 'A');
    const older = await f.persistAssessment(f.b, 'B-1');
    const newer = await f.persistAssessment(f.b, 'B-2');
    await SABOTAGE[sabotage]!(f, newer, older);
    state.repo = coldRepository(f); // a cold process: nothing cached

    const chain = await readChain();
    const body = { ok: false, code: 'ASSESSMENT_READ_ERROR', ...expected };

    expect(chain.readBack.body.assessmentArtifactId, 'current-assessment presented the OLDER assessment as current').not.toBe(older);
    expect(chain.readBack.status).toBe(503);
    expect(chain.readBack.body).toEqual(body);

    expect(chain.pdf.headers['x-assessment-artifact-id'], 'the PDF exported the OLDER assessment').not.toBe(older);
    expect(chain.pdf.status).toBe(503);
    expect(chain.pdf.body).toEqual(body);
    expect(chain.pdfData, 'a PDF was rendered').toEqual([]);

    expect(chain.verify.body.assessmentArtifactId, 'verify verified the OLDER assessment').not.toBe(older);
    expect(chain.verify.status).toBe(503);
    expect(chain.verify.body).toEqual(body);

    expect(chain.direct).toEqual({ status: 503, ...body });
    expect(await exportCurrentLuAssessmentPdf(deps())).toEqual({ status: 503, ...body });
    expect(await verifyCurrentLuAssessment(deps())).toEqual({ status: 503, ...body });

    // Nothing of the store leaks: no id, no path, no storage message.
    for (const res of [chain.readBack, chain.pdf, chain.verify]) {
      expect(res.text).not.toContain(older);
      expect(res.text).not.toContain(newer);
      expect(res.text).not.toMatch(/MIMERS_|CASIntegrity|EISDIR|ENOENT|Artifact not found|wapr-assessment-chain/);
    }

    // Server-side, the typed fault names the damaged candidate and why.
    const typed = await resolveCurrentAssessmentProjection({
      projectId: PROJECT_ID, artifactRepository: state.repo as never,
      currentBindingProvider: new ProjectContextBindingProvider(state.repo as never, new PrismaProjectContextBindingIndex(), pcbVerification),
      currentLocalizationGeometryArtifactId: f.b.artifact_id,
    }).catch((error: unknown) => error);
    expect(typed).toMatchObject({
      code: 'ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE',
      retryable: expected.retryable,
      faults: [{ assessmentArtifactId: newer, reason, retryable: expected.retryable }],
    });
  });

  it.each(CASES.filter(([sabotage]) => sabotage !== 'index entry names another assessment'))(
    'the ONLY assessment of B: %s -> 503 %j, never 404 "no assessment" (OD-R2)',
    async (sabotage, expected) => {
      const f = await buildFixture();
      await f.persistAssessment(f.a, 'A');
      const only = await f.persistAssessment(f.b, 'B');
      await SABOTAGE[sabotage]!(f, only, only);
      state.repo = coldRepository(f);

      const chain = await readChain();
      const body = { ok: false, code: 'ASSESSMENT_READ_ERROR', ...expected };
      expect(chain.readBack.status).toBe(503);
      expect(chain.readBack.body).toEqual(body);
      expect(chain.pdf.status).toBe(503);
      expect(chain.pdf.body).toEqual(body);
      expect(chain.pdfData).toEqual([]);
      expect(chain.verify.status).toBe(503);
      expect(chain.verify.body).toEqual(body);
    },
  );
});

const TEXT_BINDING_TRANSIENT =
  'Projektets aktuella bedömning kan inte fastställas: projektets aktuella bindning kunde inte läsas (tekniskt fel). Den ' +
  'saknas inte, men ingen bedömning kan visas nu. En äldre bedömning visas aldrig i stället. Ett nytt försök kan lyckas.';
const TEXT_BINDING_LASTING =
  'Projektets aktuella bedömning kan inte fastställas: projektets aktuella bindning kunde inte läsas ur arkivet (bestående ' +
  'lagrings- eller integritetsfel). En äldre bedömning visas aldrig i stället. Felet är bestående och löses inte av ett nytt ' +
  'försök. Kontakta systemets administratör.';
const TEXT_BINDING_REFUSED =
  'Projektets aktuella bedömning kan inte fastställas: projektets aktuella bindning underkändes vid verifieringen ' +
  '(utfärdare, signatur, innehåll eller ersättningskedja). Ingen bedömning visas, och en äldre bedömning visas aldrig i ' +
  'stället. Felet löses inte av ett nytt försök. Kontakta systemets administratör.';
const BINDING_TRANSIENT = { status: 503, body: { ok: false, code: 'ASSESSMENT_READ_ERROR', failureClass: 'ASSESSMENT_RESOLUTION_ERROR', reasonCode: 'CURRENT_BINDING_READ_ERROR', retryable: true, error: TEXT_BINDING_TRANSIENT } };
const BINDING_LASTING = { status: 503, body: { ok: false, code: 'ASSESSMENT_READ_ERROR', failureClass: 'ASSESSMENT_STORAGE_INTEGRITY_FAULT', reasonCode: 'CURRENT_BINDING_INTEGRITY_FAULT', retryable: false, error: TEXT_BINDING_LASTING } };
const bindingRefused = (reasonCode: string) => ({
  status: 409,
  body: { ok: false, code: 'ASSESSMENT_CURRENT_UNRESOLVED', failureClass: 'CURRENT_BINDING_REFUSED', reasonCode, retryable: false, error: TEXT_BINDING_REFUSED },
});

describe('W-APR add-on 2: the current binding damaged on disk -> a typed technical fault or a refusal by its nature, never 404 "no assessment"', () => {
  it.each<[string, { status: number; body: Record<string, unknown> }]>([
    ['object missing (index entry intact)', BINDING_LASTING],
    ['index entry missing', BINDING_LASTING],
    ['index entry unreadable (EISDIR)', BINDING_TRANSIENT],
    ['index entry torn (half-written)', BINDING_LASTING],
    ['bytes corrupted', BINDING_LASTING],
    // The binding fixture carries no binding_contract_version, so the V1 validator refuses it.
    ['content tampered (valid CAS object)', bindingRefused('REJECT_PROJECT_CONTEXT_BINDING')],
  ])('the binding: %s -> %j on read-back, PDF and verify; no assessment presented', async (sabotage, expected) => {
    const f = await buildFixture();
    await f.persistAssessment(f.a, 'A');
    const atB = await f.persistAssessment(f.b, 'B');
    await SABOTAGE[sabotage]!(f, f.bindingId, f.bindingId);
    state.repo = coldRepository(f);

    const chain = await readChain();
    for (const res of [chain.readBack, chain.pdf, chain.verify]) {
      expect(res.status, `${res.text}`).toBe(expected.status);
      expect(res.body).toEqual(expected.body);
      expect(res.text).not.toContain(atB);
      expect(res.text).not.toMatch(/MIMERS_|CASIntegrity|EISDIR|ENOENT|Artifact not found|wapr-assessment-chain/);
    }
    expect(chain.direct).toEqual({ ...expected.body, status: expected.status });
    expect(chain.pdfData).toEqual([]);
  });
});

const TEXT_CONTRACT =
  'Projektets aktuella bedömning kan inte visas: den följer inget godkänt bedömningskontrakt (okänd eller ogiltig ' +
  'kontraktsversion). En äldre bedömning visas aldrig i stället. Felet är bestående och löses inte av ett nytt försök. ' +
  'Kontakta systemets administratör.';
const TEXT_SELECTION_REFUSED =
  'Projektets aktuella bedömning kan inte fastställas: urvalet av den aktuella bedömningen underkändes. Ingen bedömning ' +
  'visas, och en äldre bedömning visas aldrig i stället. Felet löses inte av ett nytt försök.';

describe('W-APR add-on 3: each REJECT_* of the selection is classified as what it is; 404 only for genuine absence', () => {
  it('an assessment of an unknown contract version for B -> 424 ASSESSMENT_CONTRACT_INVALID (a contract refusal, not absence); the older one is never shown', async () => {
    const f = await buildFixture();
    await f.persistAssessment(f.a, 'A');
    const unknown = await f.persistAssessment(f.b, 'B-unknown-contract', 'LU_ASSESSMENT_CONTRACT_V999');
    state.repo = coldRepository(f);
    const body = { ok: false, code: 'ASSESSMENT_CONTRACT_REFUSED', failureClass: 'ASSESSMENT_CONTRACT_INVALID', reasonCode: 'REJECT_LOCALIZATION_ASSESSMENT', retryable: false, error: TEXT_CONTRACT };

    const chain = await readChain();
    for (const res of [chain.readBack, chain.pdf, chain.verify]) {
      expect(res.status).toBe(424);
      expect(res.body).toEqual(body);
      expect(res.text).not.toContain(unknown);
      expect(res.text).not.toContain('V999');
    }
    expect(chain.direct).toEqual({ status: 424, ...body });
    expect(chain.pdfData).toEqual([]);
  });

  it('an unrecognised REJECT_* from the selection -> 409 ASSESSMENT_SELECTION_REFUSED, never absence', async () => {
    const f = await buildFixture();
    await f.persistAssessment(f.b, 'B');
    state.repo = coldRepository(f);
    state.listError = new Error('REJECT_SOME_FUTURE_PROJECTION_RULE: refused');
    const body = { ok: false, code: 'ASSESSMENT_CURRENT_UNRESOLVED', failureClass: 'ASSESSMENT_SELECTION_REFUSED', reasonCode: 'REJECT_SOME_FUTURE_PROJECTION_RULE', retryable: false, error: TEXT_SELECTION_REFUSED };

    const chain = await readChain();
    for (const res of [chain.readBack, chain.pdf, chain.verify]) {
      expect(res.status).toBe(409);
      expect(res.body).toEqual(body);
    }
  });

  it.each<[string, (f: Fixture) => Promise<void>]>([
    ['no assessment ever registered for the project (REJECT_ASSESSMENT_PROJECTION_NOT_FOUND)', async () => undefined],
    ['only the superseded point A was assessed (REJECT_ASSESSMENT_PROJECTION_NOT_CURRENT)', async (f) => { await f.persistAssessment(f.a, 'A'); }],
    ['the only row for B is proven not current by its own content (REJECT_ASSESSMENT_PROJECTION_NOT_FOUND, no survivor)', async (f) => {
      const atA = await f.persistAssessment(f.a, 'A');
      // A row that names point B for A's assessment: A's verified content proves it is not current.
      const row = state.assessmentRows.find((r) => r.assessmentArtifactId === atA)!;
      row.localizationGeometryArtifactId = f.b.artifact_id;
    }],
  ])('genuine absence: %s -> 404, unchanged', async (_label, arrange) => {
    const f = await buildFixture();
    await arrange(f);
    state.repo = coldRepository(f);
    // W-U20CDF6 (UI1 limit 1): a proven absence carries retryable false, explicitly.
    const absent = { ok: false, error: 'No current governed LU assessment is available for this project.', retryable: false };

    const chain = await readChain();
    for (const res of [chain.readBack, chain.pdf, chain.verify]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(absent);
    }
    expect(chain.direct).toEqual({ status: 404, ...absent });
  });
});

describe('W-APR: normal flows unchanged, byte for byte', () => {
  it('several assessments (superseded point A, current point B) -> B\'s through read-back, PDF and verify; damage to A\'s assessment (never read) changes not one byte', async () => {
    const f = await buildFixture();
    const atA = await f.persistAssessment(f.a, 'A');
    const atB = await f.persistAssessment(f.b, 'B');
    state.repo = coldRepository(f);

    const intact = await readChain();
    expect(intact.readBack.status).toBe(200);
    expect(intact.readBack.body.assessmentArtifactId).toBe(atB);
    expect(intact.readBack.body.localizationGeometry).toMatchObject({ artifact_id: f.b.artifact_id, bound_geometry_status: 'VERIFIED' });
    expect(intact.pdf.status).toBe(200);
    expect(intact.pdf.headers['x-assessment-artifact-id']).toBe(atB);
    expect(intact.pdfData).toHaveLength(1);
    expect(intact.verify.body.code ?? null).not.toBe('ASSESSMENT_READ_ERROR');
    if (intact.verify.status === 200) expect(intact.verify.body.assessmentArtifactId).toBe(atB);
    expect(state.reads).not.toContain(atA);
    const reference = bytesOf(intact);

    for (const sabotage of Object.keys(SABOTAGE)) {
      // A fresh, identical store (fixed keys, fixed time): the only difference is the damage to A's assessment.
      rmSync(root, { recursive: true, force: true });
      root = mkdtempSync(path.join(tmpdir(), 'wapr-assessment-chain-'));
      for (const rows of [state.geometryRows, state.supersessionRows, state.assessmentRows, state.bindingRows, state.bindingSupersessions]) rows.length = 0;
      const g = await buildFixture();
      expect(await g.persistAssessment(g.a, 'A')).toBe(atA);
      expect(await g.persistAssessment(g.b, 'B')).toBe(atB);
      await SABOTAGE[sabotage]!(g, atA, atB);
      state.repo = coldRepository(g);
      state.reads.length = 0;
      const damaged = await readChain();
      expect(sha256(bytesOf(damaged)), `A's assessment ${sabotage} changed the answer for B`).toBe(sha256(reference));
      expect(state.reads, sabotage).not.toContain(atA);
    }
  });

  it('a new run on top of an old one: point moved B -> C and C assessed -> C\'s assessment; the now-older B assessment is never read, and damage to it changes not one byte', async () => {
    const f = await buildFixture();
    await f.persistAssessment(f.a, 'A');
    const atB = await f.persistAssessment(f.b, 'B');
    const c = await f.moveTo(f.b, 6580943.0, '2026-10-02T00:00:01.000Z');
    const atC = await f.persistAssessment(c, 'C');
    state.repo = coldRepository(f);

    const intact = await readChain();
    expect(intact.readBack.status).toBe(200);
    expect(intact.readBack.body.assessmentArtifactId).toBe(atC);
    expect(intact.pdf.headers['x-assessment-artifact-id']).toBe(atC);
    expect(intact.readBack.text).not.toContain(atB);
    expect(state.reads).not.toContain(atB);

    for (const sabotage of ['object missing (index entry intact)', 'index entry unreadable (EISDIR)', 'content tampered (valid CAS object)']) {
      rmSync(root, { recursive: true, force: true });
      root = mkdtempSync(path.join(tmpdir(), 'wapr-assessment-chain-'));
      for (const rows of [state.geometryRows, state.supersessionRows, state.assessmentRows, state.bindingRows, state.bindingSupersessions]) rows.length = 0;
      const g = await buildFixture();
      await g.persistAssessment(g.a, 'A');
      await g.persistAssessment(g.b, 'B');
      const gc = await g.moveTo(g.b, 6580943.0, '2026-10-02T00:00:01.000Z');
      expect(await g.persistAssessment(gc, 'C')).toBe(atC);
      await SABOTAGE[sabotage]!(g, atB, atC);
      state.repo = coldRepository(g);
      state.reads.length = 0;
      const damaged = await readChain();
      expect(sha256(bytesOf(damaged)), `B's assessment ${sabotage} changed the answer for C`).toBe(sha256(bytesOf(intact)));
      expect(state.reads, sabotage).not.toContain(atB);
    }
  });

  it('the fixture is reproducible: two independent builds give byte-identical answers (so the byte comparisons above compare like with like)', async () => {
    const f = await buildFixture();
    await f.persistAssessment(f.a, 'A');
    await f.persistAssessment(f.b, 'B');
    state.repo = coldRepository(f);
    const first = bytesOf(await readChain());

    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(path.join(tmpdir(), 'wapr-assessment-chain-'));
    for (const rows of [state.geometryRows, state.supersessionRows, state.assessmentRows, state.bindingRows, state.bindingSupersessions]) rows.length = 0;
    const g = await buildFixture();
    await g.persistAssessment(g.a, 'A');
    await g.persistAssessment(g.b, 'B');
    state.repo = coldRepository(g);
    expect(sha256(bytesOf(await readChain()))).toBe(sha256(first));
  });
});
