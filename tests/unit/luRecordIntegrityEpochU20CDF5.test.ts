/**
 * W-U20CDF5 (U20CDF4 verification L3 and L2; owner decision 2026-10-03 (4) point 2: a deviation is a
 * RECORD_INTEGRITY_ERROR ONLY when it breaks an ACTUAL contract; metadata older formats never promised is
 * never retroactively corruption).
 *
 *  - L3: a stored record WITHOUT a `findings` field. `findings` has been in the assessment type since
 *    61063241 (2026-08-04) and in every producer since 9c200a78 (2026-08-08): its absence breaks the finding
 *    contract -> the typed 424, never a generic 500.
 *  - L2 (OWNER DECISION 2026-10-02; proposed by the verifier): `assessment_contract_version` as the EPOCH MARKER.
 *    Every V2+ record (29f83705, 2026-08-23 and later) was written by a producer that queried all five
 *    layers (e0b63cf9), persisted negative answers (e045be3b) and used the result contract (b2f7ea9b) --
 *    all ancestors of 29f83705 -- and before SEM-1 (d27d240a) a failed layer query failed the whole run.
 *    A silent layer in a V2+ record breaks that contract (RECORD_INTEGRITY_ERROR); in a V1 record (no
 *    version) it stays HISTORICAL_COVERAGE_UNKNOWN.
 *
 * Same hermetic chain as luPinnedEvidenceReadFaultU20CDF5: real router + orchestrator over an in-memory
 * CAS, real owner-signed binding; H15 MOCKED (PASS spy -- the real H15 is not run).
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
  localizationAssessmentCanonicalBody,
  SPATIAL_STACK_V1,
  type AssessmentFinding,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { installOwnerIssuedProjectContextBinding } from '../../server/modules/localization/installProjectContextBinding';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
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
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    this.reads.push(reference.artifact_id);
    const failure = this.failures.get(reference.artifact_id);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error();
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

const PROJECT_ID = 'project-u20cdf5-epoch';
const CONTEXT = { artifact_id: 'lu-context-u20cdf5', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const PROPERTY_REF = { artifact_id: 'property-u20cdf5', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const PROPERTY_BINDING = { artifact_id: 'project-property-binding-u20cdf5', artifact_type: 'project_property_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-u20cdf5', artifact_type: 'product_release' } as const;
const LOCATION_REF = { artifact_id: 'localization-geometry-u20cdf5', artifact_type: 'localization_geometry' } as const;
const HASH = '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc';
const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
const issuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-u20cdf5-epoch');
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

const FINDINGS_UNREADABLE_SV = 'Den lagrade postens fynd kan inte läsas: fältet saknas eller är inte en lista.';

describe('W-U20CDF5 L3 (verifier probes C4/C4a): a record WITHOUT a findings field breaks the finding contract -- a typed 424 on every path, never a 500', () => {
  it.each<Version>(['V1', 'V2'])('%s, all five layers negative, no findings field: read-back -> 424 MALFORMED_RECORD_ENTRY; the text never claims the record holds no findings', async (version) => {
    await provisionRecord({ version, negatives: ALL, findings: 'ABSENT' });
    const res = await PATHS.readBack();
    expectIntegrity424(res, 'MALFORMED_RECORD_ENTRY');
    expect(res.body.record_integrity.basis_codes).toEqual(['MALFORMED_RECORD_ENTRY']);
    expect(res.body.error).toContain(FINDINGS_UNREADABLE_SV);
    expect(res.body.error).not.toContain('innehåller inga fynd');
  });

  it.each(['verify', 'map', 'pdf'] as const)('the same V1 record: %s -> the same 424; never replayed, no PDF', async (path) => {
    await provisionRecord({ version: 'V1', negatives: ALL, findings: 'ABSENT' });
    expectIntegrity424(await PATHS[path](), 'MALFORMED_RECORD_ENTRY');
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('a findings field that is not a list says the same (it used to say "innehåller inga fynd" -- a false absence)', async () => {
    await provisionRecord({ version: 'V1', negatives: ALL, findings: [], rawFindings: { not: 'a list' } });
    const res = await PATHS.readBack();
    expectIntegrity424(res, 'MALFORMED_RECORD_ENTRY');
    expect(res.body.error).toContain(FINDINGS_UNREADABLE_SV);
    expect(res.body.error).not.toContain('innehåller inga fynd');
  });

  it('control: a V1 record with an EMPTY findings list and all five layers negative -> 200 DETERMINED (an empty list is no break)', async () => {
    await provisionRecord({ version: 'V1', negatives: ALL, findings: [] });
    const res = await PATHS.readBack();
    expect(res.status).toBe(200);
    expect(res.body.overallStatement).toMatchObject({ coverage_state: 'DETERMINED' });
  });
});

/**
 * L2 -- the classification table (version x content -> class), locked here. OWNER DECISION 2026-10-02: the epoch
 * marker is assessment_contract_version (deterministic, bound to the artifact's semantics; never a date or a
 * creation time) -- it separates truly historical pre-contract data from a modern record that breaks its
 * contract. (Proposed by the U20CDF4 verifier, L2 / open question 4.)
 *
 *  version          | content                                         | class
 *  V1 (no version)  | a governed layer silent (LAYER_NOT_RECORDED)    | HISTORICAL_COVERAGE_UNKNOWN (200)
 *  V2 / V3 / V4     | a governed layer silent (LAYER_NOT_RECORDED)    | RECORD_INTEGRITY_ERROR (424)
 *  V1..V4           | all five layers answered, nothing else           | DETERMINED (200)
 *  V1..V4           | a hit without its finding (HIT_WITHOUT_FINDING)  | HISTORICAL_COVERAGE_UNKNOWN (200) -- NOT
 *                   |                                                   | promoted: the natura2000/water_protection_area
 *                   |                                                   | rules (b673a5e8, 2026-08-24) postdate V2 (29f83705)
 *
 * Boundary (W-U20CDF5 report): the general LU engine (runLuAssessmentViaKernel -- H15's own suite and the operator
 * proofs scripts/ops/prove-lu-deterministic-reexecution-01.ts / prove-lu-replay-cold-verify-01.ts) writes V3
 * records over whatever evidence it is given; such a record with a silent layer is now an integrity error too.
 */
describe('W-U20CDF5 L2 (owner decision 2026-10-02): assessment_contract_version is the epoch marker -- a silent layer breaks the contract of a V2+ record, never of a V1 record', () => {
  const FOUR = ALL.filter((layer) => layer !== 'natura2000');

  it('V1 with a silent layer -> 200 HISTORICAL_COVERAGE_UNKNOWN (LAYER_NOT_RECORDED:natura2000), "denna historiska bedömning"', async () => {
    await provisionRecord({ version: 'V1', negatives: FOUR, findings: [] });
    const res = await PATHS.readBack();
    expect(res.status).toBe(200);
    expect(res.body.overallStatement).toMatchObject({ coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN', coverage_basis: ['LAYER_NOT_RECORDED:natura2000'] });
    expect(res.body.overallStatement.statement_sv).toBe('Täckningsgrad kan inte fastställas för denna historiska bedömning.');
  });

  for (const version of ['V2', 'V3', 'V4'] as const) {
    it(`${version} with a silent layer -> 424 RECORD_INTEGRITY_ERROR (LAYER_NOT_RECORDED)`, async () => {
      await provisionRecord({ version, negatives: FOUR, findings: [] });
      const res = await PATHS.readBack();
      expectIntegrity424(res, 'LAYER_NOT_RECORDED');
      expect(res.body.record_integrity.basis_codes).toEqual(['LAYER_NOT_RECORDED']);
    });
  }

  it('verifier probe C6 (a V3 record with only three layers): read-back, verify, the map and the PDF all 424; never replayed', async () => {
    await provisionRecord({ version: 'V3', negatives: ['water', 'ebh', 'protected_area'], findings: [] });
    for (const path of ['readBack', 'verify', 'map', 'pdf'] as const) expectIntegrity424(await PATHS[path](), 'LAYER_NOT_RECORDED');
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(spies.buildPdf).not.toHaveBeenCalled();
  });

  it('a stored risk finding on a V3 record with a silent layer is still named (unverified) in the 424 -- a known risk never disappears', async () => {
    await provisionRecord({ version: 'V3', negatives: ALL.filter((l) => l !== 'natura2000' && l !== 'ebh'), hits: ['ebh'], findings: [{ finding_id: 'finding-ebh-high', rule_id: RULE.ebh, rule_version: '2.0', risk_level: 'HIGH', explanation: 'x', evidence_refs: [] }] });
    const res = await PATHS.readBack();
    expectIntegrity424(res, 'LAYER_NOT_RECORDED');
    expect(res.body.error).toContain('risknivå hög – Potentiellt förorenade områden (EBH)');
    expect(res.body.record_integrity.stored_findings_unverified).toMatchObject({ total: 1, highest_level: 'HIGH' });
  });

  it.each<Version>(['V1', 'V2', 'V3', 'V4'])('control: %s with all five layers answered -> 200 DETERMINED, 6 checks', async (version) => {
    await provisionRecord({ version, negatives: ALL, findings: [] });
    const res = await PATHS.readBack();
    expect(res.status).toBe(200);
    expect(res.body.overallStatement).toMatchObject({ coverage_state: 'DETERMINED', coverage: { checks_total: 6 } });
  });

  it.each<Version>(['V1', 'V2', 'V3', 'V4'])('%s with a hit and no finding (HIT_WITHOUT_FINDING) stays HISTORICAL: not promoted by the epoch marker', async (version) => {
    await provisionRecord({ version, negatives: ALL.filter((l) => l !== 'natura2000'), hits: ['natura2000'], findings: [] });
    const res = await PATHS.readBack();
    expect(res.status).toBe(200);
    expect(res.body.overallStatement).toMatchObject({ coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN', coverage_basis: ['HIT_WITHOUT_FINDING:natura2000'] });
  });

  it('control: a V1 record with a silent layer is still verified and shown on the map (historical, not an integrity error)', async () => {
    await provisionRecord({ version: 'V1', negatives: FOUR, findings: [] });
    expect((await PATHS.verify()).status).toBe(200);
    expect(spies.reExecute).toHaveBeenCalledTimes(1);
    expect((await PATHS.map()).status).toBe(200);
  });
});
