/**
 * W-BOOT, on the APR verifier's findings F2, F1 and F4 (APR-VERIFICATION.md, 2026-10-02):
 *
 * F2 -- "no binding registered" must mean exactly that. Binding-index rows are append-only, every
 * supersession row and every assessment-projection row names a binding, so when such rows remain for a
 * project whose binding rows are gone, the binding index has LOST rows: that is a lasting integrity
 * fault, never genuine absence (404 "no assessment") -- and never a reason for the bootstrap to mint a
 * new binding (luProjectContextBootstrap*BOOT tests).
 *  - ProjectContextBindingProvider.resolveCurrent: `noBindingRegistered` only when the index lists
 *    neither a binding nor a supersession; supersession rows without any binding row are the typed
 *    cause PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT.
 *  - resolveCurrentAssessmentProjection: projection rows for the project + no binding (or the typed
 *    cause) -> AssessmentProjectionBindingUnresolvableError BINDING_INDEX_INCONSISTENT, not retryable.
 *
 * F1 -- a projection row that names a binding OUTSIDE the project's verified binding graph proves that
 * binding rows were lost (rows are only written under a registered binding). The selection must not
 * fall back to the remaining older head and present its assessment: the row is
 * PROJECTION_ROW_INCONSISTENT and the resolution fails closed. What stays undetected (every row that
 * shows the newer binding existed lost together) is the machine-readable KNOWN_LIMITATION
 * ASSESSMENT_PROJECTION_CURRENTNESS_CORRELATED_METADATA_LOSS, pinned below -- NOT approved behaviour.
 *
 * F4 -- the identity clause (`artifact_id === assessment-<recomputed hash>`): a candidate re-hashed
 * under its old id is TAMPERED, never "verified" and never skipped as "proven not current".
 *
 * Fixture as in luAssessmentProjectionForwardOnlyAPR.test.ts: real signed bindings and a real signed
 * supersession, the real ProjectContextBindingProvider, in-memory indexes with the Prisma contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '../../packages/mps-compliance/src/artifacts/ArtifactReference';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import {
  createGovernedLocalizationAssessment,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  localizationAssessmentCanonicalBody,
  type LocalizationAssessmentArtifact,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProjectContextBindingSupersessionArtifact,
  attestProjectContextBindingSupersessionIssuerArtifact,
} from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type {
  ProjectAssessmentProjectionIndex,
  ProjectAssessmentProjectionRow,
} from '../../server/repositories/projectAssessmentProjectionRepository';
import * as assessmentProjection from '../../server/modules/localization/assessmentProjection';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const { registerAssessmentProjection, resolveCurrentAssessmentProjection } = assessmentProjection;

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

const PROJECT_ID = 'project-binding-index-loss-boot';
const contextOld = { artifact_id: 'lu-context-boot-old', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const contextNew = { artifact_id: 'lu-context-boot-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-boot', artifact_type: 'project_property_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-boot', artifact_type: 'product_release' } as const;
const POINT_A = { artifact_id: 'localization-geometry-boot-a', artifact_type: 'localization_geometry' } as const;
const POINT_B = { artifact_id: 'localization-geometry-boot-b', artifact_type: 'localization_geometry' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-boot-index-loss');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const supersessionKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-boot-index-loss');

class MemoryRepository {
  readonly values = new Map<string, unknown>();
  readonly reads: string[] = [];
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    this.reads.push(reference.artifact_id);
    const value = this.values.get(reference.artifact_id);
    if (value === undefined) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return value as T;
  }
}

/** The Prisma binding index's contract, plus the row LOSS the verifier's probes simulate. */
class MemoryBindingIndex implements ProjectContextBindingIndex {
  readonly bindings: Array<{ projectId: string; ref: ArtifactReference; context: ArtifactReference }> = [];
  readonly supersessions: Array<{ projectId: string; ref: ArtifactReference }> = [];
  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    if (this.bindings.some((b) => b.ref.artifact_id === binding.artifact_id)) return;
    this.bindings.push({
      projectId: binding.payload.project_id,
      ref: { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type },
      context: binding.payload.project_context_ref,
    });
  }
  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const rows = this.bindings.filter((b) => b.projectId === projectId && b.context.artifact_id === context.artifact_id && b.context.artifact_type === context.artifact_type);
    if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
    return rows[0]!.ref.artifact_id;
  }
  async registerSupersession(supersession: ReturnType<typeof createProjectContextBindingSupersessionArtifact>): Promise<void> {
    if (this.supersessions.some((s) => s.ref.artifact_id === supersession.artifact_id)) return;
    this.supersessions.push({ projectId: supersession.payload.project_id, ref: { artifact_id: supersession.artifact_id, artifact_type: supersession.artifact_type } });
  }
  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.bindings.filter((b) => b.projectId === projectId).map((b) => b.ref);
  }
  async listSupersessionRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.supersessions.filter((s) => s.projectId === projectId).map((s) => s.ref);
  }
  async findProjectContextRef(): Promise<ArtifactReference> {
    throw new Error('not used by the projection');
  }
  loseBindingRow(bindingId: string): void {
    this.bindings.splice(this.bindings.findIndex((b) => b.ref.artifact_id === bindingId), 1);
  }
  loseSupersessionRows(): void {
    this.supersessions.length = 0;
  }
}

class MemoryProjectionIndex implements ProjectAssessmentProjectionIndex {
  private counter = 0;
  readonly rows: ProjectAssessmentProjectionRow[] = [];
  async register(row: {
    projectId: string; assessmentArtifactId: string; assessmentArtifactType: string; projectContextRef: ArtifactReference;
    bindingArtifactId: string; releaseArtifactId: string; localizationGeometryArtifactId?: string | null;
  }): Promise<void> {
    if (this.rows.some((r) => r.projectId === row.projectId && r.assessmentArtifactId === row.assessmentArtifactId)) return;
    this.counter += 1;
    this.rows.push({
      projectId: row.projectId, assessmentArtifactId: row.assessmentArtifactId, assessmentArtifactType: row.assessmentArtifactType,
      projectContextRefId: row.projectContextRef.artifact_id, projectContextRefType: row.projectContextRef.artifact_type,
      bindingArtifactId: row.bindingArtifactId, releaseArtifactId: row.releaseArtifactId,
      localizationGeometryArtifactId: row.localizationGeometryArtifactId ?? null, createdAt: new Date(this.counter * 1000),
    });
  }
  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    return this.rows.filter((r) => r.projectId === projectId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  loseRow(assessmentId: string): void {
    this.rows.splice(this.rows.findIndex((r) => r.assessmentArtifactId === assessmentId), 1);
  }
}

/** B1 (old context) superseded by B2 (new context), both real signed bindings with a real signed relation. */
async function setup() {
  const repository = new MemoryRepository();
  const bindingIndex = new MemoryBindingIndex();
  const index = new MemoryProjectionIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = supersessionKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = supersessionKey.publicKey;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const bareIssuer = createProjectContextBindingSupersessionIssuerArtifact({ issuer_key_id: supersessionKey.provider.keyId, owner_authority_ref: pcbAuthority });
  const supersessionIssuer = { ...bareIssuer, attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: bareIssuer, signing: supersessionKey.provider }) };
  await repository.put({ artifact_id: supersessionIssuer.artifact_id, body: supersessionIssuer });

  async function binding(context: ArtifactReference, createdAt: string): Promise<ArtifactReference> {
    const unsigned = createProjectContextBindingArtifact({
      project_id: PROJECT_ID, project_context_ref: context, project_property_binding_ref: propertyBinding,
      binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: createdAt,
    });
    const signed = { ...unsigned, attestation: await attestProjectContextBindingArtifact({ artifact: unsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
    await installOwnerIssuedProjectContextBinding({ artifactRepository: repository as never, index: bindingIndex, binding: signed, verification: pcbVerification });
    return { artifact_id: signed.artifact_id, artifact_type: signed.artifact_type };
  }
  const b1 = await binding(contextOld, '2026-10-01T00:00:00.000Z');
  const b2 = await binding(contextNew, '2026-10-02T00:00:00.000Z');
  const unsignedRelation = createProjectContextBindingSupersessionArtifact({
    contract_version: 'PROJECT_CONTEXT_BINDING_SUPERSESSION_V1', project_id: PROJECT_ID,
    superseded_binding_ref: b1, successor_binding_ref: b2, reason_code: 'W_BOOT_TEST_SUPERSESSION',
    issuer_ref: { artifact_id: supersessionIssuer.artifact_id, artifact_type: supersessionIssuer.artifact_type },
    issuer_key_id: supersessionKey.provider.keyId, issued_at: '2026-10-02T00:01:00.000Z',
  });
  const relation = {
    ...unsignedRelation,
    attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: unsignedRelation, issuer: supersessionIssuer, signing: supersessionKey.provider }),
  };
  await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repository as never, index: bindingIndex, supersession: relation, verification: pcbVerification });

  async function assessment(label: string, context: ArtifactReference, point?: ArtifactReference): Promise<LocalizationAssessmentArtifact> {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `boot-${label}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-boot-${label}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: `attempt-boot-${label}`, artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', label }),
    };
    const created = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-boot', project_context_ref: context, property_ref: { artifact_id: 'property-boot', artifact_type: 'PROPERTY' },
        evidence_refs: [], system_summary: `assessment ${label}`, ...(point ? { localization_geometry_ref: point } : {}),
      },
      findings: [], outcome, attestation: security.attestOutcome(outcome.content_hash),
    });
    await repository.put({ artifact_id: created.artifact_id, body: created });
    return created;
  }
  async function register(a: LocalizationAssessmentArtifact, bindingRef: ArtifactReference, point?: ArtifactReference, projectId = PROJECT_ID) {
    await registerAssessmentProjection({
      projectId, assessment: a, contextBindingRef: bindingRef, releaseRef: RELEASE_REF,
      ...(point ? { localizationGeometryArtifactId: point.artifact_id } : {}), index,
    });
  }
  const provider = () => new ProjectContextBindingProvider(repository as never, bindingIndex, pcbVerification);
  function resolve(currentPoint?: ArtifactReference, projectId = PROJECT_ID) {
    return resolveCurrentAssessmentProjection({
      projectId, artifactRepository: repository as never, currentBindingProvider: provider(),
      ...(currentPoint ? { currentLocalizationGeometryArtifactId: currentPoint.artifact_id } : {}), index,
    });
  }
  return { repository, bindingIndex, index, b1, b2, relation, assessment, register, resolve, provider };
}

type Outcome = { readonly resolved: string } | { readonly error: Error & Record<string, unknown> };
async function outcomeOf(promise: Promise<{ assessmentArtifactId: string }>): Promise<Outcome> {
  return promise.then((r) => ({ resolved: r.assessmentArtifactId }), (error: Error & Record<string, unknown>) => ({ error }));
}
function errorOf(outcome: Outcome): Error & Record<string, unknown> {
  expect('error' in outcome, `expected fail closed, got ${JSON.stringify(outcome)}`).toBe(true);
  return (outcome as { error: Error & Record<string, unknown> }).error;
}
function expectIndexInconsistent(outcome: Outcome): void {
  const error = errorOf(outcome);
  expect(error.message, 'lost binding-index rows are never "no assessment" (404)').not.toMatch(/^REJECT_/);
  expect({ code: error.code, reason: error.reason, retryable: error.retryable, refusalCode: error.refusalCode }).toEqual({
    code: 'ASSESSMENT_PROJECTION_BINDING_UNRESOLVABLE',
    reason: 'BINDING_INDEX_INCONSISTENT',
    retryable: false,
    refusalCode: null,
  });
}

describe('W-BOOT / APR F2: ProjectContextBindingProvider.resolveCurrent -- noBindingRegistered only when the index lists nothing at all', () => {
  it('supersession rows remain while every binding row is lost -> NOT noBindingRegistered; the cause is the typed index inconsistency', async () => {
    const s = await setup();
    s.bindingIndex.loseBindingRow(s.b1.artifact_id);
    s.bindingIndex.loseBindingRow(s.b2.artifact_id);
    const error = await s.provider().resolveCurrent(PROJECT_ID).then(() => null, (e: unknown) => e as Error & Record<string, unknown>);
    expect(error).not.toBeNull();
    expect(error!.message).toBe('REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE');
    expect(error!.noBindingRegistered).toBe(false);
    expect((error!.cause as { code?: unknown }).code).toBe('PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT');
  });

  it('nothing registered for the project -> noBindingRegistered, empty-graph cause (unchanged)', async () => {
    const s = await setup();
    const error = await s.provider().resolveCurrent('project-never-bootstrapped-boot').then(() => null, (e: unknown) => e as Error & Record<string, unknown>);
    expect(error!.noBindingRegistered).toBe(true);
    expect((error!.cause as Error).message).toBe('REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings');
  });
});

describe('W-BOOT / APR F2: the selection -- projection rows without a registered binding are lost binding rows, never 404', () => {
  it('every binding row lost, the supersession row kept -> BINDING_INDEX_INCONSISTENT (not retryable), nothing read', async () => {
    const s = await setup();
    const y = await s.assessment('y', contextNew);
    await s.register(y, s.b2);
    s.bindingIndex.loseBindingRow(s.b1.artifact_id);
    s.bindingIndex.loseBindingRow(s.b2.artifact_id);
    expectIndexInconsistent(await outcomeOf(s.resolve()));
    expect(s.repository.reads).not.toContain(y.artifact_id);
  });

  it('every binding row AND the supersession row lost, the projection row kept -> BINDING_INDEX_INCONSISTENT, never 404', async () => {
    const s = await setup();
    const y = await s.assessment('y-alone', contextNew);
    await s.register(y, s.b2);
    s.bindingIndex.loseBindingRow(s.b1.artifact_id);
    s.bindingIndex.loseBindingRow(s.b2.artifact_id);
    s.bindingIndex.loseSupersessionRows();
    expectIndexInconsistent(await outcomeOf(s.resolve()));
    expect(s.repository.reads).not.toContain(y.artifact_id);
  });

  it('a project without any projection row stays genuine absence (404), unchanged', async () => {
    const s = await setup();
    const error = errorOf(await outcomeOf(s.resolve(undefined, 'project-without-rows-boot')));
    expect(error.message).toBe('REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no assessment projection for project');
  });
});

describe('W-BOOT / APR F1: a projection row naming a binding outside the verified binding graph fails the selection closed', () => {
  async function u4(): Promise<{ s: Awaited<ReturnType<typeof setup>>; x: LocalizationAssessmentArtifact; y: LocalizationAssessmentArtifact }> {
    const s = await setup();
    const x = await s.assessment('x-under-b1', contextOld, POINT_B);
    const y = await s.assessment('y-under-b2', contextNew, POINT_B);
    await s.register(x, s.b1, POINT_B);
    await s.register(y, s.b2, POINT_B);
    return { s, x, y };
  }

  it('control: intact -> Y (the assessment under the current binding B2)', async () => {
    const { s, y } = await u4();
    expect(await outcomeOf(s.resolve(POINT_B))).toEqual({ resolved: y.artifact_id });
  });

  it('control: only the supersession row lost -> refused as two heads (REFUSED), never X', async () => {
    const { s, x } = await u4();
    s.bindingIndex.loseSupersessionRows();
    const error = errorOf(await outcomeOf(s.resolve(POINT_B)));
    expect({ reason: error.reason, refusalCode: error.refusalCode }).toEqual({ reason: 'REFUSED', refusalCode: 'REJECT_PROJECT_CONTEXT_BINDING_HEAD' });
    expect(s.repository.reads).not.toContain(x.artifact_id);
  });

  it.each([
    ['binding-only eligibility', undefined],
    ['current binding AND current point', POINT_B],
  ] as const)('U4b (%s): B2\'s binding row AND the supersession row lost -> Y\'s row names B2, outside the graph -> PROJECTION_ROW_INCONSISTENT; X is never presented', async (_variant, point) => {
    const { s, x, y } = await u4();
    s.bindingIndex.loseBindingRow(s.b2.artifact_id);
    s.bindingIndex.loseSupersessionRows();
    // B2, the relation and Y are all intact in CAS -- only index rows are gone.
    expect(await s.repository.resolve({ artifact_id: s.b2.artifact_id, artifact_type: 'project_context_binding' })).toBeDefined();
    const outcome = await outcomeOf(s.resolve(point));
    expect(outcome, 'the older assessment X was presented as current after binding-index rows were lost').not.toEqual({ resolved: x.artifact_id });
    const error = errorOf(outcome);
    expect(error.message).not.toMatch(/^REJECT_/);
    expect({ code: error.code, retryable: error.retryable, faults: error.faults }).toEqual({
      code: 'ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE',
      retryable: false,
      faults: [{ assessmentArtifactId: y.artifact_id, reason: 'PROJECTION_ROW_INCONSISTENT', retryable: false }],
    });
  });
});

describe('W-BOOT / APR F1 (b): KNOWN_LIMITATION ASSESSMENT_PROJECTION_CURRENTNESS_CORRELATED_METADATA_LOSS -- NOT approved behaviour', () => {
  // W-CATCH2 (BOOT verifier findings 2 and 6, owner decision (4) p.6, 2026-10-03): the TYPE column is no
  // longer part of the undetectable remainder (an unknown type value is detectable and fails closed, see
  // the type-column block below), and the owner has accepted the remaining class as an explicit PRODUCT
  // LIMITATION -- documented, not approved behaviour. Before: "... punkt- och typkolumner ..." and
  // owner_decision "OPEN".
  it('the machine-readable marker carries exactly this meaning; the owner accepted it as an explicit product limitation (not approved behaviour)', () => {
    expect((assessmentProjection as Record<string, unknown>).ASSESSMENT_PROJECTION_CURRENTNESS_KNOWN_LIMITATION).toEqual({
      code: 'KNOWN_LIMITATION',
      id: 'ASSESSMENT_PROJECTION_CURRENTNESS_CORRELATED_METADATA_LOSS',
      meaning_sv:
        'valet av aktuell bedömning är fail-closed för detekterbara fel men inte bevisat mot korrelerad förlust eller förvanskning av all metadata som visar att en nyare bedömning eller bindning existerat (bedömningens projektionsrad med dess bindnings- och punktkolumner samt bindningsindexets bindnings- och ersättningsrader)',
      owner_decision:
        'ACCEPTED 2026-10-03 (owner decision (4) p.6) as an explicit PRODUCT LIMITATION, documented and NOT approved behaviour; analogous to LOCALIZATION_GEOMETRY_CURRENTNESS_CORRELATED_METADATA_LOSS; the structural fix (a signed current relation or a CAS-anchored head pointer) is not built',
    });
    expect(Object.isFrozen((assessmentProjection as Record<string, unknown>).ASSESSMENT_PROJECTION_CURRENTNESS_KNOWN_LIMITATION)).toBe(true);
  });

  it('KNOWN_LIMITATION, pinned: B2\'s binding row, the supersession row AND Y\'s projection row all lost -> X resolves although B2, the relation and Y are intact in CAS', async () => {
    const s = await setup();
    const x = await s.assessment('x-known-limitation', contextOld);
    const y = await s.assessment('y-known-limitation', contextNew);
    await s.register(x, s.b1);
    await s.register(y, s.b2);
    s.bindingIndex.loseBindingRow(s.b2.artifact_id);
    s.bindingIndex.loseSupersessionRows();
    s.index.loseRow(y.artifact_id);
    // Not a requirement: when a CAS-anchored current relation exists, invert this to fail closed.
    expect(await outcomeOf(s.resolve())).toEqual({ resolved: x.artifact_id });
  });
});

describe('W-CATCH2 / BOOT verifier finding 2: a projection row with an unknown TYPE value is detectable corruption -- fail closed, never 404, never another assessment', () => {
  // Every write path writes exactly LOCALIZATION_ASSESSMENT (registerAssessmentProjection takes a
  // LocalizationAssessmentArtifact; reconcileAssessmentProjection refuses WRONG_TYPE): the column has a
  // closed domain, so any other value is DETECTABLE damage of the row. Owner rule (4) p.6: detectable
  // loss fails closed -- a typed integrity fault (503, not retryable), never "no assessment" (404) and
  // never a silent switch to another candidate. The BOOT verifier's probes S10 and S11, same construction.
  function corruptType(s: Awaited<ReturnType<typeof setup>>, id: string, value: string): void {
    (s.index.rows.find((r) => r.assessmentArtifactId === id) as { assessmentArtifactType: string }).assessmentArtifactType = value;
  }
  function expectRowInconsistent(outcome: Outcome, ids: readonly string[]): void {
    const error = errorOf(outcome);
    expect(error.message, 'a damaged row is never "no assessment" (404)').not.toMatch(/^REJECT_/);
    expect({ code: error.code, retryable: error.retryable, faults: error.faults }).toEqual({
      code: 'ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE',
      retryable: false,
      faults: [...ids].sort().map((assessmentArtifactId) => ({ assessmentArtifactId, reason: 'PROJECTION_ROW_INCONSISTENT', retryable: false })),
    });
  }

  it('control: intact X under B1 and Y under B2 -> Y', async () => {
    const s = await setup();
    const x = await s.assessment('x-type', contextOld);
    const y = await s.assessment('y-type', contextNew);
    await s.register(x, s.b1);
    await s.register(y, s.b2);
    expect(await outcomeOf(s.resolve())).toEqual({ resolved: y.artifact_id });
  });

  it('S10: the type value of the current Y row corrupted -> PROJECTION_ROW_INCONSISTENT (503, not retryable), never 404 "missing"', async () => {
    const s = await setup();
    const x = await s.assessment('x-s10', contextOld);
    const y = await s.assessment('y-s10', contextNew);
    await s.register(x, s.b1);
    await s.register(y, s.b2);
    corruptType(s, y.artifact_id, 'LOCALIZATION_ASSESSMENT_CORRUPT');
    s.repository.reads.length = 0;
    expectRowInconsistent(await outcomeOf(s.resolve()), [y.artifact_id]);
    expect(s.repository.reads.filter((id) => id.startsWith('assessment-')), 'nothing is presented from a damaged index').toEqual([]);
  });

  it('S11: X2 and Y2 on the same binding and point (normally AMBIGUOUS); the type value of Y2 corrupted -> fail closed, X2 never served with 200', async () => {
    const s = await setup();
    const x2 = await s.assessment('x2-s11', contextNew, POINT_A);
    const y2 = await s.assessment('y2-s11', contextNew, POINT_A);
    await s.register(x2, s.b2, POINT_A);
    await s.register(y2, s.b2, POINT_A);
    const control = errorOf(await outcomeOf(s.resolve(POINT_A)));
    expect(control.message).toMatch(/^REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT/);
    corruptType(s, y2.artifact_id, 'X');
    const outcome = await outcomeOf(s.resolve(POINT_A));
    expect(outcome, 'another assessment was presented because the type column of one row was damaged').not.toEqual({ resolved: x2.artifact_id });
    expectRowInconsistent(outcome, [y2.artifact_id]);
  });

  it('a damaged type on a HISTORICAL row (another binding) also fails closed: the row is damaged, so its other columns are not evidence either', async () => {
    const s = await setup();
    const x = await s.assessment('x-hist', contextOld);
    const y = await s.assessment('y-hist', contextNew);
    await s.register(x, s.b1);
    await s.register(y, s.b2);
    corruptType(s, x.artifact_id, '');
    expectRowInconsistent(await outcomeOf(s.resolve()), [x.artifact_id]);
  });

  it('several damaged rows are all named, sorted by id (independent of row order)', async () => {
    const s = await setup();
    const a = await s.assessment('a-many', contextNew);
    const b = await s.assessment('b-many', contextNew);
    await s.register(a, s.b2);
    await s.register(b, s.b2);
    corruptType(s, a.artifact_id, 'localization_assessment');
    corruptType(s, b.artifact_id, 'SPATIAL_EVIDENCE');
    expectRowInconsistent(await outcomeOf(s.resolve()), [a.artifact_id, b.artifact_id]);
  });
});

describe('W-BOOT / APR F4: the identity clause -- a candidate re-hashed under its old id is TAMPERED, never verified or skipped', () => {
  /** Edit the stored payload, recompute content_hash (self-consistent), keep the old artifact_id. */
  function rehashUnderOldId(s: Awaited<ReturnType<typeof setup>>, id: string, edit: (payload: Record<string, unknown>) => Record<string, unknown>): void {
    const stored = s.repository.values.get(id) as LocalizationAssessmentArtifact;
    const edited = { ...stored, payload: edit({ ...(stored.payload as unknown as Record<string, unknown>) }) } as unknown as LocalizationAssessmentArtifact;
    const contentHash = sha256ContentHash(localizationAssessmentCanonicalBody(edited));
    s.repository.values.set(id, { ...edited, content_hash: contentHash });
  }

  it.each([
    ['moved to another point (criterion 2 would skip it as "proven not current")', (p: Record<string, unknown>) => ({ ...p, localization_geometry_ref: POINT_A })],
    ['moved to another project context', (p: Record<string, unknown>) => ({ ...p, project_context_ref: contextOld })],
    ['summary edited', (p: Record<string, unknown>) => ({ ...p, system_summary: 'edited and re-hashed' })],
  ] as const)('the newer candidate %s -> TAMPERED, the older one never selected', async (_label, edit) => {
    const s = await setup();
    const older = await s.assessment('older-f4', contextNew, POINT_B);
    const newer = await s.assessment('newer-f4', contextNew, POINT_B);
    await s.register(older, s.b2, POINT_B);
    await s.register(newer, s.b2, POINT_B);
    rehashUnderOldId(s, newer.artifact_id, edit);
    const stored = s.repository.values.get(newer.artifact_id) as LocalizationAssessmentArtifact;
    expect(stored.content_hash.value, 'the edited copy is self-consistent: its content_hash matches its content').toBe(sha256ContentHash(localizationAssessmentCanonicalBody(stored)).value);
    const outcome = await outcomeOf(s.resolve(POINT_B));
    expect(outcome).not.toEqual({ resolved: older.artifact_id });
    const error = errorOf(outcome);
    expect({ code: error.code, faults: error.faults }).toEqual({
      code: 'ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE',
      faults: [{ assessmentArtifactId: newer.artifact_id, reason: 'TAMPERED', retryable: false }],
    });
  });
});
