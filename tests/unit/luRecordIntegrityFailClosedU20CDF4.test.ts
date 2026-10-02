/**
 * U20CDF4 (owner decision 2026-10-03 night (4) point 1, and the coordinator's binding clarifications 1-2)
 * -- a CURRENT governed assessment whose stored record is structurally inconsistent
 * (RECORD_INTEGRITY_ERROR) fails closed with 424 on every path that presents it: the read-back
 * (GET current-assessment), the PDF (GET export-assessment-pdf), verify (POST verify-assessment, never
 * PASS) and the map (GET viewer/evidence). The stored findings stay in view only as a non-authoritative
 * diagnostic in an envelope of its own -- never in the shape of a valid assessment.
 *
 * Real chain, hermetic: real router + requireAuth -> real localizationOrchestrator over an in-memory CAS
 * holding a real owner-signed ProjectContextBinding and a real V3 LocalizationAssessmentArtifact; every
 * index in memory; server/db/prisma is the throwing guard. Only the viewer capability lookup and the
 * ViewerKernel presentation (which have their own suites) are stubbed for the map path.
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
    capabilityArtifactId: 'capability-u20cdf4', expectedProjectId: projectId, expectedContextBindingId: 'x',
    expectedViewerIdentityId: 'x', expectedReleaseId: 'x', expectedReleaseHash: 'x',
  })),
}));
vi.mock('../../server/modules/localization/resolveGovernedLocalizationPresentation', () => ({
  resolveGovernedLocalizationPresentation: vi.fn(async (args: { assessmentArtifactId: string }) => {
    spies.present(args);
    return { geojson: { type: 'FeatureCollection', features: [] }, assessmentArtifactId: args.assessmentArtifactId, capabilityArtifactId: 'capability-u20cdf4' };
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
  createGovernedLocalizationAssessment,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  type AssessmentFinding,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { installOwnerIssuedProjectContextBinding } from '../../server/modules/localization/installProjectContextBinding';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { recordIntegrityDiagnosticWire } from '../../server/modules/localization/localizationOrchestrator';
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
    if (!id) throw new Error('no binding');
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

const PROJECT_ID = 'project-u20cdf4-integrity';
const CONTEXT = { artifact_id: 'lu-context-u20cdf4', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const PROPERTY_BINDING = { artifact_id: 'project-property-binding-u20cdf4', artifact_type: 'project_property_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-u20cdf4', artifact_type: 'product_release' } as const;
const issuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-u20cdf4');
const verification = new LocalPemVerificationKeyProvider(issuerKey.provider.keyId, issuerKey.publicKey);
const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });

/** A stored finding as written in the record (V3 canonical set); `level` may be outside the governed values. */
const stored = (id: string, rule: string, level: unknown, explanation = 'Lagrad förklaring: SELECT * FROM env.secret_table; password=hemligtU20CDF4') =>
  ({ finding_id: id, rule_id: rule, rule_version: '2.0', risk_level: level, explanation, evidence_refs: [] }) as unknown as AssessmentFinding;

async function provision(findings: readonly AssessmentFinding[]) {
  const repository = new MemoryRepository();
  const bindingIndex = new MemoryBindingIndex();
  const projectionIndex = new MemoryProjectionIndex();
  await repository.put({ artifact_id: issuer.artifact_id, body: issuer });
  const unsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: CONTEXT, project_property_binding_ref: PROPERTY_BINDING,
    binding_version: 'project-context-binding-v2', authority_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    created_at: '2026-10-02T00:00:00.000Z',
  });
  const binding = { ...unsigned, attestation: await attestProjectContextBindingArtifact({ artifact: unsigned, issuer, signing: issuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index: bindingIndex, binding, verification });

  const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `u20cdf4-${Math.random()}` });
  security.bindPrincipal('lu.site_assessment.actor');
  const outcome = {
    outcome_id: `outcome-u20cdf4-${Math.random()}`, artifact_type: 'execution_outcome' as const,
    attempt_ref: { artifact_id: 'attempt-u20cdf4', artifact_type: 'execution_attempt' },
    result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
  };
  const assessment = createGovernedLocalizationAssessment({
    draft: {
      site_id: 'site-u20cdf4', project_context_ref: CONTEXT,
      property_ref: { artifact_id: 'property-u20cdf4', artifact_type: 'LU_PROPERTY_CONTEXT' },
      evidence_refs: [], system_summary: 'U20CDF4 record integrity',
    },
    findings, outcome, attestation: security.attestOutcome(outcome.content_hash),
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
  return assessment;
}

const app = express();
app.use(express.json());
app.use(localizationRoutes);
const token = createTokenPair({ id: 'user-u20cdf4', organisationId: 'org-u20cdf4', bankidId: 'bankid:u20cdf4', role: 'ADMIN' }).accessToken;
const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path: string) => request(app).post(path).set('Authorization', `Bearer ${token}`).send({});

/** The integrity-broken record: a HIGH finding (a known risk) and one with a severity outside the governed values. */
const BROKEN = [stored('finding-ebh-high', 'LU-EBH-001', 'HIGH'), stored('finding-water-critical', 'LU-WATER-001', 'CRITICAL')];

/** Keys of a valid read-back answer -- none of them may appear in the 424. */
const ASSESSMENT_KEYS = [
  'assessmentArtifactId', 'findings', 'ruleRefs', 'evidenceRefs', 'systemSummary', 'localizationGeometry', 'documentCheck',
  'governedLayerChecks', 'evidenceDetails', 'propertyRoot', 'overallStatement', 'overall_summary', 'risk_level', 'outcome',
];

function expectRecordIntegrity424(res: request.Response, assessmentId: string) {
  expect(res.status).toBe(424);
  expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'failureClass', 'ok', 'reasonCode', 'record_integrity', 'retryable']);
  expect(res.body).toMatchObject({
    ok: false, code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR', failureClass: 'RECORD_INTEGRITY_ERROR', reasonCode: 'UNKNOWN_SEVERITY', retryable: false,
  });
  for (const key of ASSESSMENT_KEYS) expect(res.body, key).not.toHaveProperty(key);
  // A known risk never disappears: the stored HIGH is named, and the unknown one too -- unverified.
  expect(res.body.error).toBe(
    'Bedömningen kan inte visas: dess lagrade underlag är motsägelsefullt eller ligger utanför det styrda formatet ' +
      '(RECORD_INTEGRITY_ERROR: UNKNOWN_SEVERITY). Täckningsgrad och samlad risknivå kan därför inte fastställas, och bedömningen ' +
      'redovisas inte som en giltig bedömning. Den lagrade posten innehåller 2 fynd som inte kan verifieras (högsta lagrade risknivå, ' +
      'overifierad: hög): risknivå hög – Potentiellt förorenade områden (EBH); okänd allvarlighetsgrad – Brunnar. ' +
      'Felet löses inte av ett nytt försök. Kontakta systemets administratör.',
  );
  const diagnostic = res.body.record_integrity;
  expect(Object.keys(diagnostic).sort()).toEqual(['assessment_artifact_id', 'authoritative', 'basis_codes', 'note_sv', 'stored_findings_unverified', 'verified']);
  expect(diagnostic).toMatchObject({
    authoritative: false, verified: false, assessment_artifact_id: assessmentId, basis_codes: ['UNKNOWN_SEVERITY'],
    stored_findings_unverified: {
      total: 2, highest_level: 'HIGH',
      counts: { high: 1, medium: 0, low: 0, not_checked: 0, unknown_level: 1, malformed: 0 },
    },
  });
  expect(diagnostic.note_sv).toMatch(/inte verifierad, inte auktoritativ och ingen bedömning/);
  expect([...diagnostic.stored_findings_unverified.entries].sort((a: { rule: string }, b: { rule: string }) => a.rule.localeCompare(b.rule))).toEqual([
    { check: 'ebh', rule: 'LU-EBH-001', stored_level: 'HIGH', well_formed: true },
    { check: 'water', rule: 'LU-WATER-001', stored_level: 'UNKNOWN', well_formed: true },
  ]);
  // Nothing of the record's free text and nothing of the raw unknown level travels.
  const text = JSON.stringify(res.body);
  for (const raw of ['CRITICAL', 'SELECT', 'secret_table', 'hemligtU20CDF4', 'Lagrad förklaring', 'finding-ebh-high', 'finding-water-critical']) {
    expect(text, raw).not.toContain(raw);
  }
  expect(text).not.toMatch(/låg risk|\b\d+ av \d+ kontroller/i);
}

beforeEach(() => {
  hermeticPrismaTouches.length = 0;
  spies.reExecute.mockClear();
  spies.buildPdf.mockClear();
  spies.present.mockClear();
});
afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('U20CDF4 (owner decision (4) point 1): a current record with an integrity error is a 424 on every path that presents it', () => {
  it('GET current-assessment -> 424 ASSESSMENT_RECORD_INTEGRITY_ERROR with the whitelisted, unverified diagnostic; never a 200 assessment', async () => {
    const assessment = await provision(BROKEN);
    expectRecordIntegrity424(await get(`/api/localization/${PROJECT_ID}/current-assessment`), assessment.artifact_id);
  });

  it('GET export-assessment-pdf -> the same 424, and no PDF is built', async () => {
    const assessment = await provision(BROKEN);
    const res = await get(`/api/localization/${PROJECT_ID}/export-assessment-pdf`);
    expectRecordIntegrity424(res, assessment.artifact_id);
    expect(spies.buildPdf).not.toHaveBeenCalled();
    expect(res.headers['content-type']).not.toMatch(/pdf/);
  });

  it('POST verify-assessment -> the same 424, never PASS: the record is never replayed', async () => {
    const assessment = await provision(BROKEN);
    const res = await post(`/api/localization/${PROJECT_ID}/verify-assessment`);
    expectRecordIntegrity424(res, assessment.artifact_id);
    expect(spies.reExecute).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/PASS|Reproducerbarhet verifierad/);
  });

  it('GET viewer/evidence (the map) -> the same 424 after the presentation itself passed: never a valid current assessment on the map', async () => {
    const assessment = await provision(BROKEN);
    const res = await get(`/api/localization/${PROJECT_ID}/viewer/evidence`);
    expect(spies.present).toHaveBeenCalledTimes(1);
    expectRecordIntegrity424(res, assessment.artifact_id);
  });

  it('control: a HISTORICAL record (a stored MEDIUM without the evidence a current run pins) is NOT an integrity error -- 200 on read-back, map and verify', async () => {
    const assessment = await provision([stored('finding-water-medium', 'LU-WATER-001', 'MEDIUM')]);
    const readBack = await get(`/api/localization/${PROJECT_ID}/current-assessment`);
    expect(readBack.status).toBe(200);
    expect(readBack.body.overallStatement).toMatchObject({ coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN', risk_level: 'MEDIUM' });
    expect(readBack.body.assessmentArtifactId).toBe(assessment.artifact_id);
    const map = await get(`/api/localization/${PROJECT_ID}/viewer/evidence`);
    expect(map.status).toBe(200);
    const verify = await post(`/api/localization/${PROJECT_ID}/verify-assessment`);
    expect(verify.status).toBe(200);
    expect(spies.reExecute).toHaveBeenCalledTimes(1);
  });
});

describe('U20CDF4: the 424 diagnostic is rebuilt from a whitelist at the HTTP boundary (recordIntegrityDiagnosticWire)', () => {
  it('extra fields, free text, raw levels and non-plain ids never pass; counts must be counts', () => {
    const hostile = {
      authoritative: true, verified: true, note_sv: 'Allt är verifierat <script>', assessment_artifact_id: 'assessment-abc',
      findings: [{ explanation: 'rå text' }], overallStatement: { risk_level: 'LOW' }, risk_level: 'LOW',
      basis_codes: ['UNKNOWN_SEVERITY', 'drop table', 'X'.repeat(70), 5],
      stored_findings_unverified: {
        total: 3, highest_level: 'CRITICAL', extra: 'x',
        counts: { high: 1, medium: -1, low: 1.5, not_checked: '2', unknown_level: 1, malformed: 0, secret: 9 },
        entries: [
          { check: 'water', rule: 'LU-WATER-001', stored_level: 'HIGH', well_formed: true, explanation: 'rå text' },
          { check: '<b>ebh</b>', rule: 'rule with spaces; DROP', stored_level: 'critical', well_formed: 'yes' },
          null,
        ],
      },
    };
    const wire = recordIntegrityDiagnosticWire(hostile)!;
    expect(wire).toEqual({
      authoritative: false, verified: false,
      note_sv: 'Diagnostisk uppgift ur den lagrade posten: inte verifierad, inte auktoritativ och ingen bedömning. Fynden får inte läsas som bedömningens resultat.',
      assessment_artifact_id: 'assessment-abc',
      basis_codes: ['UNKNOWN_SEVERITY'],
      stored_findings_unverified: {
        total: 3, highest_level: null,
        counts: { high: 1, medium: 0, low: 0, not_checked: 0, unknown_level: 1, malformed: 0 },
        entries: [
          { check: 'water', rule: 'LU-WATER-001', stored_level: 'HIGH', well_formed: true },
          { check: null, rule: null, stored_level: 'UNKNOWN', well_formed: false },
          { check: null, rule: null, stored_level: 'UNKNOWN', well_formed: false },
        ],
      },
    });
    expect(recordIntegrityDiagnosticWire(null)).toBeNull();
    expect(recordIntegrityDiagnosticWire({ assessment_artifact_id: 'a b', stored_findings_unverified: {} })).toBeNull();
  });
});
