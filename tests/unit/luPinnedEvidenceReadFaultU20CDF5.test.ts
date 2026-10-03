/**
 * W-U20CDF5 (U20CDF4 verification M1; owner decisions 2026-10-03 (4) point 1 and (5): verify must never
 * PASS a record with an integrity error, the map must never treat it as a valid current assessment; a
 * read error is never absence and never a pass).
 *
 * The verifier's chain, hermetic: real router + requireAuth -> real localizationOrchestrator over an
 * in-memory CAS that can fail the FIRST read of one pinned evidence with EIO (a transient read fault), a
 * real owner-signed ProjectContextBinding and a real V3 LocalizationAssessmentArtifact. H15
 * (reExecuteLocalizationAssessment) is MOCKED -- a spy that answers PASS: the real H15 is NOT run here.
 * The map's ViewerKernel presentation is mocked too (its own suites), so the first evidence read on the
 * map path is the integrity pre-check's.
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
vi.mock('../../server/repositories/projectAccessRepository', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertProjectMembership: vi.fn(async () => undefined),
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
    return { geojson: { type: 'FeatureCollection', features: [] }, assessmentArtifactId: args.assessmentArtifactId, capabilityArtifactId: 'capability-u20cdf5' };
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
  createGovernedLocalizationAssessment,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  SPATIAL_STACK_V1,
  type AssessmentFinding,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { installOwnerIssuedProjectContextBinding } from '../../server/modules/localization/installProjectContextBinding';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { assessGovernedCoverage } from '../../server/modules/localization/governedCoverageStatement';
import { governedOverallStatement, resolveGovernedAssessmentDetails } from '../../server/modules/localization/governedEvidenceDetails';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

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
  /** W-U20CDF5-R2: the next read of `id` returns this body (e.g. a truncated object), once. */
  readonly servedOnce = new Map<string, unknown>();
  serveFirstRead(id: string, body: unknown): void {
    this.servedOnce.set(id, body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    this.reads.push(reference.artifact_id);
    const failure = this.failures.get(reference.artifact_id);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error();
    }
    if (this.servedOnce.has(reference.artifact_id)) {
      const served = this.servedOnce.get(reference.artifact_id);
      this.servedOnce.delete(reference.artifact_id);
      return structuredClone(served) as T;
    }
    const value = this.values.get(reference.artifact_id);
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

const PROJECT_ID = 'project-u20cdf5-m1';
const CONTEXT = { artifact_id: 'lu-context-u20cdf5', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const PROPERTY_REF = { artifact_id: 'property-u20cdf5', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const PROPERTY_BINDING = { artifact_id: 'project-property-binding-u20cdf5', artifact_type: 'project_property_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-u20cdf5', artifact_type: 'product_release' } as const;
const LOCATION_REF = { artifact_id: 'localization-geometry-u20cdf5', artifact_type: 'localization_geometry' } as const;
const HASH = '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc';
const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
const issuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-u20cdf5-m1');
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

async function provision(input: { readonly findings: readonly AssessmentFinding[]; readonly storeEvidence?: boolean }) {
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
  for (const evidence of NEGATIVES) {
    if (input.storeEvidence !== false || evidence !== WATER_EVIDENCE) await repository.put({ artifact_id: evidence.artifact_id, body: evidence });
  }
  const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `u20cdf5-m1-${Math.random()}` });
  security.bindPrincipal('lu.site_assessment.actor');
  const outcome = {
    outcome_id: `outcome-u20cdf5-${Math.random()}`, artifact_type: 'execution_outcome' as const,
    attempt_ref: { artifact_id: 'attempt-u20cdf5', artifact_type: 'execution_attempt' },
    result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
  };
  const assessment = createGovernedLocalizationAssessment({
    draft: { site_id: 'site-u20cdf5', project_context_ref: CONTEXT, property_ref: PROPERTY_REF, evidence_refs: NEGATIVES.map(ref), system_summary: 'U20CDF5 M1' },
    findings: input.findings, outcome, attestation: security.attestOutcome(outcome.content_hash),
  });
  await repository.put({ artifact_id: assessment.artifact_id, body: assessment });
  await registerAssessmentProjection({
    projectId: PROJECT_ID, assessment, contextBindingRef: { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type },
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
const token = createTokenPair({ id: 'user-u20cdf5', organisationId: 'org-u20cdf5', bankidId: 'bankid:u20cdf5', role: 'ADMIN' }).accessToken;
const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path: string) => request(app).post(path).set('Authorization', `Bearer ${token}`).send({});
const PATHS = {
  verify: () => post(`/api/localization/${PROJECT_ID}/verify-assessment`),
  map: () => get(`/api/localization/${PROJECT_ID}/viewer/evidence`),
  readBack: () => get(`/api/localization/${PROJECT_ID}/current-assessment`),
  pdf: () => get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`),
} as const;

beforeEach(() => {
  hermeticPrismaTouches.length = 0;
  spies.reExecute.mockClear();
  spies.buildPdf.mockClear();
  spies.present.mockClear();
});
afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

function expectIntegrity424(res: request.Response) {
  expect(res.status).toBe(424);
  expect(res.body).toMatchObject({ ok: false, code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR', failureClass: 'RECORD_INTEGRITY_ERROR', reasonCode: 'UNKNOWN_SEVERITY', retryable: false });
  expect(res.body.record_integrity).toMatchObject({ authoritative: false, verified: false });
  expect(JSON.stringify(res.body)).not.toMatch(/PASS|Reproducerbarhet verifierad|EIO|cas\\\\objects/);
}

describe('W-U20CDF5 M1 (verifier probe B1): a TRANSIENT read fault during the integrity pre-check never opens verify or the map for a record with an integrity error', () => {
  it.each(['verify', 'map', 'readBack', 'pdf'] as const)('control, no read fault: %s -> 424 ASSESSMENT_RECORD_INTEGRITY_ERROR', async (path) => {
    await provision({ findings: [UNKNOWN_SEVERITY] });
    expectIntegrity424(await PATHS[path]());
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it.each(['verify', 'map', 'readBack', 'pdf'] as const)('the first read of a pinned evidence fails with EIO: %s -> still 424 (the break is visible without reading evidence); never replayed, never 200, no PDF', async (path) => {
    const { repository } = await provision({ findings: [UNKNOWN_SEVERITY] });
    repository.failFirstRead(WATER_EVIDENCE.artifact_id, eio);
    const res = await PATHS[path]();
    expectIntegrity424(res);
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(spies.buildPdf).not.toHaveBeenCalled();
    // The fault was really met (the pre-check read the evidence and could not).
    expect(repository.failures.get(WATER_EVIDENCE.artifact_id)!.remaining).toBe(0);
  });

  it('verifier probe B2: the pinned evidence is permanently missing -> verify is the same 424, never replayed', async () => {
    await provision({ findings: [UNKNOWN_SEVERITY], storeEvidence: false });
    const res = await PATHS.verify();
    expectIntegrity424(res);
    expect(spies.reExecute).not.toHaveBeenCalled();
  });
});

describe('W-U20CDF5 M1: with no visible break, an incomplete pre-check stops verify and the map -- a typed read fault, never a replay and never 200', () => {
  it.each(['verify', 'map'] as const)('control, no read fault, a valid record: %s -> 200 (verify calls the MOCKED H15 once)', async (path) => {
    await provision({ findings: [] });
    const res = await PATHS[path]();
    expect(res.status).toBe(200);
    if (path === 'verify') expect(spies.reExecute).toHaveBeenCalledTimes(1);
  });

  it.each(['verify', 'map'] as const)('transient EIO on a pinned evidence: %s -> 503 ASSESSMENT_PINNED_EVIDENCE_UNREADABLE, READ_ERROR, retryable; never replayed', async (path) => {
    const { repository } = await provision({ findings: [] });
    repository.failFirstRead(WATER_EVIDENCE.artifact_id, eio);
    const res = await PATHS[path]();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      error: expect.any(String),
      code: 'ASSESSMENT_PINNED_EVIDENCE_UNREADABLE',
      failureClass: 'READ_ERROR',
      reasonCode: 'EVIDENCE_READ_ERROR',
      retryable: true,
    });
    expect(res.body.error).toMatch(/^Den pinnade evidensen som bedömningen är bunden till kunde inte läsas \(tekniskt fel\)\. Ett nytt försök kan lyckas\./);
    expect(JSON.stringify(res.body)).not.toMatch(/PASS|Reproducerbarhet verifierad|EIO|cas\\\\objects|evidence-water/);
    expect(spies.reExecute).not.toHaveBeenCalled();
  });

  it.each(['verify', 'map'] as const)('pinned evidence permanently missing (lasting): %s -> 503 MISSING_FROM_CAS, not retryable -- an integrity fault, never a pass', async (path) => {
    await provision({ findings: [], storeEvidence: false });
    const res = await PATHS[path]();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, code: 'ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', failureClass: 'MISSING_FROM_CAS', reasonCode: 'EVIDENCE_NOT_FOUND', retryable: false });
    expect(res.body.error).toMatch(/bestående lagrings- eller integritetsfel/);
    expect(spies.reExecute).not.toHaveBeenCalled();
  });

  it('the read-back keeps its own state for the same record: 200 PINNED_EVIDENCE_UNREADABLE, no N av M (unchanged, U20CDF2 G2)', async () => {
    const { repository } = await provision({ findings: [] });
    repository.failFirstRead(WATER_EVIDENCE.artifact_id, eio);
    const res = await PATHS.readBack();
    expect(res.status).toBe(200);
    expect(res.body.overallStatement).toMatchObject({ coverage_state: 'PINNED_EVIDENCE_UNREADABLE', coverage: null });
  });
});

describe('W-U20CDF5 M1: assessGovernedCoverage -- a break established without the unreadable evidence goes before PINNED_EVIDENCE_UNREADABLE', () => {
  const unreadable = { pinned_total: 6, unreadable_artifact_ids: ['evidence-water-x'], technical_error_class: 'EVIDENCE_READ_ERROR' as const, retryable: true };
  const checks = [
    ...LAYERS.map((layer) => ({ layer, rule_id: null, status: 'NOT_CHECKED' as const, evidence_artifact_id: null, reason: 'PINNED_EVIDENCE_UNREADABLE' })),
    { layer: 'document', rule_id: 'LU-DOC-BESLUT-001', status: 'NOT_CHECKED' as const, evidence_artifact_id: null, reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED' },
  ];

  it.each<[string, Record<string, unknown>, readonly string[]]>([
    ['an unknown severity', { findings: [{ finding_id: 'f-x', rule_id: 'LU-EBH-001', risk_level: 'CRITICAL' }] }, ['UNKNOWN_SEVERITY:f-x']],
    ['a malformed finding', { findings: [null] }, ['MALFORMED_RECORD_ENTRY:findings#0']],
    ['findings that are not a list', { findings: 'x' }, ['MALFORMED_RECORD_ENTRY:findings']],
    ['a malformed evidence ref', { findings: [], pinnedExtra: { malformed_evidence_ref_indexes: [3] } }, ['MALFORMED_RECORD_ENTRY:evidence_refs#3']],
    ['READABLE evidence outside the governed layers', { findings: [], pinnedExtra: { outside_governed_layers_artifact_ids: ['evidence-other'] } }, ['EVIDENCE_OUTSIDE_GOVERNED_LAYERS:evidence-other']],
    [
      'a NOT_CHECKED document finding next to pinned DE + VF (known from the refs alone)',
      { findings: [{ finding_id: 'f-doc', rule_id: 'LU-DOC-BESLUT-001', risk_level: 'NOT_CHECKED' }], pinnedExtra: { document_rule_inputs_pinned: true } },
      ['NOT_CHECKED_FINDING_WITH_EVIDENCE:document'],
    ],
  ])('%s + unreadable pinned evidence -> RECORD_INTEGRITY_ERROR (the visible break first, then what could not be read)', (_label, input, visible) => {
    const assessed = assessGovernedCoverage(checks, {
      findings: input.findings as never,
      pinnedEvidence: { ...unreadable, ...((input.pinnedExtra as object) ?? {}) },
    });
    expect(assessed.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(assessed.coverage_basis).toEqual([...visible, 'PINNED_EVIDENCE_UNREADABLE:evidence-water-x']);
    expect(assessed.coverage).toBeNull();
  });

  it('control: unreadable pinned evidence and nothing visible -> PINNED_EVIDENCE_UNREADABLE (unchanged)', () => {
    const assessed = assessGovernedCoverage(checks, { findings: [], pinnedEvidence: unreadable });
    expect(assessed.coverage_state).toBe('PINNED_EVIDENCE_UNREADABLE');
    expect(assessed.coverage_basis).toEqual(['PINNED_EVIDENCE_UNREADABLE:evidence-water-x']);
  });

  it('control: a NOT_CHECKED document finding WITHOUT DE + VF pinned is no break -> PINNED_EVIDENCE_UNREADABLE', () => {
    const assessed = assessGovernedCoverage(checks, {
      findings: [{ finding_id: 'f-doc', rule_id: 'LU-DOC-BESLUT-001', risk_level: 'NOT_CHECKED' }] as never,
      pinnedEvidence: unreadable,
    });
    expect(assessed.coverage_state).toBe('PINNED_EVIDENCE_UNREADABLE');
  });
});

describe('W-U20CDF5 M1 (mutation M1-DOCREFS): the read path itself knows the pinned DE + VF from the refs alone, also when a document cannot be read', () => {
  const DE_REF = { artifact_id: 'document-evidence-u20cdf5', artifact_type: 'DOCUMENT_EVIDENCE' };
  const VF_REF = { artifact_id: 'verified-document-fact-u20cdf5', artifact_type: 'VERIFIED_DOCUMENT_FACT' };
  const ncDocument = { finding_id: 'finding-notchecked-document', rule_id: 'LU-DOC-BESLUT-001', rule_version: '2.0', risk_level: 'NOT_CHECKED', explanation: 'x', evidence_refs: [] };

  it('the pinned document cannot be read (EIO) and a NOT_CHECKED document finding stands beside the DE + VF refs -> RECORD_INTEGRITY_ERROR, never PINNED_EVIDENCE_UNREADABLE', async () => {
    const store = new Map<string, unknown>(NEGATIVES.map((e) => [e.artifact_id, e] as const));
    store.set(VF_REF.artifact_id, { artifact_id: VF_REF.artifact_id, artifact_type: VF_REF.artifact_type, payload: {} });
    const repository = {
      async resolve<T>(r: { artifact_id: string }): Promise<T> {
        if (r.artifact_id === DE_REF.artifact_id) throw eio();
        const value = store.get(r.artifact_id);
        if (!value) throw new Error(`Artifact not found: ${r.artifact_id}`);
        return structuredClone(value) as T;
      },
    };
    const findings = [ncDocument];
    const details = await resolveGovernedAssessmentDetails({
      assessment: { payload: { findings, evidence_refs: [...NEGATIVES.map(ref), DE_REF, VF_REF] } } as never,
      artifactRepository: repository as never,
    });
    expect(details.pinnedEvidence.document_rule_inputs_pinned).toBe(true);
    expect(details.documentCheck).toMatchObject({ status: 'NOT_CHECKED', reason: 'PINNED_EVIDENCE_UNREADABLE' });
    const statement = governedOverallStatement('LOW', details.governedLayerChecks, { findings: findings as never, pinnedEvidence: details.pinnedEvidence });
    expect(statement.coverage_state).toBe('RECORD_INTEGRITY_ERROR');
    expect(statement.coverage_basis).toEqual(['NOT_CHECKED_FINDING_WITH_EVIDENCE:document', `PINNED_EVIDENCE_UNREADABLE:${DE_REF.artifact_id}`]);
  });
});

describe('W-U20CDF5-R2 M1-rest (verifier probe R1): a pre-check whose read content fails its own identity (a CORRUPT or TRUNCATED read) is answered on verify exactly as on the read-back and the map -- 424, never replayed', () => {
  const corrupt = () => Object.assign(new Error('digest mismatch for C:\\cas\\objects\\ab'), { name: 'CASIntegrityError' });
  const truncated = { artifact_id: WATER_EVIDENCE.artifact_id, artifact_type: 'SPATIAL_EVIDENCE' };
  const CLASS = { corrupt: 'EVIDENCE_CORRUPTED', truncated: 'EVIDENCE_TAMPERED' } as const;
  const inject = (repository: FaultyMemoryRepository, kind: 'corrupt' | 'truncated') =>
    kind === 'corrupt' ? repository.failFirstRead(WATER_EVIDENCE.artifact_id, corrupt) : repository.serveFirstRead(WATER_EVIDENCE.artifact_id, truncated);

  it.each(['corrupt', 'truncated'] as const)('%s first read of a pinned evidence, a record with an unknown severity: verify -> 424 GOVERNED_EVIDENCE_INTEGRITY_FAILED, never replayed (it was 200 PASS)', async (kind) => {
    const { repository } = await provision({ findings: [UNKNOWN_SEVERITY] });
    inject(repository, kind);
    const res = await PATHS.verify();
    expect(res.status).toBe(424);
    expect(res.body).toMatchObject({ ok: false, code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED', failureClass: CLASS[kind] });
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/PASS|Reproducerbarhet verifierad|cas\\\\objects/);
  });

  it.each(['corrupt', 'truncated'] as const)('a CLEAN record, the same %s read: verify -> the same 424, never replayed -- a pre-check that could not establish the record never hands it to H15, which after a transient fault reads it intact and could replay a break visible only in that content', async (kind) => {
    const { repository } = await provision({ findings: [] });
    inject(repository, kind);
    const res = await PATHS.verify();
    expect(res.status).toBe(424);
    expect(res.body).toMatchObject({ ok: false, code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED', failureClass: CLASS[kind] });
    expect(spies.reExecute).not.toHaveBeenCalled();
  });

  it.each(['readBack', 'map', 'verify'] as const)('one answer on every path for the same corrupt read: %s -> 424 GOVERNED_EVIDENCE_INTEGRITY_FAILED / EVIDENCE_CORRUPTED; the PDF builds nothing', async (path) => {
    const { repository } = await provision({ findings: [UNKNOWN_SEVERITY] });
    inject(repository, 'corrupt');
    const res = await PATHS[path]();
    expect(res.status).toBe(424);
    expect(res.body).toMatchObject({ code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED', failureClass: 'EVIDENCE_CORRUPTED' });
    expect(spies.reExecute).not.toHaveBeenCalled();
    const { repository: again } = await provision({ findings: [UNKNOWN_SEVERITY] });
    inject(again, 'corrupt');
    expect((await PATHS.pdf()).status).toBe(424);
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('control (no over-closing): the same clean record without a fault -> verify hands it to the (MOCKED) H15 once, 200', async () => {
    await provision({ findings: [] });
    const res = await PATHS.verify();
    expect(res.status).toBe(200);
    expect(spies.reExecute).toHaveBeenCalledTimes(1);
  });
});
