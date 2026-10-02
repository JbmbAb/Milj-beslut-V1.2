/**
 * W-BOOT, on the APR verifier's F2 and F1, through the read chain on a REAL FileCAS: lost binding-index
 * rows are a lasting integrity fault (503, retryable:false), never 404 "no assessment" and never the
 * older assessment.
 *
 *   FileCASRepository (mkdtemp) -> MimersByteStorageBackend -> CasBackedArtifactRepository (cold per read)
 *     -> real signed bindings B1 -> B2 and a real signed supersession relation
 *     -> ProjectContextBindingProvider (real) -> resolveCurrentAssessmentProjection (real)
 *     -> resolveCurrentLuAssessmentSummary (orchestrator, real mapping to status/code/class/retryable)
 *
 * X is assessed under B1 (old context), Y under B2 (new context); the project has no localization
 * point (binding-only eligibility). Healthy: Y, 200. The index rows are then lost in the ways the
 * verifier's probes U4b/U4c lose them; the CAS objects stay intact throughout.
 *
 * Replaced (hermetic): server/db/prisma (the hermetic guard), the Prisma projection and binding
 * indexes (in memory, same contract), external data services, auth persistence. Never a real CAS
 * root: mkdtemp() under the OS temp directory.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ repo: null as unknown }));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register() {}
    async listForProject() {
      return [];
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => ({
  PrismaLocalizationGeometrySupersessionIndex: class {
    async register() {}
    async listForProject() {
      return [];
    }
  },
}));
vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => ({
  PrismaProjectAssessmentProjectionIndex: class {
    async register() {
      throw new Error('W-BOOT chain: the projection index is injected');
    }
    async listForProject() {
      throw new Error('W-BOOT chain: the projection index is injected');
    }
  },
}));
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    constructor() {
      throw new Error('W-BOOT chain: the binding provider is injected');
    }
  },
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: vi.fn(async () => undefined) }));
vi.mock('../../server/modules/localization/createLocalizationSpatialRuntime', () => ({
  createLocalizationSpatialRuntime: vi.fn(async () => {
    throw new Error('W-BOOT chain: the spatial runtime is not part of the read chain');
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
vi.mock('../../server/services/pdfExportService', () => ({ buildJsonPdfBuffer: vi.fn(async () => Buffer.from('%PDF-boot')) }));

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { FileCASRepository, LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createGovernedLocalizationAssessment,
  createProductLuProjectContextArtifact,
  createProductLuPropertyContextArtifact,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
} from '@miljobeslut/mps-lu';
import type { ArtifactReference } from '../../packages/mps-compliance/src/artifacts/ArtifactReference';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from '../../server/modules/localization/installProjectContextBinding';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProjectContextBindingSupersessionArtifact,
  attestProjectContextBindingSupersessionIssuerArtifact,
} from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { resolveCurrentLuAssessmentSummary } from '../../server/modules/localization/localizationOrchestrator';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import type { LocalizationGeometryProjectionIndex } from '../../server/repositories/localizationGeometryProjectionRepository';
import { evidenceRefsOf, negativeLayerEvidence } from '../helpers/luGovernedLayerEvidenceU20CDF5';

const PROJECT_ID = 'project-binding-index-loss-chain-boot';
const USER = { id: 'user-boot-chain', organisationId: 'org-boot-chain', bankidId: 'bankid:boot-chain', role: 'ADMIN' as const };
const RELEASE_REF = { artifact_id: 'product-release-boot-chain', artifact_type: 'product_release' } as const;

function fixedEd25519(keyId: string) {
  const seed = createHash('sha256').update(`w-boot-index-chain:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, publicKeyPem, provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem) };
}
const issuerKey = fixedEd25519('ed25519:pcb-issuer-boot-index-chain');
const supersessionKey = fixedEd25519('ed25519:pcb-supersession-issuer-boot-index-chain');
const verification = new LocalPemVerificationKeyProvider(issuerKey.keyId, issuerKey.publicKeyPem);

/** The Prisma binding index's contract, plus the row loss under test. */
class MemoryBindingIndex implements ProjectContextBindingIndex {
  readonly bindings: Array<{ projectId: string; ref: ArtifactReference; context: ArtifactReference }> = [];
  readonly supersessions: Array<{ projectId: string; ref: ArtifactReference }> = [];
  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    if (!this.bindings.some((b) => b.ref.artifact_id === binding.artifact_id)) {
      this.bindings.push({ projectId: binding.payload.project_id, ref: { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type }, context: binding.payload.project_context_ref });
    }
  }
  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const rows = this.bindings.filter((b) => b.projectId === projectId && b.context.artifact_id === context.artifact_id && b.context.artifact_type === context.artifact_type);
    if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
    return rows[0]!.ref.artifact_id;
  }
  async registerSupersession(supersession: ReturnType<typeof createProjectContextBindingSupersessionArtifact>): Promise<void> {
    if (!this.supersessions.some((s) => s.ref.artifact_id === supersession.artifact_id)) {
      this.supersessions.push({ projectId: supersession.payload.project_id, ref: { artifact_id: supersession.artifact_id, artifact_type: supersession.artifact_type } });
    }
  }
  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.bindings.filter((b) => b.projectId === projectId).map((b) => b.ref);
  }
  async listSupersessionRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.supersessions.filter((s) => s.projectId === projectId).map((s) => s.ref);
  }
  async findProjectContextRef(): Promise<ArtifactReference> {
    throw new Error('not used');
  }
  loseBindingRow(bindingId: string): void {
    this.bindings.splice(this.bindings.findIndex((b) => b.ref.artifact_id === bindingId), 1);
  }
}

class MemoryProjectionIndex implements ProjectAssessmentProjectionIndex {
  readonly rows: ProjectAssessmentProjectionRow[] = [];
  async register(row: {
    projectId: string; assessmentArtifactId: string; assessmentArtifactType: string; projectContextRef: ArtifactReference;
    bindingArtifactId: string; releaseArtifactId: string; localizationGeometryArtifactId?: string | null;
  }): Promise<void> {
    if (this.rows.some((r) => r.projectId === row.projectId && r.assessmentArtifactId === row.assessmentArtifactId)) return;
    this.rows.push({
      projectId: row.projectId, assessmentArtifactId: row.assessmentArtifactId, assessmentArtifactType: row.assessmentArtifactType,
      projectContextRefId: row.projectContextRef.artifact_id, projectContextRefType: row.projectContextRef.artifact_type,
      bindingArtifactId: row.bindingArtifactId, releaseArtifactId: row.releaseArtifactId,
      localizationGeometryArtifactId: row.localizationGeometryArtifactId ?? null, createdAt: new Date(Date.parse('2026-10-02T00:00:00.000Z') + this.rows.length * 1000),
    });
  }
  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    return this.rows.filter((r) => r.projectId === projectId).map((r) => ({ ...r })).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  loseRow(assessmentId: string): void {
    this.rows.splice(this.rows.findIndex((r) => r.assessmentArtifactId === assessmentId), 1);
  }
}

const noGeometry: LocalizationGeometryProjectionIndex = {
  register: async () => undefined,
  listForProject: async () => [],
} as unknown as LocalizationGeometryProjectionIndex;

let root: string;
let casDir: string;
let indexDir: string;

/** A COLD production storage stack on the temp CAS (new FileCASRepository: no in-process cache). */
function coldRepository(): CasBackedArtifactRepository {
  return new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(casDir, { durabilityMode: 'none' }), indexDir));
}

async function put(repo: CasBackedArtifactRepository, artifact: { readonly artifact_id: string; readonly content_hash?: unknown }) {
  await repo.put({ artifact_id: artifact.artifact_id, content_hash: (artifact.content_hash as never) ?? sha256ContentHash(artifact), body: artifact });
}

async function fixture() {
  const cas = new FileCASRepository(casDir, { durabilityMode: 'none' });
  await cas.initialize();
  const repo = coldRepository();
  const bindingIndex = new MemoryBindingIndex();
  const projectionIndex = new MemoryProjectionIndex();

  const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.keyId, issuer_version: 'project-context-binding-issuer-v2' });
  await put(repo, pcbIssuer);
  const authority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = supersessionKey.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = supersessionKey.publicKeyPem;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const bareSupersessionIssuer = createProjectContextBindingSupersessionIssuerArtifact({ issuer_key_id: supersessionKey.keyId, owner_authority_ref: authority });
  const supersessionIssuer = {
    ...bareSupersessionIssuer,
    attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: bareSupersessionIssuer, signing: supersessionKey.provider }),
  };
  await put(repo, supersessionIssuer);

  const propertyBinding = { artifact_id: 'project-property-binding-boot-chain', artifact_type: 'project_property_binding' } as const;
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: 'property-identity-boot-chain', property_ref: 'GÄVLE BOOT 2:2', official_name: 'Gävle Boot 2:2',
    geometry_ref: { artifact_id: 'geometry-boot-chain', artifact_type: 'CANONICAL_GEOMETRY' },
    municipality: 'Gävle', coordinates: [60.67, 17.14], project_property_binding_ref: propertyBinding,
  });
  await put(repo, propertyContext);
  const propertyContextRef = { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type } as const;

  async function contextAndBinding(label: string, createdAt: string) {
    const context = createProductLuProjectContextArtifact({
      project_id: PROJECT_ID, project_name: `W-BOOT chain ${label}`, description: `W-BOOT binding-index-loss chain, context ${label}`,
      created_by: USER.id, property_context_ref: propertyContextRef, project_property_binding_ref: propertyBinding,
    });
    await put(repo, context);
    const contextRef = { artifact_id: context.artifact_id, artifact_type: context.artifact_type } as const;
    const bare = createProjectContextBindingArtifact({
      project_id: PROJECT_ID, project_context_ref: contextRef, project_property_binding_ref: propertyBinding,
      binding_version: 'project-context-binding-v2', authority_ref: authority, created_at: createdAt,
    });
    const binding = { ...bare, attestation: await attestProjectContextBindingArtifact({ artifact: bare, issuer: pcbIssuer, signing: issuerKey.provider }) };
    await installOwnerIssuedProjectContextBinding({ artifactRepository: repo, index: bindingIndex, binding, verification });
    return { contextRef, bindingRef: { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type } as const };
  }
  const one = await contextAndBinding('B1', '2026-10-01T00:00:00.000Z');
  const two = await contextAndBinding('B2', '2026-10-02T00:00:00.000Z');
  const bareRelation = createProjectContextBindingSupersessionArtifact({
    contract_version: 'PROJECT_CONTEXT_BINDING_SUPERSESSION_V1', project_id: PROJECT_ID,
    superseded_binding_ref: one.bindingRef, successor_binding_ref: two.bindingRef, reason_code: 'W_BOOT_CHAIN_SUPERSESSION',
    issuer_ref: { artifact_id: supersessionIssuer.artifact_id, artifact_type: supersessionIssuer.artifact_type },
    issuer_key_id: supersessionKey.keyId, issued_at: '2026-10-02T00:01:00.000Z',
  });
  const relation = { ...bareRelation, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: bareRelation, issuer: supersessionIssuer, signing: supersessionKey.provider }) };
  await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repo, index: bindingIndex, supersession: relation, verification });

  // W-U20CDF5 (L2, owner decision 2026-10-02): a V3 record that reads back as a valid assessment pins every
  // governed layer (here one negative evidence per layer); a silent layer in a V3 record is an integrity error.
  const layerEvidence = negativeLayerEvidence(propertyContextRef);
  for (const e of layerEvidence) await repo.put({ artifact_id: e.artifact_id, content_hash: e.content_hash, body: e });
  async function persistAssessment(label: string, contextRef: ArtifactReference, bindingRef: ArtifactReference): Promise<string> {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `boot-chain-${label}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-boot-chain-${label}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: `attempt-boot-chain-${label}`, artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', label }),
    };
    const assessment = createGovernedLocalizationAssessment({
      draft: { site_id: 'site-boot-chain', project_context_ref: contextRef, property_ref: propertyContextRef, evidence_refs: evidenceRefsOf(layerEvidence), system_summary: `assessment ${label}` },
      findings: [], outcome, attestation: security.attestOutcome(outcome.content_hash),
    });
    await repo.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: bindingRef, releaseRef: RELEASE_REF, index: projectionIndex });
    return assessment.artifact_id;
  }
  const x = await persistAssessment('X', one.contextRef, one.bindingRef);
  const y = await persistAssessment('Y', two.contextRef, two.bindingRef);
  return { bindingIndex, projectionIndex, b1: one.bindingRef.artifact_id, b2: two.bindingRef.artifact_id, relation: relation.artifact_id, x, y };
}

/** The read-back through the orchestrator, every call on a cold storage stack. */
async function readBack(f: Awaited<ReturnType<typeof fixture>>) {
  const repo = coldRepository();
  state.repo = repo;
  return resolveCurrentLuAssessmentSummary({
    authUser: USER, projectId: PROJECT_ID, artifactRepository: repo,
    currentBindingProvider: new ProjectContextBindingProvider(repo, f.bindingIndex, verification),
    assessmentProjectionIndex: f.projectionIndex, localizationGeometryIndex: noGeometry,
  });
}

const INTEGRITY_BINDING = {
  ok: false, status: 503, code: 'ASSESSMENT_READ_ERROR', failureClass: 'ASSESSMENT_STORAGE_INTEGRITY_FAULT',
  reasonCode: 'CURRENT_BINDING_INTEGRITY_FAULT', retryable: false,
} as const;
const INTEGRITY_CANDIDATE = {
  ok: false, status: 503, code: 'ASSESSMENT_READ_ERROR', failureClass: 'ASSESSMENT_STORAGE_INTEGRITY_FAULT',
  reasonCode: 'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT', retryable: false,
} as const;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wboot-index-loss-chain-'));
  casDir = path.join(root, 'cas');
  indexDir = path.join(casDir, 'artifact-id-index');
  hermeticPrismaTouches.length = 0;
});

afterEach(() => {
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  rmSync(root, { recursive: true, force: true });
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('W-BOOT chain on a real FileCAS: lost binding-index rows are a lasting integrity fault, never 404 and never the older assessment', () => {
  it('control: intact -> 200, Y (the assessment under the current binding B2)', async () => {
    const f = await fixture();
    expect(await readBack(f)).toMatchObject({ ok: true, assessmentArtifactId: f.y });
  });

  it('APR F2 (U4c): every binding row lost, the signed relation row kept -> 503 CURRENT_BINDING_INTEGRITY_FAULT, retryable:false (was 404 "no assessment")', async () => {
    const f = await fixture();
    f.bindingIndex.loseBindingRow(f.b1);
    f.bindingIndex.loseBindingRow(f.b2);
    const result = await readBack(f);
    expect(result).toMatchObject(INTEGRITY_BINDING);
    expect((result as { error: string }).error).not.toContain(f.b2);
  });

  it('APR F2: every binding row AND the relation row lost, the projection rows kept -> 503 CURRENT_BINDING_INTEGRITY_FAULT, retryable:false', async () => {
    const f = await fixture();
    f.bindingIndex.loseBindingRow(f.b1);
    f.bindingIndex.loseBindingRow(f.b2);
    f.bindingIndex.supersessions.length = 0;
    expect(await readBack(f)).toMatchObject(INTEGRITY_BINDING);
  });

  it('APR F1 (U4b): B2\'s binding row AND the relation row lost -> Y\'s row names a binding outside the graph -> 503 integrity; X is never presented (was 200 X)', async () => {
    const f = await fixture();
    f.bindingIndex.loseBindingRow(f.b2);
    f.bindingIndex.supersessions.length = 0;
    const result = await readBack(f);
    expect(result).not.toMatchObject({ ok: true, assessmentArtifactId: f.x });
    expect(result).toMatchObject(INTEGRITY_CANDIDATE);
  });

  it('control: only the relation row lost -> 409 refused as two heads, never X (unchanged)', async () => {
    const f = await fixture();
    f.bindingIndex.supersessions.length = 0;
    expect(await readBack(f)).toMatchObject({ ok: false, status: 409, failureClass: 'CURRENT_BINDING_REFUSED', reasonCode: 'REJECT_PROJECT_CONTEXT_BINDING_HEAD' });
  });

  it('KNOWN_LIMITATION (ASSESSMENT_PROJECTION_CURRENTNESS_CORRELATED_METADATA_LOSS), pinned, NOT approved: B2\'s binding row, the relation row AND Y\'s projection row all lost -> 200 X', async () => {
    const f = await fixture();
    f.bindingIndex.loseBindingRow(f.b2);
    f.bindingIndex.supersessions.length = 0;
    f.projectionIndex.loseRow(f.y);
    // Nothing that is still visible refers to B2 or Y, although both are intact in CAS. Invert this to
    // fail closed when a CAS-anchored current relation exists.
    expect(await readBack(f)).toMatchObject({ ok: true, assessmentArtifactId: f.x });
  });
});
