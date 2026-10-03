/**
 * K0b (DOC-EVIDENCE-CENSUS 2026-10-02) -- the machine-readable document check in the read model.
 *
 * The document check is derived ONLY from the persisted assessment's pinned `evidence_refs`, so the
 * read-back (GET current-assessment -> resolveCurrentLuAssessmentSummary) and the PDF
 * (exportCurrentLuAssessmentPdf) show exactly what the fresh generate-report run showed
 * (tests/unit/luDocumentEvidenceK0Usecase.test.ts asserts the same object for the fresh run).
 *
 * v1: NOT_CHECKED with a machine-readable reason, or CHECKED_HIT when DOCUMENT_EVIDENCE plus a
 * VERIFIED_DOCUMENT_FACT are pinned. Never CHECKED_NO_HIT, never a risk level.
 * W-U20CDF6 (OWNER DECISION OD-K0-3, 2026-10-03): CHECKED_HIT means that LU-DOC-BESLUT-001 ACTUALLY fired -- a
 * finding of the rule in the same record that cites the pinned DOCUMENT_EVIDENCE and VERIFIED_DOCUMENT_FACT. Both
 * reference types pinned means only that the control basis exists: without a finding of the rule the row is
 * CHECKED_NO_HIT ("kontrollerat – ingen träff i det dokumentunderlag som är knutet till bedömningen", limited
 * coverage, never "inga tidigare beslut"). Without pinned inputs it stays NOT_CHECKED (never a no-hit); unreadable
 * pinned documents stay a technical error (never a no-hit). Still never a risk level.
 *
 * Hermetic: server/db/prisma is the throwing guard; every index is in memory; CAS is in memory.
 * Setup mirrors tests/unit/exportCurrentLuAssessmentPdf.test.ts.
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
vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => undefined),
}));
// HTTP-level case only: the route builds its own repository / indexes / verifier, so they are
// pointed at this file's in-memory instances (same pattern as the M1a HTTP test).
const routeState = vi.hoisted(() => ({
  repository: null as unknown,
  bindingIndex: null as unknown,
  projectionIndex: null as unknown,
  verification: null as unknown,
}));
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MimersIntegration: { create: vi.fn(async () => ({ artifactRepository: routeState.repository })) },
}));
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    register(...args: unknown[]) { return (routeState.bindingIndex as { register: (...a: unknown[]) => unknown }).register(...args); }
    resolve(...args: unknown[]) { return (routeState.bindingIndex as { resolve: (...a: unknown[]) => unknown }).resolve(...args); }
    registerSupersession() { return Promise.resolve(); }
    listBindingRefs(projectId: string) { return (routeState.bindingIndex as { listBindingRefs: (p: string) => unknown }).listBindingRefs(projectId); }
    listSupersessionRefs() { return Promise.resolve([]); }
  },
}));
vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => ({
  PrismaProjectAssessmentProjectionIndex: class {
    register(...args: unknown[]) { return (routeState.projectionIndex as { register: (...a: unknown[]) => unknown }).register(...args); }
    listForProject(projectId: string) { return (routeState.projectionIndex as { listForProject: (p: string) => unknown }).listForProject(projectId); }
  },
}));
vi.mock('../../server/security/projectContextBindingIssuerKey', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getProjectContextBindingIssuerVerifier: () => routeState.verification,
}));
let capturedPdfData: unknown;
vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: async (_title: string, _subtitle: string | undefined, data: unknown) => {
    capturedPdfData = data;
    return Buffer.from('fake-pdf-bytes-for-test');
  },
}));

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '../../packages/mps-compliance/src/artifacts/ArtifactReference';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  createGovernedLocalizationAssessment,
  createProductLuPropertyContextArtifact,
  createProductLuProjectContextArtifact,
  type AssessmentFinding,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { installOwnerIssuedProjectContextBinding } from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import { attestProjectContextBindingSupersessionIssuerArtifact } from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { computeGovernedDocumentCheck } from '../../server/modules/localization/governedLayerChecks';
import { recomputeVerifiedDocumentFactContentHash } from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import {
  exportCurrentLuAssessmentPdf,
  resolveCurrentLuAssessmentSummary,
} from '../../server/modules/localization/localizationOrchestrator';
import type { AuthUser } from '../../server/security/types';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import express from 'express';
import request from 'supertest';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

class MemoryRepository {
  readonly values = new Map<string, unknown>();
  readonly resolvedTypes: string[] = [];
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    this.resolvedTypes.push(reference.artifact_type);
    const value = this.values.get(reference.artifact_id);
    if (!value) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return value as T;
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

const PROJECT_ID = 'project-k0-document-check';
const propertyBinding = { artifact_id: 'project-property-binding-k0', artifact_type: 'project_property_binding' } as const;
const geometryRef = { artifact_id: 'geometry-k0', artifact_type: 'CANONICAL_GEOMETRY' } as const;
const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-k0-document-check-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-k0-document-check-test');
const RELEASE_REF = { artifact_id: 'product-release-k0', artifact_type: 'product_release' } as const;
const AUTH_USER: AuthUser = { id: 'user-k0', organisationId: 'org-k0', bankidId: 'bankid:k0', role: 'CONSULTANT' };

const SPATIAL_REFS: ArtifactReference[] = [
  { artifact_id: 'evidence-water-k0', artifact_type: 'SPATIAL_EVIDENCE' },
  { artifact_id: 'evidence-ebh-k0', artifact_type: 'SPATIAL_EVIDENCE' },
];

/** Same object the fresh run must show (tests/unit/luDocumentEvidenceK0Usecase.test.ts). */
const DOCUMENT_NOT_CHECKED = {
  layer: 'document',
  rule_id: 'LU-DOC-BESLUT-001',
  status: 'NOT_CHECKED',
  evidence_artifact_id: null,
  reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED',
} as const;

async function setup() {
  const repository = new MemoryRepository();
  const bindingIndex = new MemoryBindingIndex();
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

  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: 'property-identity-k0',
    property_ref: 'UPPSALA K0 1:1',
    official_name: 'Uppsala K0 1:1',
    geometry_ref: geometryRef,
    municipality: 'Uppsala',
    coordinates: [59.85, 17.63],
    project_property_binding_ref: propertyBinding,
  });
  await repository.put({ artifact_id: propertyContext.artifact_id, body: propertyContext });
  const propertyContextRef = { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type } as const;

  const projectContext = createProductLuProjectContextArtifact({
    project_id: PROJECT_ID,
    project_name: 'K0 document check project',
    description: 'Test project for the K0 document check',
    created_by: AUTH_USER.id,
    property_context_ref: propertyContextRef,
    project_property_binding_ref: propertyBinding,
  });
  await repository.put({ artifact_id: projectContext.artifact_id, body: projectContext });
  const contextRef = { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type } as const;

  const bindingUnsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: contextRef, project_property_binding_ref: propertyBinding,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-10-02T00:00:00.000Z',
  });
  const binding = { ...bindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: bindingUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index: bindingIndex, binding, verification: pcbVerification });
  const bindingRef = { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type } as const;

  const projectionIndex = new FakeAssessmentProjectionIndex();

  /** A real governed assessment pinning exactly `evidenceRefs`, persisted and registered as current. */
  async function persistCurrentAssessment(evidenceRefs: readonly ArtifactReference[], findings: readonly AssessmentFinding[] = []) {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `k0-${Date.now()}-${Math.random()}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-k0-${Date.now()}-${Math.random()}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-k0', artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const assessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-k0', project_context_ref: contextRef, property_ref: propertyContextRef,
        evidence_refs: evidenceRefs, system_summary: `k0 summary ${Math.random()}`,
      },
      findings, outcome, attestation,
    });
    await repository.put({ artifact_id: assessment.artifact_id, body: assessment });
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: bindingRef, releaseRef: RELEASE_REF, index: projectionIndex });
    return assessment;
  }

  const deps = () => ({
    authUser: AUTH_USER,
    projectId: PROJECT_ID,
    artifactRepository: repository as never,
    currentBindingProvider: new ProjectContextBindingProvider(repository as never, bindingIndex, pcbVerification),
    assessmentProjectionIndex: projectionIndex,
  });

  return { repository, bindingIndex, projectionIndex, persistCurrentAssessment, deps };
}

type PdfData = { dokumentkontroll?: Record<string, unknown>; limitations?: string[] };

/** A DOCUMENT_EVIDENCE that passes the read-back's structural check (type, id, content hash present). */
function readableDocumentEvidence(id: string) {
  return { artifact_id: id, artifact_type: 'DOCUMENT_EVIDENCE', content_hash: { algorithm: 'sha256', value: 'd'.repeat(64) }, references: [], payload: {} };
}

/** A self-consistent VERIFIED_DOCUMENT_FACT: its content_hash is recomputed from its own fields. */
function readableVerifiedFact(id: string) {
  const fact = {
    artifact_id: id,
    artifact_type: 'VERIFIED_DOCUMENT_FACT' as const,
    verification_status: 'VERIFIED' as const,
    fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION',
    fact_version: '1.0',
    source_document_ref: { id: 'source-document-k0', content_hash: { algorithm: 'sha256', digest: 'e'.repeat(64) } },
    inventory_ref: { id: 'inventory-k0', content_hash: { algorithm: 'sha256', digest: 'f'.repeat(64) } },
    source_span: { text_projection_ref: { id: 'projection-k0' }, start_offset: 0, end_offset: 10 },
    candidate_ref: { id: 'candidate-k0', content_hash: { algorithm: 'sha256', digest: '1'.repeat(64) } },
    assertion: {
      asserted_by: { identity_ref: { id: 'asserter-k0' }, role: 'MACHINE' },
      assertion_method: 'TEST_FIXTURE',
      asserter_version: '1',
      asserted_at: '2026-10-02T00:00:00.000Z',
    },
    verification: {
      verified_by: { identity_ref: { id: 'reviewer-k0' }, role: 'GOVERNANCE_REVIEWER' },
      verification_method: 'HUMAN_REVIEW',
      verification_policy_version: 'test-policy',
      verified_at: '2026-10-02T00:00:00.000Z',
    },
    signature: { algorithm: 'ed25519', key_id: 'test', value: 'sig' },
    content_hash: { algorithm: 'sha256', digest: '' },
  };
  fact.content_hash.digest = recomputeVerifiedDocumentFactContentHash(fact as never);
  return fact;
}

beforeEach(() => {
  capturedPdfData = undefined;
  hermeticPrismaTouches.length = 0;
});

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('K0b: document check in read-back and PDF (derived from the pinned evidence refs)', () => {
  it('no document evidence pinned -> read-back and PDF both: NOT_CHECKED, NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED', async () => {
    const s = await setup();
    const assessment = await s.persistCurrentAssessment(SPATIAL_REFS);

    const summary = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(summary.ok).toBe(true);
    if (summary.ok !== true) return;
    expect(summary.assessmentArtifactId).toBe(assessment.artifact_id);
    const readBack = (summary as unknown as { documentCheck?: Record<string, unknown> }).documentCheck;
    expect(readBack).toMatchObject(DOCUMENT_NOT_CHECKED);
    expect(readBack!.message_sv).toMatch(/^Dokument och tidigare beslut: inte kontrollerat\./);
    // Same function, same pinned refs: the read-back IS the fresh-run object for this assessment.
    expect(readBack).toEqual(computeGovernedDocumentCheck(assessment.payload.evidence_refs, { findings: assessment.payload.findings }));

    const pdf = await exportCurrentLuAssessmentPdf(s.deps());
    expect(pdf.ok).toBe(true);
    const data = capturedPdfData as PdfData;
    expect(data.dokumentkontroll).toEqual({
      kontroll: 'document',
      regel: 'LU-DOC-BESLUT-001',
      status: 'NOT_CHECKED',
      tillstand: 'NOT_CHECKED',
      orsak: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED',
      underlag_artifact_id: null,
      beskrivning: readBack!.message_sv,
    });
    // Existing fields stay (presentation on top, never a replacement).
    expect(data.limitations).toContain('Inget dokumentunderlag (t.ex. tidigare beslut) ingår ännu i denna bedömning.');
    // Never "checked, no hit" and never a risk grade anywhere in the exported document check.
    expect(JSON.stringify(data.dokumentkontroll)).not.toMatch(/CHECKED_NO_HIT|ingen träff|LOW/);
  });

  // W-U20CDF6 (OD-K0-3): this case asserted CHECKED_HIT ("kontrollerat – träff") with NO finding of LU-DOC-BESLUT-001 --
  // the mere presence of its inputs. The rule did not fire: the row is CHECKED_NO_HIT (only the pinned documents).
  it('DOCUMENT_EVIDENCE + VERIFIED_DOCUMENT_FACT pinned and readable, LU-DOC-BESLUT-001 did NOT fire (no finding) -> CHECKED_NO_HIT in read-back, row and PDF; never "träff", never "inga tidigare beslut"', async () => {
    const s = await setup();
    await s.repository.put({ artifact_id: 'doc-evidence-k0', body: readableDocumentEvidence('doc-evidence-k0') });
    await s.repository.put({ artifact_id: 'verified-fact-k0', body: readableVerifiedFact('verified-fact-k0') });
    await s.persistCurrentAssessment([
      ...SPATIAL_REFS,
      { artifact_id: 'doc-evidence-k0', artifact_type: 'DOCUMENT_EVIDENCE' },
      { artifact_id: 'verified-fact-k0', artifact_type: 'VERIFIED_DOCUMENT_FACT' },
    ]);
    const summary = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(summary.ok, JSON.stringify(summary)).toBe(true);
    const readBack = (summary as unknown as { documentCheck?: Record<string, unknown> }).documentCheck;
    expect(readBack).toMatchObject({ layer: 'document', status: 'CHECKED_NO_HIT', reason: null, evidence_artifact_id: 'doc-evidence-k0' });
    expect(readBack!.message_sv).toBe(
      'Dokument och tidigare beslut: kontrollerat – ingen träff i det dokumentunderlag som är knutet till bedömningen. ' +
        'Regeln om tidigare lokaliseringsbegränsande beslut slog inte till för det. Övriga dokument för fastigheten är inte ' +
        'kontrollerade, och att ingen träff visas betyder inte att det saknas tidigare beslut.',
    );
    expect(String(readBack!.message_sv)).not.toMatch(/kontrollerat – träff|inga tidigare beslut|inga avvikelser|inga risker/i);
    const details = (summary as unknown as { evidenceDetails: Array<Record<string, unknown>> }).evidenceDetails;
    expect(details.find((d) => d.evidence_artifact_id === 'doc-evidence-k0')).toMatchObject({ resolution: 'RESOLVED', integrity: 'STRUCTURAL_ONLY' });
    expect(details.find((d) => d.evidence_artifact_id === 'verified-fact-k0')).toMatchObject({ resolution: 'RESOLVED', integrity: 'CONTENT_HASH_VERIFIED' });
    const checks = (summary as unknown as { governedLayerChecks: Array<Record<string, unknown>> }).governedLayerChecks;
    expect(checks.at(-1)).toMatchObject({ layer: 'document', status: 'CHECKED_NO_HIT', coverage_state: 'CHECKED_NO_HIT' });

    await exportCurrentLuAssessmentPdf(s.deps());
    expect((capturedPdfData as PdfData).dokumentkontroll).toMatchObject({
      status: 'CHECKED_NO_HIT', tillstand: 'CHECKED_NO_HIT', orsak: null, underlag_artifact_id: 'doc-evidence-k0', beskrivning: readBack!.message_sv,
    });
  });

  it('W-U20CDF6 (OD-K0-3): the rule FIRED -- a MEDIUM LU-DOC-BESLUT-001 finding citing the pinned evidence and fact -> CHECKED_HIT in read-back, row and PDF, bound to the cited evidence', async () => {
    const s = await setup();
    await s.repository.put({ artifact_id: 'doc-evidence-k0', body: readableDocumentEvidence('doc-evidence-k0') });
    await s.repository.put({ artifact_id: 'verified-fact-k0', body: readableVerifiedFact('verified-fact-k0') });
    const fired: AssessmentFinding = {
      finding_id: 'finding-doc-beslut-doc-evidence-k0', rule_id: 'LU-DOC-BESLUT-001', rule_version: '1.0', risk_level: 'MEDIUM', explanation: 'x',
      evidence_refs: [
        { artifact_id: 'doc-evidence-k0', artifact_type: 'DOCUMENT_EVIDENCE' },
        { artifact_id: 'verified-fact-k0', artifact_type: 'VERIFIED_DOCUMENT_FACT' },
      ],
    };
    await s.persistCurrentAssessment([
      ...SPATIAL_REFS,
      { artifact_id: 'doc-evidence-k0', artifact_type: 'DOCUMENT_EVIDENCE' },
      { artifact_id: 'verified-fact-k0', artifact_type: 'VERIFIED_DOCUMENT_FACT' },
    ], [fired]);
    const summary = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(summary.ok, JSON.stringify(summary)).toBe(true);
    const readBack = (summary as unknown as { documentCheck?: Record<string, unknown> }).documentCheck;
    expect(readBack).toMatchObject({ layer: 'document', status: 'CHECKED_HIT', reason: null, evidence_artifact_id: 'doc-evidence-k0' });
    expect(readBack!.message_sv).toMatch(/^Dokument och tidigare beslut: kontrollerat – träff\. Regeln om tidigare lokaliseringsbegränsande beslut slog till/);
    expect(readBack!.message_sv).toContain('Övriga dokument för fastigheten är inte kontrollerade.');
    const checks = (summary as unknown as { governedLayerChecks: Array<Record<string, unknown>> }).governedLayerChecks;
    expect(checks.at(-1)).toMatchObject({ layer: 'document', status: 'CHECKED_HIT', coverage_state: 'CHECKED_HIT' });

    await exportCurrentLuAssessmentPdf(s.deps());
    expect((capturedPdfData as PdfData).dokumentkontroll).toMatchObject({ status: 'CHECKED_HIT', orsak: null, underlag_artifact_id: 'doc-evidence-k0' });
  });

  it('W-U20CDF6 (OD-K0-3): a rule finding that cites a document evidence the record does NOT pin -> never a hit and never a no-hit (NOT_CHECKED, FINDING_WITHOUT_CONSISTENT_EVIDENCE, ofullständigt underlag); the finding is still named', async () => {
    const s = await setup();
    await s.repository.put({ artifact_id: 'doc-evidence-k0', body: readableDocumentEvidence('doc-evidence-k0') });
    await s.repository.put({ artifact_id: 'verified-fact-k0', body: readableVerifiedFact('verified-fact-k0') });
    const elsewhere: AssessmentFinding = {
      finding_id: 'finding-doc-beslut-other', rule_id: 'LU-DOC-BESLUT-001', rule_version: '1.0', risk_level: 'MEDIUM', explanation: 'x',
      evidence_refs: [
        { artifact_id: 'doc-evidence-not-pinned', artifact_type: 'DOCUMENT_EVIDENCE' },
        { artifact_id: 'verified-fact-k0', artifact_type: 'VERIFIED_DOCUMENT_FACT' },
      ],
    };
    await s.persistCurrentAssessment([
      ...SPATIAL_REFS,
      { artifact_id: 'doc-evidence-k0', artifact_type: 'DOCUMENT_EVIDENCE' },
      { artifact_id: 'verified-fact-k0', artifact_type: 'VERIFIED_DOCUMENT_FACT' },
    ], [elsewhere]);
    const summary = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(summary.ok, JSON.stringify(summary)).toBe(true);
    const readBack = (summary as unknown as { documentCheck?: Record<string, unknown> }).documentCheck;
    expect(readBack).toMatchObject({ layer: 'document', status: 'NOT_CHECKED', reason: 'FINDING_WITHOUT_CONSISTENT_EVIDENCE', evidence_artifact_id: 'doc-evidence-k0' });
    expect(String(readBack!.message_sv)).toMatch(/^Dokument och tidigare beslut: ofullständigt underlag\./);
    const checks = (summary as unknown as { governedLayerChecks: Array<Record<string, unknown>> }).governedLayerChecks;
    expect(checks.at(-1)).toMatchObject({ layer: 'document', status: 'NOT_CHECKED', coverage_state: 'INCOMPLETE_EVIDENCE' });
    const statement = (summary as unknown as { overallStatement: { coverage: unknown; statement_sv: string } }).overallStatement;
    expect(statement.coverage).toBeNull();
    expect(statement.statement_sv).toContain('risknivå måttlig – Dokument och tidigare beslut');
    expect(statement.statement_sv).not.toMatch(/\b\d+ av \d+ kontroller/);
  });

  // U20CDF (U20CD verification F3; owner decision OD-R2; DIRECTIVE-72H section 11). This case used
  // to require CHECKED_HIT ("kontrollerat – träff") while the same answer reported both pinned
  // document artifacts as EVIDENCE_NOT_FOUND. A pinned document artifact that cannot be read is a
  // technical error -- the same class as unreadable spatial evidence -- and never a hit.
  it('DOCUMENT_EVIDENCE + VERIFIED_DOCUMENT_FACT pinned but NOT readable from CAS -> technical error in read-back and PDF, never a hit', async () => {
    const s = await setup();
    await s.persistCurrentAssessment([
      ...SPATIAL_REFS,
      { artifact_id: 'doc-evidence-k0', artifact_type: 'DOCUMENT_EVIDENCE' },
      { artifact_id: 'verified-fact-k0', artifact_type: 'VERIFIED_DOCUMENT_FACT' },
    ]);
    const summary = await resolveCurrentLuAssessmentSummary(s.deps());
    expect(summary.ok).toBe(true);
    const readBack = (summary as unknown as { documentCheck?: Record<string, unknown> }).documentCheck;
    expect(readBack).toEqual({
      layer: 'document',
      rule_id: 'LU-DOC-BESLUT-001',
      status: 'NOT_CHECKED',
      evidence_artifact_id: 'doc-evidence-k0',
      reason: 'PINNED_EVIDENCE_UNREADABLE',
      message_sv: expect.stringMatching(/^Dokument och tidigare beslut: tekniskt fel\./),
    });
    expect(String(readBack!.message_sv)).not.toMatch(/träff/);
    const details = (summary as unknown as { evidenceDetails: Array<Record<string, unknown>> }).evidenceDetails;
    for (const id of ['doc-evidence-k0', 'verified-fact-k0']) {
      expect(details.find((d) => d.evidence_artifact_id === id)).toMatchObject({
        resolution: 'NOT_FOUND', technical_error_class: 'EVIDENCE_NOT_FOUND',
      });
    }
    // The presented row is the same check, as TECHNICAL_ERROR (like spatial), and is not counted as done.
    const checks = (summary as unknown as { governedLayerChecks: Array<Record<string, unknown>> }).governedLayerChecks;
    const { coverage_state, coverage_limitation_sv: _limitation, known_coverage_gaps: _gaps, ...documentRow } = checks.at(-1)!;
    expect(coverage_state).toBe('TECHNICAL_ERROR');
    expect(documentRow).toEqual(readBack);
    // U20CDF2 (U20CDF verification G2; owner): pinned refs whose CAS objects cannot be read make the
    // whole record an integrity/technical error -- no N-of-M count is reconstructed from what happens
    // to be readable (U20CDF asserted the count here, with 'document' among the not-completed layers).
    const statement = (summary as unknown as {
      overallStatement: { coverage_state: string; coverage: unknown; statement_sv: string; pinned_evidence: Record<string, unknown> };
    }).overallStatement;
    expect(statement.coverage_state).toBe('PINNED_EVIDENCE_UNREADABLE');
    expect(statement.coverage).toBeNull();
    expect(statement.pinned_evidence).toMatchObject({
      unreadable_artifact_ids: expect.arrayContaining(['doc-evidence-k0', 'verified-fact-k0']),
      technical_error_class: 'EVIDENCE_NOT_FOUND',
      retryable: false,
    });
    expect(statement.statement_sv).toMatch(/^Den pinnade evidensen kan inte verifieras: /);
    expect(statement.statement_sv).not.toMatch(/\b\d+ av \d+ kontroller|träff/);

    await exportCurrentLuAssessmentPdf(s.deps());
    expect((capturedPdfData as PdfData).dokumentkontroll).toMatchObject({
      status: 'NOT_CHECKED', orsak: 'PINNED_EVIDENCE_UNREADABLE', underlag_artifact_id: 'doc-evidence-k0',
    });
    expect(JSON.stringify((capturedPdfData as PdfData).dokumentkontroll)).not.toMatch(/CHECKED_HIT|träff/);
  });

  it('stored findings do not move the check: an LU-DOC-BESLUT-001 finding without pinned document refs stays NOT_CHECKED', async () => {
    const s = await setup();
    const docFinding: AssessmentFinding = {
      finding_id: 'finding-doc-beslut-x', rule_id: 'LU-DOC-BESLUT-001', rule_version: '1.0', risk_level: 'MEDIUM',
      explanation: 'x', evidence_refs: [],
    };
    await s.persistCurrentAssessment(SPATIAL_REFS, [docFinding]);
    const summary = await resolveCurrentLuAssessmentSummary(s.deps());
    expect((summary as unknown as { documentCheck?: unknown }).documentCheck).toMatchObject(DOCUMENT_NOT_CHECKED);
  });
});

describe('K0b: HTTP GET /api/localization/:projectId/current-assessment (real router + requireAuth)', () => {
  it('the read-back body carries documentCheck next to every pre-existing field', async () => {
    const s = await setup();
    const assessment = await s.persistCurrentAssessment(SPATIAL_REFS);
    routeState.repository = s.repository;
    routeState.bindingIndex = s.bindingIndex;
    routeState.projectionIndex = s.projectionIndex;
    routeState.verification = pcbVerification;
    const app = express();
    app.use(express.json());
    app.use(localizationRoutes);
    const token = createTokenPair({ id: AUTH_USER.id, organisationId: AUTH_USER.organisationId, bankidId: AUTH_USER.bankidId, role: 'ADMIN' }).accessToken;

    const res = await request(app).get(`/api/localization/${PROJECT_ID}/current-assessment`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual([
      'ok', 'assessmentArtifactId', 'findings', 'ruleRefs', 'evidenceRefs', 'systemSummary', 'localizationGeometry', 'documentCheck',
      // U20-D: additions after every pre-existing field.
      'governedLayerChecks', 'evidenceDetails', 'propertyRoot', 'overallStatement', 'overall_summary',
    ]);
    expect(res.body.assessmentArtifactId).toBe(assessment.artifact_id);
    expect(res.body.documentCheck).toMatchObject(DOCUMENT_NOT_CHECKED);
    expect(res.body.documentCheck).toEqual(computeGovernedDocumentCheck(assessment.payload.evidence_refs, { findings: assessment.payload.findings }));
  });
});

describe('K0b: computeGovernedDocumentCheck (pure)', () => {
  const DE = (id: string) => ({ artifact_id: id, artifact_type: 'DOCUMENT_EVIDENCE' });
  const VF = (id: string) => ({ artifact_id: id, artifact_type: 'VERIFIED_DOCUMENT_FACT' });
  const SE = (id: string) => ({ artifact_id: id, artifact_type: 'SPATIAL_EVIDENCE' });
  /** W-U20CDF6: a finding of LU-DOC-BESLUT-001 as LURuleEngine writes it -- the evidence, then the matching facts. */
  const FIRED = (evidenceId: string, factId: string) => ({
    finding_id: `finding-doc-beslut-${evidenceId}`, rule_id: 'LU-DOC-BESLUT-001', rule_version: '1.0', risk_level: 'MEDIUM', explanation: 'x',
    evidence_refs: [DE(evidenceId), VF(factId)],
  });

  it.each<[string, unknown, string, string | null, string | null]>([
    ['no refs', [], 'NOT_CHECKED', 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED', null],
    ['spatial only', [SE('s1')], 'NOT_CHECKED', 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED', null],
    ['verified fact without document evidence', [VF('f1')], 'NOT_CHECKED', 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED', null],
    ['document evidence without verified fact', [SE('s1'), DE('d1')], 'NOT_CHECKED', 'DOCUMENT_EVIDENCE_WITHOUT_VERIFIED_FACT_PINNED', 'd1'],
    // W-U20CDF6 (OD-K0-3): was CHECKED_HIT -- the inputs pinned, but no finding: the rule did not fire.
    ['document evidence + verified fact, no finding of the rule', [DE('d2'), VF('f1'), DE('d1')], 'CHECKED_NO_HIT', null, 'd1'],
    ['refs not an array', undefined, 'NOT_CHECKED', 'PINNED_EVIDENCE_REFS_UNREADABLE', null],
    ['refs an object', { artifact_type: 'DOCUMENT_EVIDENCE' }, 'NOT_CHECKED', 'PINNED_EVIDENCE_REFS_UNREADABLE', null],
    // U20CDF (K0-FIX-1 c): malformed entries are still never counted, but the reason now says so
    // exactly (was NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED); the status stays NOT_CHECKED.
    ['malformed entries are never counted; the reason says they are malformed', [null, 7, { artifact_type: 'DOCUMENT_EVIDENCE' }, { artifact_id: '', artifact_type: 'DOCUMENT_EVIDENCE' }], 'NOT_CHECKED', 'MALFORMED_DOCUMENT_REFS', null],
    ['a document type in the wrong spelling is malformed', [SE('s1'), { artifact_id: 'd1', artifact_type: 'document_evidence' }], 'NOT_CHECKED', 'MALFORMED_DOCUMENT_REFS', null],
    ['a document ref with a numeric id is malformed', [DE('d1'), { artifact_id: 42, artifact_type: 'VERIFIED_DOCUMENT_FACT' }], 'NOT_CHECKED', 'MALFORMED_DOCUMENT_REFS', 'd1'],
    ['an entry without a type is malformed', [{ artifact_id: 'x' }], 'NOT_CHECKED', 'MALFORMED_DOCUMENT_REFS', null],
    ['a malformed non-document ref is not a document problem', [{ artifact_id: '', artifact_type: 'SPATIAL_EVIDENCE' }], 'NOT_CHECKED', 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED', null],
  ])('%s', (_label, refs, status, reason, evidenceId) => {
    const check = computeGovernedDocumentCheck(refs, { findings: [] });
    expect(check).toMatchObject({ layer: 'document', rule_id: 'LU-DOC-BESLUT-001', status, reason, evidence_artifact_id: evidenceId });
    expect(check.message_sv).toMatch(/^Dokument och tidigare beslut: /);
  });

  it('U20CDF: a pinned document artifact that could not be read is PINNED_EVIDENCE_UNREADABLE, never a hit; other unreadable refs do not matter', () => {
    const refs = [SE('s1'), DE('d1'), VF('f1')];
    expect(computeGovernedDocumentCheck(refs, { findings: [], unreadableArtifactIds: ['f1'] })).toMatchObject({
      status: 'NOT_CHECKED', reason: 'PINNED_EVIDENCE_UNREADABLE', evidence_artifact_id: 'f1',
    });
    expect(computeGovernedDocumentCheck(refs, { findings: [], unreadableArtifactIds: ['f1', 'd1'] })).toMatchObject({
      status: 'NOT_CHECKED', reason: 'PINNED_EVIDENCE_UNREADABLE', evidence_artifact_id: 'd1',
    });
    expect(computeGovernedDocumentCheck([SE('s1'), DE('d1')], { findings: [], unreadableArtifactIds: ['d1'] })).toMatchObject({
      status: 'NOT_CHECKED', reason: 'PINNED_EVIDENCE_UNREADABLE',
    });
    // An unreadable SPATIAL ref is the spatial row's business; the document check is unchanged.
    expect(computeGovernedDocumentCheck(refs, { findings: [], unreadableArtifactIds: ['s1'] })).toEqual(computeGovernedDocumentCheck(refs, { findings: [] }));
    // W-U20CDF6 (OD-K0-3): readable inputs and no finding of the rule -> no hit (was CHECKED_HIT).
    expect(computeGovernedDocumentCheck(refs, { findings: [], unreadableArtifactIds: [] })).toMatchObject({ status: 'CHECKED_NO_HIT' });
    // A rule finding never turns an unreadable pinned document into a hit or a no-hit: the technical error comes first.
    expect(computeGovernedDocumentCheck(refs, { findings: [FIRED('d1', 'f1')], unreadableArtifactIds: ['d1'] })).toMatchObject({
      status: 'NOT_CHECKED', reason: 'PINNED_EVIDENCE_UNREADABLE',
    });
  });

  // W-U20CDF6 (OD-K0-3): replaces "never CHECKED_NO_HIT ... for any combination of pinned ref types" (K0's v1 rule,
  // when the presence of DE + VF alone was the hit). Over every combination of pinned ref types and of the rule's
  // findings: CHECKED_HIT exactly when a HIGH/MEDIUM/LOW finding of the rule cites a pinned DE and a pinned VF (and no
  // NOT_CHECKED finding of the rule stands beside it); CHECKED_NO_HIT exactly when DE + VF are pinned, nothing is
  // malformed and the rule has no finding at all; otherwise NOT_CHECKED. A "no hit" text only on CHECKED_NO_HIT.
  it('CHECKED_HIT exactly when the rule fired on the pinned documents, CHECKED_NO_HIT exactly when its pinned inputs are there and it did not fire -- over every combination of refs and rule findings', () => {
    const pool = [SE('s1'), DE('d1'), VF('f1'), { artifact_id: 'x', artifact_type: 'OTHER' }, { artifact_id: 'd9', artifact_type: 'document_evidence' }];
    const findingSets: ReadonlyArray<readonly [string, readonly unknown[]]> = [
      ['none', []],
      ['fired on d1+f1', [FIRED('d1', 'f1')]],
      ['fired on an unpinned evidence', [FIRED('d-other', 'f1')]],
      ['fired, cites no fact', [{ ...FIRED('d1', 'f1'), evidence_refs: [DE('d1')] }]],
      ['NOT_CHECKED of the rule', [{ ...FIRED('d1', 'f1'), risk_level: 'NOT_CHECKED' }]],
      ['fired + NOT_CHECKED beside it', [FIRED('d1', 'f1'), { ...FIRED('d1', 'f1'), finding_id: 'nc', risk_level: 'NOT_CHECKED' }]],
      ['unknown severity of the rule', [{ ...FIRED('d1', 'f1'), risk_level: 'CRITICAL' }]],
      ['a finding of another rule only', [{ ...FIRED('d1', 'f1'), rule_id: 'LU-WATER-001' }]],
    ];
    for (let mask = 0; mask < 1 << pool.length; mask += 1) {
      const refs = pool.filter((_, i) => mask & (1 << i));
      const inputsPinned = refs.some((r) => r.artifact_type === 'DOCUMENT_EVIDENCE') && refs.some((r) => r.artifact_type === 'VERIFIED_DOCUMENT_FACT');
      const malformed = refs.some((r) => r.artifact_type === 'document_evidence');
      for (const [label, findings] of findingSets) {
        const check = computeGovernedDocumentCheck(refs, { findings });
        const rule = findings.filter((f) => (f as { rule_id?: string }).rule_id === 'LU-DOC-BESLUT-001') as Array<{ risk_level: string; evidence_refs: Array<{ artifact_id: string }> }>;
        const fired =
          inputsPinned &&
          rule.some((f) => ['HIGH', 'MEDIUM', 'LOW'].includes(f.risk_level) && f.evidence_refs.some((r) => r.artifact_id === 'd1') && f.evidence_refs.some((r) => r.artifact_id === 'f1')) &&
          !rule.some((f) => f.risk_level === 'NOT_CHECKED');
        const noHit = inputsPinned && !malformed && rule.length === 0;
        const at = `${label} / ${refs.map((r) => r.artifact_type).join(',')}`;
        expect(check.status, at).toBe(fired ? 'CHECKED_HIT' : noHit ? 'CHECKED_NO_HIT' : 'NOT_CHECKED');
        if (check.status === 'CHECKED_HIT') expect(check.evidence_artifact_id, at).toBe('d1');
        if (check.status !== 'CHECKED_NO_HIT') expect(check.message_sv, at).not.toMatch(/ingen träff/i);
        expect(check.message_sv, at).not.toMatch(/inga tidigare beslut|inga avvikelser|inga risker|oförorenad/i);
      }
    }
  });

  it('W-U20CDF6 (OD-K0-3): of two pinned document evidences the hit names the one the rule fired on (K0 verification finding 2: it used to name the smallest id)', () => {
    const check = computeGovernedDocumentCheck([DE('d-a'), DE('d-b'), VF('f1')], { findings: [FIRED('d-b', 'f1')] });
    expect(check).toMatchObject({ status: 'CHECKED_HIT', evidence_artifact_id: 'd-b' });
  });

  it('W-U20CDF6 (OD-K0-3): a findings field that is not a list cannot say whether the rule fired -> NOT_CHECKED (MALFORMED_RECORD_ENTRY), never a no-hit', () => {
    for (const findings of [undefined, null, 'x', { 0: FIRED('d1', 'f1') }]) {
      expect(computeGovernedDocumentCheck([DE('d1'), VF('f1')], { findings })).toMatchObject({ status: 'NOT_CHECKED', reason: 'MALFORMED_RECORD_ENTRY' });
    }
  });
});
