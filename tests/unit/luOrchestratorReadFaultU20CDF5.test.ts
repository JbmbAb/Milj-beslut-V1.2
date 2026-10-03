/**
 * W-U20CDF5 group B -- the five OPEN_NOT_FIXED catches W-CATCH2 left in the orchestrator (CATCH2-REPORT
 * section 11; owner decisions 2026-10-02/03: a read fault is never "missing", never "not authorized", never
 * "not bound" and never raw text; retryable derived from the shared class -- readFaultClassification.ts, the
 * ONE classification):
 *   B1 assertProjectAccess: only the access check's own typed denial is 403; a database that cannot answer
 *      is 503 PROJECT_ACCESS_UNRESOLVED (READ_ERROR, retryable);
 *   B2 the map's presentation failure: a typed code and a neutral text, never the raw message (ids, paths);
 *   B3 the contract-version refusal: ASSESSMENT_CONTRACT_REFUSED with its neutral text, never the raw message;
 *   B4 authorizeAssessmentPresentation: a read fault (index, CAS, access facts) is never "not bound";
 *   B5 the PDF's property/project context: a read fault never becomes "kunde inte läsas"/"saknas" in a built
 *      PDF -- typed fail-closed, no PDF; only a PROVEN absence is printed as absent.
 *
 * Same hermetic chain as luRecordIntegrityEpochU20CDF5 (real router + orchestrator over an in-memory CAS, real
 * owner-signed binding; H15 MOCKED, the real H15 is not run; the ViewerKernel presentation mocked and made to
 * fail on demand). All error texts and paths below are invented.
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
const faults = vi.hoisted(() => ({
  /** Per assertProjectMembership call, in order: undefined = access granted, a factory = that error thrown. */
  access: [] as Array<(() => unknown) | undefined>,
  /** When set, the (mocked) ViewerKernel presentation throws what this returns. */
  presentation: null as null | (() => unknown),
  /** W-U20CDF5-add: the (mocked) presentation reports this assessment id instead of the requested one. */
  presentationReturnsId: null as null | string,
  /** validateLocalizationAssessmentContractVersion throws on exactly this call number (0 = never). */
  contractRefuseOnCall: 0,
  contractCalls: 0,
  /** When set, the binding index's resolve(projectId, contextRef) answers through this. */
  bindingResolve: null as null | ((projectId: string, context: unknown) => Promise<string>),
}));
vi.mock('../../server/repositories/projectAccessRepository', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertProjectMembership: vi.fn(async () => {
    const fault = faults.access.shift();
    if (fault) throw fault();
  }),
}));
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
}));
const spies = vi.hoisted(() => ({ reExecute: vi.fn(), buildPdf: vi.fn(), present: vi.fn() }));

vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MimersIntegration: { create: vi.fn(async () => ({ artifactRepository: state.repository })) },
}));
vi.mock('@miljobeslut/mps-lu', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    validateLocalizationAssessmentContractVersion: (payload: unknown) => {
      faults.contractCalls += 1;
      if (faults.contractCalls === faults.contractRefuseOnCall) {
        throw new Error('REJECT_LOCALIZATION_ASSESSMENT_V3: canonicalizer_id mismatch at C:\cas\objects\ab (assessment-raw-id)');
      }
      return (original.validateLocalizationAssessmentContractVersion as (p: unknown) => void)(payload);
    },
    // MOCKED H15: always PASS. The real re-execution is not run by this suite.
    reExecuteLocalizationAssessment: (args: unknown) => {
      spies.reExecute(args);
      return { outcome: 'PASS', assessment_artifact_id: (args as { assessmentArtifactId: string }).assessmentArtifactId, mismatches: [], notices: [] };
    },
  };
});
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    register(...args: unknown[]) { return (state.bindingIndex as { register: (...a: unknown[]) => unknown }).register(...args); }
    resolve(...args: unknown[]) {
      if (faults.bindingResolve) return faults.bindingResolve(args[0] as string, args[1]);
      return (state.bindingIndex as { resolve: (...a: unknown[]) => unknown }).resolve(...args);
    }
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
vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: async (...args: unknown[]) => {
    spies.buildPdf(...args);
    return Buffer.from('fake-pdf-bytes-for-test');
  },
}));
vi.mock('../../server/modules/localization/createLocalizationViewerRuntime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveLocalizationViewerRuntimeConfigForProject: vi.fn(async (projectId: string) => ({
    capabilityArtifactId: 'capability-u20cdf5', expectedProjectId: projectId, expectedContextBindingId: 'x',
    expectedViewerIdentityId: 'x', expectedReleaseId: 'x', expectedReleaseHash: 'x',
  })),
}));
vi.mock('../../server/modules/localization/resolveGovernedLocalizationPresentation', () => ({
  resolveGovernedLocalizationPresentation: vi.fn(async (args: { assessmentArtifactId: string }) => {
    spies.present(args);
    if (faults.presentation) throw faults.presentation();
    return { geojson: { type: 'FeatureCollection', features: [] }, assessmentArtifactId: faults.presentationReturnsId ?? args.assessmentArtifactId, capabilityArtifactId: 'capability-u20cdf5' };
  }),
}));
vi.mock('../../server/services/auditTrailService', () => ({ auditTrail: { logAction: vi.fn(async () => undefined) }, getAuditTrail: vi.fn(async () => []) }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import express from 'express';
import request from 'supertest';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '../../packages/mps-compliance/src/artifacts/ArtifactReference';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import {
  buildSpatialEvidenceContentHash,
  createCanonicalPropertyGeometryArtifact,
  createGovernedLocalizationAssessment,
  createProductLuPropertyContextArtifact,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectPropertyBindingArtifact,
  createPropertyLookupObservationArtifact,
  localizationAssessmentCanonicalBody,
  SPATIAL_STACK_V1,
  type AssessmentFinding,
} from '@miljobeslut/mps-lu';
import { resolveGovernedAssessmentDetails } from '../../server/modules/localization/governedEvidenceDetails';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { installOwnerIssuedProjectContextBinding } from '../../server/modules/localization/installProjectContextBinding';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import { ProjectAccessDeniedError } from '../../server/repositories/projectAccessRepository';
import { LuReadFaultError, readFaultOfClass } from '../../server/modules/localization/readFaultClassification';

/** In-memory CAS. `failFirstRead` makes the next N reads of one id fail with the given error. */
class FaultyMemoryRepository {
  readonly values = new Map<string, unknown>();
  readonly failures = new Map<string, { remaining: number; error: () => unknown }>();
  readonly reads: string[] = [];
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  failFirstRead(id: string, error: () => unknown, times = 1): void {
    this.failures.set(id, { remaining: times, error });
  }
  /** W-U20CDF5-add: the `onRead`-th read of `id` returns the stored body of `toId` (a misdirected index entry). */
  readonly misdirections = new Map<string, { onRead: number; toId: string }>();
  readonly readCounts = new Map<string, number>();
  misdirectRead(id: string, onRead: number, toId: string): void {
    this.misdirections.set(id, { onRead, toId });
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    this.reads.push(reference.artifact_id);
    const failure = this.failures.get(reference.artifact_id);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error();
    }
    const count = (this.readCounts.get(reference.artifact_id) ?? 0) + 1;
    this.readCounts.set(reference.artifact_id, count);
    const misdirection = this.misdirections.get(reference.artifact_id);
    const value = this.values.get(misdirection && misdirection.onRead === count ? misdirection.toId : reference.artifact_id);
    if (!value) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return structuredClone(value) as T;
  }
}

class MemoryBindingIndex implements ProjectContextBindingIndex {
  private readonly byProjectAndContext = new Map<string, string>();
  private readonly bindingsByProject = new Map<string, ArtifactReference[]>();
  private readonly contextsByProject = new Map<string, ArtifactReference[]>();
  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    this.byProjectAndContext.set(`${binding.payload.project_id}:${binding.payload.project_context_ref.artifact_id}`, binding.artifact_id);
    this.contextsByProject.set(binding.payload.project_id, [...(this.contextsByProject.get(binding.payload.project_id) ?? []), binding.payload.project_context_ref]);
    const list = this.bindingsByProject.get(binding.payload.project_id) ?? [];
    list.push({ artifact_id: binding.artifact_id, artifact_type: binding.artifact_type });
    this.bindingsByProject.set(binding.payload.project_id, list);
  }
  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const id = this.byProjectAndContext.get(`${projectId}:${context.artifact_id}`);
    if (!id) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
    return id;
  }
  async registerSupersession(): Promise<void> {}
  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.bindingsByProject.get(projectId) ?? [];
  }
  async listSupersessionRefs(): Promise<readonly ArtifactReference[]> {
    return [];
  }
  async findProjectContextRef(projectId: string): Promise<ArtifactReference> {
    const refs = this.contextsByProject.get(projectId) ?? [];
    if (refs.length !== 1) throw new Error('no unique binding');
    return refs[0]!;
  }
}

class MemoryProjectionIndex implements ProjectAssessmentProjectionIndex {
  private readonly rows: ProjectAssessmentProjectionRow[] = [];
  async register(row: {
    projectId: string; assessmentArtifactId: string; assessmentArtifactType: string;
    projectContextRef: ArtifactReference; bindingArtifactId: string; releaseArtifactId: string;
    localizationGeometryArtifactId?: string | null;
  }): Promise<void> {
    this.rows.push({
      projectId: row.projectId, assessmentArtifactId: row.assessmentArtifactId, assessmentArtifactType: row.assessmentArtifactType,
      projectContextRefId: row.projectContextRef.artifact_id, projectContextRefType: row.projectContextRef.artifact_type,
      bindingArtifactId: row.bindingArtifactId, releaseArtifactId: row.releaseArtifactId,
      localizationGeometryArtifactId: row.localizationGeometryArtifactId ?? null, createdAt: new Date(1000 * (this.rows.length + 1)),
    });
  }
  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    return this.rows.filter((r) => r.projectId === projectId).reverse();
  }
}

const PROJECT_ID = 'project-u20cdf5-b';
const CONTEXT = { artifact_id: 'lu-context-u20cdf5', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const PROPERTY_REF = { artifact_id: 'property-u20cdf5', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const PROPERTY_BINDING = { artifact_id: 'project-property-binding-u20cdf5', artifact_type: 'project_property_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-u20cdf5', artifact_type: 'product_release' } as const;
const LOCATION_REF = { artifact_id: 'localization-geometry-u20cdf5', artifact_type: 'localization_geometry' } as const;
const HASH = '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc';
const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
const issuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-u20cdf5-b');
const verification = new LocalPemVerificationKeyProvider(issuerKey.provider.keyId, issuerKey.publicKey);
const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });

/** A content-addressed NEGATIVE spatial evidence for one layer (V3 query contract). */
function negativeEvidence(dataset: string) {
  const payload = {
    result_semantics: {
      kind: 'EXISTENCE_WITHIN_DISTANCE',
      query: { subject_ref: PROPERTY_REF, srid: 3006, distance_meters: 500 },
      result: { exists: false, match_count_observed: 0, max_features_per_layer: 50 },
    },
    property_ref: PROPERTY_REF,
    srid: 3006,
    operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
    geometry: null,
    layer_ref: { layer_id: dataset, version_hash: HASH, layer_version: 'v1.0' },
    source_metadata: { provider: 'Provider', dataset, dataset_version: HASH, retrieved_at: '2026-10-02T10:00:00.000Z' },
    query_contract: {
      query_contract_version: 'spatial-query-contract-v3',
      spatial_canonical_version: 'sv-canonical-3',
      relation: 'DWITHIN',
      subject: { kind: 'LOCALIZATION_GEOMETRY', property_context_ref: PROPERTY_REF, location_ref: LOCATION_REF, crs: 'EPSG:3006' },
      parameters: { distance_meters: 500, max_features_per_layer: 50 },
      selection: { predicate_semantics: 'EXISTS' },
    },
  };
  const content_hash = buildSpatialEvidenceContentHash(payload as never);
  return { artifact_id: `evidence-${dataset}-${content_hash.value.slice(0, 16)}`, artifact_type: 'SPATIAL_EVIDENCE' as const, content_hash, references: [PROPERTY_REF], payload };
}
const NEGATIVES = LAYERS.map(negativeEvidence);
const WATER_EVIDENCE = NEGATIVES[0]!;
const ref = (a: { artifact_id: string; artifact_type: string }) => ({ artifact_id: a.artifact_id, artifact_type: a.artifact_type });

const eio = () => Object.assign(new Error('EIO: i/o error, read C:\\cas\\objects\\ab\\cd (transient)'), { code: 'EIO' });

/** Stored finding with a severity outside the governed values: an integrity break visible WITHOUT reading evidence. */
const UNKNOWN_SEVERITY = {
  finding_id: 'finding-ebh-critical', rule_id: 'LU-EBH-001', rule_version: '2.0', risk_level: 'CRITICAL', explanation: 'x', evidence_refs: [],
} as unknown as AssessmentFinding;

/** A content-addressed spatial evidence for one layer: a hit (exists:true, 2 matches) or a negative. */
function layerEvidence(dataset: string, exists: boolean) {
  if (!exists) return negativeEvidence(dataset);
  const base = negativeEvidence(dataset);
  const payload = {
    ...base.payload,
    result_semantics: { ...base.payload.result_semantics, result: { exists: true, match_count_observed: 2, max_features_per_layer: 50 } },
  };
  const content_hash = buildSpatialEvidenceContentHash(payload as never);
  return { ...base, artifact_id: `evidence-${dataset}-${content_hash.value.slice(0, 16)}`, content_hash, payload };
}

type Version = 'V1' | 'V2' | 'V3' | 'V4';
type Stored = { artifact_id: string; content_hash: unknown; payload: Record<string, unknown> };

/** Re-addresses an assessment after a payload edit: content_hash and artifact_id from the canonical body. */
function readdress(assessment: Stored): Stored {
  const content_hash = sha256ContentHash(localizationAssessmentCanonicalBody(assessment as never));
  return { ...assessment, content_hash, artifact_id: `assessment-${content_hash.value}` };
}

/**
 * Stores a record of the given contract version: `negatives` / `hits` name the layers that get a pinned
 * evidence; `findings: 'ABSENT'` stores a payload without a findings field, `rawFindings` any value.
 */
async function provisionRecord(input: {
  readonly version: Version;
  readonly negatives: readonly string[];
  readonly hits?: readonly string[];
  readonly findings: readonly unknown[] | 'ABSENT';
  readonly rawFindings?: unknown;
}) {
  const repository = new FaultyMemoryRepository();
  const bindingIndex = new MemoryBindingIndex();
  const projectionIndex = new MemoryProjectionIndex();
  await repository.put({ artifact_id: issuer.artifact_id, body: issuer });
  const unsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: CONTEXT, project_property_binding_ref: PROPERTY_BINDING,
    binding_version: 'project-context-binding-v2', authority_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    created_at: '2026-10-02T00:00:00.000Z',
  });
  const binding = { ...unsigned, attestation: await attestProjectContextBindingArtifact({ artifact: unsigned, issuer, signing: issuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository as never, index: bindingIndex, binding, verification });
  const evidence = [...input.negatives.map((l) => layerEvidence(l, false)), ...(input.hits ?? []).map((l) => layerEvidence(l, true))];
  for (const e of evidence) await repository.put({ artifact_id: e.artifact_id, body: e });
  const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `u20cdf5-epoch-${Math.random()}` });
  security.bindPrincipal('lu.site_assessment.actor');
  const outcome = {
    outcome_id: `outcome-u20cdf5-epoch-${Math.random()}`, artifact_type: 'execution_outcome' as const,
    attempt_ref: { artifact_id: 'attempt-u20cdf5-epoch', artifact_type: 'execution_attempt' },
    result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
  };
  const created = createGovernedLocalizationAssessment({
    draft: { site_id: 'site-u20cdf5-epoch', project_context_ref: CONTEXT, property_ref: PROPERTY_REF, evidence_refs: evidence.map(ref), system_summary: 'U20CDF5 epoch' },
    findings: (input.findings === 'ABSENT' ? [] : input.findings) as AssessmentFinding[], outcome, attestation: security.attestOutcome(outcome.content_hash),
  });
  const payload: Record<string, unknown> = { ...created.payload };
  if (input.findings === 'ABSENT') delete payload.findings;
  if (input.rawFindings !== undefined) payload.findings = input.rawFindings;
  if (input.version === 'V1') {
    delete payload.assessment_contract_version;
    delete payload.canonicalizer_id;
  } else if (input.version === 'V2') {
    payload.assessment_contract_version = 'localization-assessment-v2';
  } else if (input.version === 'V4') {
    payload.assessment_contract_version = 'localization-assessment-v4';
    payload.authority_evidence_ref = { artifact_id: 'authority-evidence-u20cdf5', artifact_type: 'authority_evidence' };
  }
  const assessment = readdress({ ...(created as unknown as Stored), payload });
  await repository.put({ artifact_id: assessment.artifact_id, body: assessment });
  await registerAssessmentProjection({
    projectId: PROJECT_ID, assessment: assessment as never, contextBindingRef: { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type },
    releaseRef: RELEASE_REF, index: projectionIndex,
  });
  state.repository = repository;
  state.bindingIndex = bindingIndex;
  state.projectionIndex = projectionIndex;
  state.verification = verification;
  return { assessment, repository };
}

const app = express();
app.use(express.json());
app.use(localizationRoutes);
const token = createTokenPair({ id: 'user-u20cdf5-epoch', organisationId: 'org-u20cdf5', bankidId: 'bankid:u20cdf5-epoch', role: 'ADMIN' }).accessToken;
const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path: string) => request(app).post(path).set('Authorization', `Bearer ${token}`).send({});
const PATHS = {
  verify: () => post(`/api/localization/${PROJECT_ID}/verify-assessment`),
  map: () => get(`/api/localization/${PROJECT_ID}/viewer/evidence`),
  readBack: () => get(`/api/localization/${PROJECT_ID}/current-assessment`),
  pdf: () => get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`),
} as const;
const ALL: readonly string[] = LAYERS;
const RULE: Readonly<Record<string, string>> = {
  water: 'LU-WATER-001', ebh: 'LU-EBH-001', protected_area: 'LU-PROTECTED-001', natura2000: 'LU-NATURA2000-001', water_protection_area: 'LU-WATERPROTECTION-001',
};

beforeEach(() => {
  hermeticPrismaTouches.length = 0;
  faults.access = [];
  faults.presentation = null;
  faults.presentationReturnsId = null;
  faults.contractRefuseOnCall = 0;
  faults.contractCalls = 0;
  faults.bindingResolve = null;
  spies.reExecute.mockClear();
  spies.buildPdf.mockClear();
  spies.present.mockClear();
});
afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

function expectIntegrity424(res: request.Response, reasonCode: string) {
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(424);
  expect(res.body).toMatchObject({ ok: false, code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR', failureClass: 'RECORD_INTEGRITY_ERROR', reasonCode, retryable: false });
  expect(res.body.record_integrity).toMatchObject({ authoritative: false, verified: false });
  expect(JSON.stringify(res.body)).not.toMatch(/PASS|Reproducerbarhet verifierad|historisk/);
}



const prismaDown = () =>
  Object.assign(new Error("Can't reach database server at db.internal:5432 postgresql://mimer:hemligtB@db.internal:5432/lu"), {
    name: 'PrismaClientInitializationError',
    errorCode: 'P1001',
  });
const denied = () => new ProjectAccessDeniedError('User is not a member of this project');
const RAW = /hemligt|postgresql|db\.internal|cas\\\\objects|C:\\\\|EIO|REJECT_|assessment-raw-id|canonicalizer|evidence-water-secretid|binding-not-in-cas|Artifact not found/;

function expectNoRawText(res: request.Response) {
  expect(JSON.stringify(res.body.error ?? ''), JSON.stringify(res.body)).not.toMatch(RAW);
}

/** The project and property context the PDF reads for names (bodies as the PDF reads them). */
async function putContexts(repository: FaultyMemoryRepository) {
  await repository.put({
    artifact_id: PROPERTY_REF.artifact_id,
    body: { artifact_id: PROPERTY_REF.artifact_id, artifact_type: PROPERTY_REF.artifact_type, payload: { property_ref: 'GÄVLE TEST 1:1', official_name: 'Gävle Test 1:1', municipality: 'Gävle' } },
  });
  await repository.put({
    artifact_id: CONTEXT.artifact_id,
    body: { artifact_id: CONTEXT.artifact_id, artifact_type: CONTEXT.artifact_type, payload: { project_name: 'Projekt B-test', description: 'Testprojekt' } },
  });
}

const pdfDataOf = () => (spies.buildPdf.mock.calls.at(-1)?.[2] ?? null) as Record<string, any> | null;

describe('W-U20CDF5 B1: assertProjectAccess -- 403 only for the typed denial; a database that cannot answer is 503 PROJECT_ACCESS_UNRESOLVED', () => {
  it.each(['readBack', 'pdf', 'verify', 'map'] as const)('%s: the membership read fails (database down) -> 503 PROJECT_ACCESS_UNRESOLVED, READ_ERROR, retryable; nothing read, replayed or built', async (path) => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.access = [prismaDown];
    const res = await PATHS[path]();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, code: 'PROJECT_ACCESS_UNRESOLVED', failureClass: 'READ_ERROR', reasonCode: 'READ_ERROR', retryable: true });
    expect(res.body.error).toMatch(/^Behörigheten till projektet kunde inte läsas \(tekniskt fel\)\. Ett nytt försök kan lyckas\./);
    expectNoRawText(res);
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(spies.buildPdf).not.toHaveBeenCalled();
    expect(spies.present).not.toHaveBeenCalled();
  });

  it.each(['readBack', 'pdf', 'verify', 'map'] as const)('%s: the access check DENIES (typed) -> 403 "Not authorized for this project." (unchanged)', async (path) => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.access = [denied];
    const res = await PATHS[path]();
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false, error: 'Not authorized for this project.' });
  });
});

describe('W-U20CDF5 B4: authorizeAssessmentPresentation -- a read fault is never "not bound"', () => {
  it.each(['readBack', 'pdf', 'verify'] as const)('%s: the binding index cannot answer (database down) -> 503 ASSESSMENT_BINDING_UNRESOLVED, READ_ERROR, retryable', async (path) => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.bindingResolve = async () => { throw prismaDown(); };
    const res = await PATHS[path]();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR', retryable: true });
    expect(res.body.error).toMatch(/^Bedömningens koppling till projektet kunde inte läsas \(tekniskt fel\)\. Ett nytt försök kan lyckas\./);
    expectNoRawText(res);
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('the index names a binding the CAS does not hold -> 503 MISSING_FROM_CAS, not retryable (lost storage, never "not bound")', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.bindingResolve = async () => 'binding-not-in-cas';
    const res = await PATHS.readBack();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'MISSING_FROM_CAS', retryable: false });
    expectNoRawText(res);
  });

  it('the binding read fails with EIO -> 503 READ_ERROR, retryable', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.bindingResolve = async () => 'binding-eio';
    repository.failFirstRead('binding-eio', eio, 99);
    const res = await PATHS.verify();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR', retryable: true });
    expect(spies.reExecute).not.toHaveBeenCalled();
  });

  it('the access re-check inside the authorisation cannot read the membership -> 503 PROJECT_ACCESS_UNRESOLVED (never "not bound")', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.access = [undefined, prismaDown];
    const res = await PATHS.readBack();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'PROJECT_ACCESS_UNRESOLVED', failureClass: 'READ_ERROR', retryable: true });
  });

  it('the access re-check DENIES (typed) -> 403', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.access = [undefined, denied];
    const res = await PATHS.readBack();
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false, error: 'Not authorized for this project.' });
  });

  it('mutation B4-PHASE: an unknown failure READING the binding index (no stable code) is a read of unknown persistence -> 503 READ_ERROR, never "not bound"', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.bindingResolve = async () => { throw new Error('socket hang up while reading the binding row'); };
    const res = await PATHS.readBack();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR', retryable: true });
    expect(JSON.stringify(res.body)).not.toContain('socket hang up');
  });

  it('control: the index has no binding for the assessment\'s context (a refusal) -> 424 "not bound" (unchanged)', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.bindingResolve = async () => { throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE'); };
    const res = await PATHS.readBack();
    expect(res.status).toBe(424);
    expect(res.body).toEqual({ ok: false, error: 'Governed LU assessment is not bound to this project.' });
  });
});

describe('W-U20CDF5 B2: a presentation failure on the map is typed with a neutral text -- never the raw message', () => {
  it('a verification refusal (tampered evidence) -> 424 VIEWER_PRESENTATION_UNRESOLVED, REFUSED, not retryable, no id or REJECT token in the text', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.presentation = () => new Error('REJECT_LOCALIZATION_PRESENTATION: evidence content_hash mismatch for evidence-water-secretid');
    const res = await PATHS.map();
    expect(res.status).toBe(424);
    expect(res.body).toMatchObject({ ok: false, code: 'VIEWER_PRESENTATION_UNRESOLVED', failureClass: 'REFUSED', reasonCode: 'REJECT_LOCALIZATION_PRESENTATION', retryable: false });
    expectNoRawText(res);
  });

  it('a read error (EIO) -> 503 VIEWER_PRESENTATION_UNRESOLVED, READ_ERROR, retryable; no path', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.presentation = eio;
    const res = await PATHS.map();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'VIEWER_PRESENTATION_UNRESOLVED', failureClass: 'READ_ERROR', reasonCode: 'READ_ERROR', retryable: true });
    expectNoRawText(res);
  });

  it('pinned evidence the CAS does not hold -> 503 MISSING_FROM_CAS, not retryable (never "missing" as absence)', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.presentation = () => new Error('Artifact not found: evidence-water-secretid');
    const res = await PATHS.map();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'VIEWER_PRESENTATION_UNRESOLVED', failureClass: 'MISSING_FROM_CAS', retryable: false });
    expectNoRawText(res);
  });

  it('a typed capability read fault keeps its own route mapping: 503 VIEWER_CAPABILITY_UNRESOLVED, never a raw 424', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.presentation = () => new LuReadFaultError('viewer-capability', readFaultOfClass('READ_ERROR'), eio());
    const res = await PATHS.map();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'VIEWER_CAPABILITY_UNRESOLVED', failureClass: 'READ_ERROR', retryable: true });
    expectNoRawText(res);
  });

  it('the presentation\'s own access check DENIES (typed) -> 403', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    faults.presentation = denied;
    const res = await PATHS.map();
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false, error: 'Not authorized for this project.' });
  });
});

describe('W-U20CDF5 B3: a contract-version refusal is ASSESSMENT_CONTRACT_REFUSED with its neutral text -- never the raw message', () => {
  it.each(['readBack', 'pdf', 'verify'] as const)('%s: the record follows no accepted contract at the point of use -> 424 ASSESSMENT_CONTRACT_REFUSED / ASSESSMENT_CONTRACT_INVALID, the REJECT token as reasonCode', async (path) => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    // Call 1 is the selection (resolveCurrentAssessmentProjection), call 2 the point of use.
    faults.contractRefuseOnCall = 2;
    const res = await PATHS[path]();
    expect(faults.contractCalls).toBeGreaterThanOrEqual(2);
    expect(res.status).toBe(424);
    expect(res.body).toEqual({
      ok: false,
      error:
        'Projektets aktuella bedömning kan inte visas: den följer inget godkänt bedömningskontrakt (okänd eller ogiltig ' +
        'kontraktsversion). En äldre bedömning visas aldrig i stället. Felet är bestående och löses inte av ett nytt försök. ' +
        'Kontakta systemets administratör.',
      code: 'ASSESSMENT_CONTRACT_REFUSED',
      failureClass: 'ASSESSMENT_CONTRACT_INVALID',
      reasonCode: 'REJECT_LOCALIZATION_ASSESSMENT_V3',
      retryable: false,
    });
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });
});

describe('W-U20CDF5 B5: the PDF\'s property and project context -- a read fault is never printed as absent; only a proven absence is', () => {
  it('control: both contexts present -> the PDF names the property and the project', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    const res = await PATHS.pdf();
    expect(res.status).toBe(200);
    expect(pdfDataOf()).toMatchObject({
      property: { property_ref: 'GÄVLE TEST 1:1', official_name: 'Gävle Test 1:1', municipality: 'Gävle' },
      project: { project_name: 'Projekt B-test', description: 'Testprojekt' },
    });
  });

  it('the property context cannot be read (EIO) -> 503 ASSESSMENT_PDF_CONTEXT_UNRESOLVED, READ_ERROR, retryable; NO PDF is built', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    repository.failFirstRead(PROPERTY_REF.artifact_id, eio, 99);
    const res = await PATHS.pdf();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, code: 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', failureClass: 'READ_ERROR', reasonCode: 'READ_ERROR', retryable: true });
    expect(res.body.error).toMatch(/^Bedömningens fastighetskontext kunde inte läsas \(tekniskt fel\)\. Ett nytt försök kan lyckas\./);
    expectNoRawText(res);
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('the project context is corrupt in CAS (lasting) -> 503 STORAGE_INTEGRITY_FAULT, not retryable; NO PDF', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    repository.failFirstRead(CONTEXT.artifact_id, () => Object.assign(new Error('digest mismatch C:\\cas\\objects\\cd'), { name: 'CASIntegrityError' }), 99);
    const res = await PATHS.pdf();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', failureClass: 'STORAGE_INTEGRITY_FAULT', retryable: false });
    expect(res.body.error).toMatch(/^Bedömningens projektkontext /);
    expectNoRawText(res);
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('a PROVEN absence (the repository\'s exact "never stored" for that id) is printed as absent -- in its own words', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    const res = await PATHS.pdf();
    expect(res.status).toBe(200);
    expect(pdfDataOf()).toMatchObject({
      property: { note: 'Fastighetskontexten som bedömningen refererar till finns inte i arkivet (bevisat saknad). Fastighetens beteckning, namn och kommun anges därför inte.' },
      project: { note: 'Projektkontexten som bedömningen refererar till finns inte i arkivet (bevisat saknad). Projektets namn och beskrivning anges därför inte.' },
    });
  });
});

/** W-U20CDF5-add: a second VALID, self-consistent V3 assessment of the same project, context and property (all five layers answered). */
async function storeOtherValidAssessment(repository: FaultyMemoryRepository) {
  const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `u20cdf5-add-${Math.random()}` });
  security.bindPrincipal('lu.site_assessment.actor');
  const outcome = {
    outcome_id: `outcome-u20cdf5-add-${Math.random()}`, artifact_type: 'execution_outcome' as const,
    attempt_ref: { artifact_id: 'attempt-u20cdf5-add', artifact_type: 'execution_attempt' },
    result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
  };
  const other = createGovernedLocalizationAssessment({
    draft: { site_id: 'site-u20cdf5-other', project_context_ref: CONTEXT, property_ref: PROPERTY_REF, evidence_refs: ALL.map((l) => ref(layerEvidence(l, false))), system_summary: 'U20CDF5-add: ANOTHER valid assessment' },
    findings: [], outcome, attestation: security.attestOutcome(outcome.content_hash),
  });
  await repository.put({ artifact_id: other.artifact_id, body: other });
  return other;
}

const MISDIRECTED = { code: 'ASSESSMENT_READ_ERROR', failureClass: 'ASSESSMENT_STORAGE_INTEGRITY_FAULT', reasonCode: 'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT', retryable: false };

describe('W-U20CDF5-add: the assessment read under the selected id must BE that assessment -- a misdirected index entry never yields another, self-consistent assessment', () => {
  it.each(['readBack', 'pdf', 'verify'] as const)('%s: the read of the current assessment returns ANOTHER valid assessment -> 503 ASSESSMENT_READ_ERROR / ASSESSMENT_STORAGE_INTEGRITY_FAULT, not retryable; the other assessment is never presented, replayed or exported', async (path) => {
    const { assessment, repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    const other = await storeOtherValidAssessment(repository);
    // Read 1 is the selection (resolveCurrentAssessmentProjection); read 2 is the point of use.
    repository.misdirectRead(assessment.artifact_id, 2, other.artifact_id);
    const res = await PATHS[path]();
    expect(repository.readCounts.get(assessment.artifact_id)).toBeGreaterThanOrEqual(2);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, ...MISDIRECTED });
    expect(JSON.stringify(res.body)).not.toContain(other.artifact_id);
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('map: the presentation reports ANOTHER assessment than the selected one -> the same typed 503, never 200', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    const other = await storeOtherValidAssessment(repository);
    faults.presentationReturnsId = other.artifact_id;
    const res = await PATHS.map();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject(MISDIRECTED);
  });

  it('map: the presentation is right but the own re-read of the map returns ANOTHER valid assessment -> the same typed 503 (it was an untyped "tamper" 424)', async () => {
    const { assessment, repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    const other = await storeOtherValidAssessment(repository);
    repository.misdirectRead(assessment.artifact_id, 2, other.artifact_id);
    const res = await PATHS.map();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject(MISDIRECTED);
  });

  it('control (no over-closing): a legitimate read -> 200 on read-back, verify and map', async () => {
    const { assessment, repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await storeOtherValidAssessment(repository);
    const readBack = await PATHS.readBack();
    expect(readBack.status).toBe(200);
    expect(readBack.body.assessmentArtifactId).toBe(assessment.artifact_id);
    expect((await PATHS.verify()).status).toBe(200);
    expect((await PATHS.map()).status).toBe(200);
  });

  it('control (no over-closing): a PROVEN absence at the point of use is still 404 "no current assessment"', async () => {
    const { assessment, repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    // Read 1 (the selection) sees it; read 2 gets the repository's exact "never stored" for exactly that id.
    repository.misdirectRead(assessment.artifact_id, 2, 'id-that-was-never-stored');
    const res = await PATHS.readBack();
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'No current governed LU assessment is available for this project.' });
  });

  it('control (no over-closing): two valid current assessments for the same binding and point stay 409 ASSESSMENT_CURRENT_AMBIGUOUS', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    const other = await storeOtherValidAssessment(repository);
    const [bindingRef] = await (state.bindingIndex as MemoryBindingIndex).listBindingRefs(PROJECT_ID);
    await registerAssessmentProjection({
      projectId: PROJECT_ID, assessment: other, contextBindingRef: { artifact_id: bindingRef!.artifact_id, artifact_type: bindingRef!.artifact_type },
      releaseRef: RELEASE_REF, index: state.projectionIndex as MemoryProjectionIndex,
    });
    const res = await PATHS.readBack();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_CURRENT_UNRESOLVED', failureClass: 'ASSESSMENT_CURRENT_AMBIGUOUS' });
  });
});

/** W-U20CDF5-R2 (G): another, valid-looking context object -- what a misdirected index entry would hand back. */
async function putOtherContexts(repository: FaultyMemoryRepository) {
  await repository.put({
    artifact_id: 'other-property-context',
    body: { artifact_id: 'other-property-context', artifact_type: PROPERTY_REF.artifact_type, payload: { property_ref: 'FEL 9:9', official_name: 'Fel fastighet', municipality: 'Felkommun' } },
  });
  await repository.put({
    artifact_id: 'other-project-context',
    body: { artifact_id: 'other-project-context', artifact_type: CONTEXT.artifact_type, payload: { project_name: 'Fel projekt', description: 'Fel' } },
  });
}

describe('W-U20CDF5-R2 G (verifier probes B5b, Gc): a context object read under another id never puts a wrong property or project into the PDF or the read-back', () => {
  it('PDF: the property context read returns ANOTHER context -> 503 ASSESSMENT_PDF_CONTEXT_UNRESOLVED, STORAGE_INTEGRITY_FAULT, not retryable; no PDF with the wrong name', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    await putOtherContexts(repository);
    // Read 1 is the read-back's property root, read 2 the PDF's own context read.
    repository.misdirectRead(PROPERTY_REF.artifact_id, 2, 'other-property-context');
    const res = await PATHS.pdf();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, code: 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', failureClass: 'STORAGE_INTEGRITY_FAULT', retryable: false });
    expect(res.body.error).toMatch(/^Bedömningens fastighetskontext /);
    expect(spies.buildPdf).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/FEL 9:9|Fel fastighet|Felkommun/);
  });

  it('PDF: the project context read returns ANOTHER context -> the same typed 503; no PDF', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    await putOtherContexts(repository);
    repository.misdirectRead(CONTEXT.artifact_id, 1, 'other-project-context');
    const res = await PATHS.pdf();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', failureClass: 'STORAGE_INTEGRITY_FAULT', retryable: false });
    expect(res.body.error).toMatch(/^Bedömningens projektkontext /);
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('PDF: the project context is filed under ANOTHER artifact_type (same id) -> the same typed 503; no PDF', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    const stored = repository.values.get(CONTEXT.artifact_id) as Record<string, unknown>;
    await repository.put({ artifact_id: CONTEXT.artifact_id, body: { ...stored, artifact_type: 'MISFILED_TYPE' } });
    const res = await PATHS.pdf();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', failureClass: 'STORAGE_INTEGRITY_FAULT', retryable: false });
    expect(res.body.error).toMatch(/^Bedömningens projektkontext /);
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('read-back: the property root reads ANOTHER property context -> never its designation; the read-back fails closed (424 ROOT_PROVENANCE_TAMPERED)', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    await putOtherContexts(repository);
    repository.misdirectRead(PROPERTY_REF.artifact_id, 1, 'other-property-context');
    const res = await PATHS.readBack();
    expect(res.status).toBe(424);
    expect(res.body).toMatchObject({ ok: false, code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED', failureClass: 'ROOT_PROVENANCE_TAMPERED' });
    expect(JSON.stringify(res.body)).not.toMatch(/FEL 9:9|Fel fastighet/);
  });

  it('control (no over-closing): legitimate contexts -> 200 PDF with the right names; a proven absence still prints its note', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    await putOtherContexts(repository);
    expect((await PATHS.readBack()).status).toBe(200);
    const res = await PATHS.pdf();
    expect(res.status).toBe(200);
    expect(pdfDataOf()).toMatchObject({ property: { official_name: 'Gävle Test 1:1' }, project: { project_name: 'Projekt B-test' } });
  });
});

describe('W-U20CDF5-R2 L4: a damaged context object or a record without its context ref is never printed as "saknas"', () => {
  it('a truncated project context (no payload) -> 503 ASSESSMENT_PDF_CONTEXT_UNRESOLVED, STORAGE_INTEGRITY_FAULT; no PDF of empty fields', async () => {
    const { repository } = await provisionRecord({ version: 'V3', negatives: ALL, findings: [] });
    await putContexts(repository);
    await repository.put({ artifact_id: CONTEXT.artifact_id, body: { artifact_id: CONTEXT.artifact_id, artifact_type: CONTEXT.artifact_type } });
    const res = await PATHS.pdf();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', failureClass: 'STORAGE_INTEGRITY_FAULT', retryable: false });
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('a V1 record without property_ref -> 409 ASSESSMENT_PDF_CONTEXT_UNRESOLVED (REFUSED, MALFORMED_RECORD_ENTRY); never "finns inte i arkivet (bevisat saknad)"', async () => {
    const { assessment, repository } = await provisionRecord({ version: 'V1', negatives: ALL, findings: [] });
    await putContexts(repository);
    // The same record without its property_ref, re-identified (a V1 record carries no contract to refuse it earlier).
    const { property_ref: _ref, ...payload } = (assessment as { payload: Record<string, unknown> }).payload;
    const without = readdress({ ...(assessment as unknown as Stored), payload });
    await repository.put({ artifact_id: without.artifact_id, body: without });
    const [bindingRef] = await (state.bindingIndex as MemoryBindingIndex).listBindingRefs(PROJECT_ID);
    const projectionIndex = new MemoryProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment: without as never, contextBindingRef: { artifact_id: bindingRef!.artifact_id, artifact_type: bindingRef!.artifact_type }, releaseRef: RELEASE_REF, index: projectionIndex });
    state.projectionIndex = projectionIndex;
    const res = await PATHS.pdf();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', failureClass: 'REFUSED', reasonCode: 'MALFORMED_RECORD_ENTRY', retryable: false });
    expect(res.body.error).toBe(
      'Bedömningens fastighetskontext underkändes vid verifieringen (bedömningen saknar en giltig referens till den). ' +
        'Felet är bestående och löses inte av ett nytt försök. Kontakta systemets administratör. ' +
        'Ingen PDF skapades: uppgiften redovisas aldrig som saknad när den inte gick att läsa.',
    );
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });
});

/**
 * W-U20CDF5-R2 (G, the rest of the property root): the product root chain -- context -> project-property binding ->
 * lookup observation -- as the bootstrap worker issues it, read by resolveGovernedAssessmentDetails over a CAS whose
 * entry for one link holds ANOTHER valid object (or the object under another type).
 */
async function productRoot() {
  const geometry = createCanonicalPropertyGeometryArtifact({ geometry: { type: 'Point', coordinates: [17.14, 60.67] } });
  const geometryRef = { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type };
  const observationFor = (designation: string, key: string) =>
    createPropertyLookupObservationArtifact({
      property_identity: `core.property_unit:${key}`, property_designation: designation, source_key: key,
      source_dataset: 'core.property_unit', source_updated_at: '2026-06-28T00:00:00.000Z', municipality: 'Gävle', geometry_ref: geometryRef,
    });
  const bindingFor = (observation: ReturnType<typeof observationFor>) =>
    createProjectPropertyBindingArtifact({
      project_id: PROJECT_ID, property_identity: observation.payload.property_identity, property_designation: observation.payload.property_designation,
      geometry_ref: geometryRef, source_refs: [{ artifact_id: observation.artifact_id, artifact_type: observation.artifact_type }],
      resolver_id: 'postgis-property-unit-exact', resolver_version: 'canonical-property-observation-v1', contract_version: 'project-property-binding-v1',
    });
  const observation = observationFor('GÄVLE TEST 1:1', 'u20cdf5-r2-key');
  const binding = bindingFor(observation);
  const context = createProductLuPropertyContextArtifact({
    property_identity: observation.payload.property_identity, property_ref: 'GÄVLE TEST 1:1', official_name: 'Gävle Test 1:1',
    geometry_ref: geometryRef, municipality: 'Gävle', coordinates: [60.67, 17.14],
    project_property_binding_ref: { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type },
  });
  const otherObservation = observationFor('FEL 9:9', 'u20cdf5-r2-other');
  const otherBinding = bindingFor(otherObservation);
  const repository = new FaultyMemoryRepository();
  for (const artifact of [geometry, observation, binding, context, otherObservation, otherBinding]) {
    await repository.put({ artifact_id: artifact.artifact_id, body: artifact });
  }
  const details = () =>
    resolveGovernedAssessmentDetails({
      assessment: { payload: { property_ref: { artifact_id: context.artifact_id, artifact_type: context.artifact_type }, evidence_refs: [], findings: [] } } as never,
      artifactRepository: repository as never,
    });
  return { repository, observation, binding, context, otherObservation, otherBinding, details };
}

describe('W-U20CDF5-R2 G (property root): every link of the root is the object it was read under -- id AND type', () => {
  it('control: the intact chain resolves to its own designation', async () => {
    const root = await productRoot();
    const read = await root.details();
    expect(read.integrity).toEqual({ ok: true });
    expect(read.propertyRoot).toMatchObject({ status: 'RESOLVED', property_designation: 'GÄVLE TEST 1:1', observation_artifact_id: root.observation.artifact_id });
  });

  it('the binding entry holds ANOTHER valid binding (another property): TAMPERED, never its designation (it was RESOLVED "FEL 9:9")', async () => {
    const root = await productRoot();
    root.repository.misdirectRead(root.binding.artifact_id, 1, root.otherBinding.artifact_id);
    const read = await root.details();
    expect(read.integrity).toEqual({ ok: false, failureClass: 'ROOT_PROVENANCE_TAMPERED', artifactId: root.context.artifact_id });
    expect(read.propertyRoot).toMatchObject({ status: 'TAMPERED', technical_error_class: 'ROOT_PROVENANCE_TAMPERED' });
    expect(JSON.stringify(read.propertyRoot)).not.toMatch(/FEL 9:9|u20cdf5-r2-other/);
  });

  it.each(['context', 'binding', 'observation'] as const)('the %s is stored under its id with ANOTHER artifact_type (a misfiled object): TAMPERED', async (link) => {
    const root = await productRoot();
    const object = root[link] as { artifact_id: string };
    await root.repository.put({ artifact_id: object.artifact_id, body: { ...object, artifact_type: 'MISFILED_TYPE' } });
    const read = await root.details();
    expect(read.propertyRoot).toMatchObject({ status: 'TAMPERED', technical_error_class: 'ROOT_PROVENANCE_TAMPERED' });
    expect(read.integrity).toMatchObject({ ok: false, failureClass: 'ROOT_PROVENANCE_TAMPERED' });
  });
});
