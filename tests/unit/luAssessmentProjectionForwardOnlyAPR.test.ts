/**
 * W-APR (owner decisions OD-R1 / OD-R2, 2026-10-02: forward-only; a CAS/read error is a technical
 * error, never "missing"; an older record never becomes current just because the newer one cannot
 * be read or verified) -- resolveCurrentAssessmentProjection.
 *
 * There is no ordering between assessment candidates: registration order, row order and createdAt
 * are never a tiebreaker (LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1). So EVERY candidate whose
 * projection row is bound to the current ProjectContextBinding (and, when the project has one, the
 * current localization point) may be the current assessment. Before this unit a candidate whose CAS
 * read failed, or whose content failed verification, was silently dropped (`catch -> continue`): with
 * an older verified candidate beside it, the OLDER one was then presented as current; alone, the read
 * error became "no current assessment" (404).
 *
 * The rule pinned here:
 *  - a candidate that may be current and cannot be read or verified closes the WHOLE resolution with
 *    a typed fault (code ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE): a read error of unknown
 *    persistence is retryable; a lasting fault (object gone behind its index entry, torn index entry,
 *    corrupt bytes, no index entry for a registered assessment, tampered content, another artifact
 *    under the requested id, a row that contradicts a verified current-context artifact) is not;
 *  - a candidate is skipped only when it provably cannot be current: its row is bound to another
 *    binding or point (it is then never read), or its OWN verified content is bound to another
 *    context or point.
 * Every assertion below is on values; nothing depends on registration order (each case runs in both
 * orders).
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
import {
  registerAssessmentProjection,
  resolveCurrentAssessmentProjection,
} from '../../server/modules/localization/assessmentProjection';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

const CODE = 'ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE';
const PROJECT_ID = 'project-assessment-projection-apr';
const contextOld = { artifact_id: 'lu-context-apr-old', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const contextNew = { artifact_id: 'lu-context-apr-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-apr', artifact_type: 'project_property_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-apr', artifact_type: 'product_release' } as const;
const POINT_A = { artifact_id: 'localization-geometry-apr-a', artifact_type: 'localization_geometry' } as const;
const POINT_B = { artifact_id: 'localization-geometry-apr-b', artifact_type: 'localization_geometry' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-apr');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({
  issuer_key_id: pcbIssuerKey.provider.keyId,
  issuer_version: 'project-context-binding-issuer-v2',
});
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-apr');

/**
 * An artifact repository with the production read contract: a never-stored id is
 * "Artifact not found: <id>" (ArtifactResolver), every other failure is whatever the storage threw.
 * `faults` replaces the read of one id (throw, or return other content); `reads` records every read.
 */
class FaultableRepository {
  readonly values = new Map<string, unknown>();
  readonly faults = new Map<string, () => unknown>();
  readonly reads: string[] = [];
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    this.reads.push(reference.artifact_id);
    const fault = this.faults.get(reference.artifact_id);
    if (fault) return fault() as T;
    const value = this.values.get(reference.artifact_id);
    if (value === undefined) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return value as T;
  }
}

class MemoryBindingIndex implements ProjectContextBindingIndex {
  /** W-APR add-on 2: when set, listing the project's bindings fails (e.g. the index database is down). */
  failList: Error | null = null;
  private readonly byProjectAndContext = new Map<string, string>();
  private readonly bindingsByProject = new Map<string, ArtifactReference[]>();
  private readonly supersessionsByProject = new Map<string, ArtifactReference[]>();
  private key(projectId: string, context: ArtifactReference): string {
    return `${projectId}:${context.artifact_type}:${context.artifact_id}`;
  }
  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    this.byProjectAndContext.set(this.key(binding.payload.project_id, binding.payload.project_context_ref), binding.artifact_id);
    const list = this.bindingsByProject.get(binding.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === binding.artifact_id)) list.push({ artifact_id: binding.artifact_id, artifact_type: binding.artifact_type });
    this.bindingsByProject.set(binding.payload.project_id, list);
  }
  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const bindingId = this.byProjectAndContext.get(this.key(projectId, context));
    if (!bindingId) throw new Error('no binding');
    return bindingId;
  }
  async registerSupersession(supersession: ReturnType<typeof createProjectContextBindingSupersessionArtifact>): Promise<void> {
    const list = this.supersessionsByProject.get(supersession.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === supersession.artifact_id)) list.push({ artifact_id: supersession.artifact_id, artifact_type: supersession.artifact_type });
    this.supersessionsByProject.set(supersession.payload.project_id, list);
  }
  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    if (this.failList) throw this.failList;
    return this.bindingsByProject.get(projectId) ?? [];
  }
  async listSupersessionRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.supersessionsByProject.get(projectId) ?? [];
  }
  async findProjectContextRef(): Promise<ArtifactReference> {
    throw new Error('not used by the projection');
  }
}

/** Same contract as the Prisma index; rows are returned newest-registered first, like ORDER BY created_at DESC. */
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
}

async function setup() {
  const repository = new FaultableRepository();
  const bindingIndex = new MemoryBindingIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = pcbSupersessionIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = pcbSupersessionIssuerKey.publicKey;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const bareSupersessionIssuer = createProjectContextBindingSupersessionIssuerArtifact({
    issuer_key_id: pcbSupersessionIssuerKey.provider.keyId,
    owner_authority_ref: pcbAuthority,
  });
  const supersessionIssuer = {
    ...bareSupersessionIssuer,
    attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: bareSupersessionIssuer, signing: pcbSupersessionIssuerKey.provider }),
  };
  await repository.put({ artifact_id: supersessionIssuer.artifact_id, body: supersessionIssuer });

  async function provisionBinding(contextRef: ArtifactReference, createdAt: string) {
    const unsigned = createProjectContextBindingArtifact({
      project_id: PROJECT_ID, project_context_ref: contextRef, project_property_binding_ref: propertyBinding,
      binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: createdAt,
    });
    const signed = { ...unsigned, attestation: await attestProjectContextBindingArtifact({ artifact: unsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
    await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index: bindingIndex, binding: signed, verification: pcbVerification });
    return { artifact_id: signed.artifact_id, artifact_type: signed.artifact_type } as const;
  }
  const newBindingRef = await provisionBinding(contextNew, '2026-10-02T00:00:00.000Z');

  async function supersedeOldBinding(): Promise<ArtifactReference> {
    const oldBindingRef = await provisionBinding(contextOld, '2026-10-01T00:00:00.000Z');
    const unsigned = createProjectContextBindingSupersessionArtifact({
      contract_version: 'PROJECT_CONTEXT_BINDING_SUPERSESSION_V1', project_id: PROJECT_ID,
      superseded_binding_ref: oldBindingRef, successor_binding_ref: newBindingRef, reason_code: 'TEST_SUPERSESSION',
      issuer_ref: { artifact_id: supersessionIssuer.artifact_id, artifact_type: supersessionIssuer.artifact_type },
      issuer_key_id: pcbSupersessionIssuerKey.provider.keyId, issued_at: '2026-10-02T00:01:00.000Z',
    });
    const signed = { ...unsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: unsigned, issuer: supersessionIssuer, signing: pcbSupersessionIssuerKey.provider }) };
    await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repository, index: bindingIndex, supersession: signed, verification: pcbVerification });
    return oldBindingRef;
  }

  async function assessment(label: string, contextRef: ArtifactReference = contextNew, point?: ArtifactReference): Promise<LocalizationAssessmentArtifact> {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `apr-${label}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-apr-${label}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: `attempt-apr-${label}`, artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', label }),
    };
    const created = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-apr', project_context_ref: contextRef,
        property_ref: { artifact_id: 'property-apr', artifact_type: 'PROPERTY' }, evidence_refs: [],
        system_summary: `assessment ${label}`,
        ...(point ? { localization_geometry_ref: point } : {}),
      },
      findings: [], outcome, attestation: security.attestOutcome(outcome.content_hash),
    });
    await repository.put({ artifact_id: created.artifact_id, body: created });
    return created;
  }

  const index = new MemoryProjectionIndex();
  async function register(
    a: LocalizationAssessmentArtifact,
    row: { binding?: ArtifactReference; point?: ArtifactReference | null; context?: ArtifactReference } = {},
  ): Promise<void> {
    // The real writer (row context = the artifact's own context), unless a test corrupts the row.
    if (row.context === undefined) {
      await registerAssessmentProjection({
        projectId: PROJECT_ID, assessment: a, contextBindingRef: row.binding ?? newBindingRef, releaseRef: RELEASE_REF,
        ...(row.point ? { localizationGeometryArtifactId: row.point.artifact_id } : {}), index,
      });
      return;
    }
    await index.register({
      projectId: PROJECT_ID, assessmentArtifactId: a.artifact_id, assessmentArtifactType: a.artifact_type,
      projectContextRef: row.context, bindingArtifactId: (row.binding ?? newBindingRef).artifact_id, releaseArtifactId: RELEASE_REF.artifact_id,
      localizationGeometryArtifactId: row.point?.artifact_id ?? null,
    });
  }

  function resolve(currentPoint?: ArtifactReference, projectId = PROJECT_ID) {
    return resolveCurrentAssessmentProjection({
      projectId, artifactRepository: repository as never,
      currentBindingProvider: new ProjectContextBindingProvider(repository as never, bindingIndex, pcbVerification),
      ...(currentPoint ? { currentLocalizationGeometryArtifactId: currentPoint.artifact_id } : {}), index,
    });
  }

  return { repository, index, bindingIndex, newBindingRef, supersedeOldBinding, assessment, register, resolve };
}

type Setup = Awaited<ReturnType<typeof setup>>;
type Outcome = { readonly resolved: string } | { readonly error: unknown };

async function outcomeOf(promise: Promise<{ assessmentArtifactId: string }>): Promise<Outcome> {
  return promise.then((r) => ({ resolved: r.assessmentArtifactId }), (error: unknown) => ({ error }));
}

function expectFault(
  outcome: Outcome,
  expected: { readonly faults: ReadonlyArray<{ readonly assessmentArtifactId: string; readonly reason: string; readonly retryable: boolean }>; readonly retryable: boolean },
  never: readonly string[] = [],
): void {
  for (const id of never) {
    expect(outcome, `resolution selected ${id} although a candidate that may be current could not be verified`).not.toEqual({ resolved: id });
  }
  expect('error' in outcome, `expected fail closed, got ${JSON.stringify(outcome)}`).toBe(true);
  const error = (outcome as { error: Error & Record<string, unknown> }).error;
  expect(error.message, 'a technical/integrity fault must never read as a REJECT_* absence (404)').not.toMatch(/^REJECT_/);
  expect({ code: error.code, retryable: error.retryable, faults: error.faults }).toEqual({
    code: CODE,
    retryable: expected.retryable,
    faults: [...expected.faults].sort((a, b) => (a.assessmentArtifactId < b.assessmentArtifactId ? -1 : 1)),
  });
  expect(error.message.startsWith(`${CODE}:`)).toBe(true);
}

type Fault = (s: Setup, id: string, other: string) => void;
const FAULTS: ReadonlyArray<[string, Fault, string, boolean]> = [
  ['a read error (EIO)', (s, id) => s.repository.faults.set(id, () => { throw Object.assign(new Error('EIO: i/o error, read C:/cas/x'), { code: 'EIO' }); }), 'READ_ERROR', true],
  ['an index entry that cannot be read (MIMERS_ARTIFACT_INDEX_READ_FAILED, IO)', (s, id) => s.repository.faults.set(id, () => { throw Object.assign(new Error('MIMERS_ARTIFACT_INDEX_READ_FAILED: EBUSY'), { code: 'MIMERS_ARTIFACT_INDEX_READ_FAILED', reason: 'IO' }); }), 'READ_ERROR', true],
  ['a torn index entry (MIMERS_ARTIFACT_INDEX_READ_FAILED, MALFORMED)', (s, id) => s.repository.faults.set(id, () => { throw Object.assign(new Error('MIMERS_ARTIFACT_INDEX_READ_FAILED: torn'), { code: 'MIMERS_ARTIFACT_INDEX_READ_FAILED', reason: 'MALFORMED' }); }), 'STORAGE_INTEGRITY_FAULT', false],
  ['the stored object gone behind its index entry (MIMERS_ARTIFACT_OBJECT_MISSING)', (s, id) => s.repository.faults.set(id, () => { throw Object.assign(new Error('MIMERS_ARTIFACT_OBJECT_MISSING: gone'), { code: 'MIMERS_ARTIFACT_OBJECT_MISSING' }); }), 'STORAGE_INTEGRITY_FAULT', false],
  ['corrupt bytes (CASIntegrityError)', (s, id) => s.repository.faults.set(id, () => { throw Object.assign(new Error('hash mismatch'), { name: 'CASIntegrityError' }); }), 'STORAGE_INTEGRITY_FAULT', false],
  ['no index entry for a registered assessment ("Artifact not found")', (s, id) => { s.repository.values.delete(id); }, 'MISSING_FROM_CAS', false],
  ['tampered content (its content_hash no longer matches)', (s, id) => {
    const stored = s.repository.values.get(id) as LocalizationAssessmentArtifact;
    s.repository.values.set(id, { ...stored, payload: { ...stored.payload, system_summary: 'edited after persistence' } });
  }, 'TAMPERED', false],
  ['another assessment stored under the requested id (index mix-up)', (s, id, other) => s.repository.faults.set(id, () => s.repository.values.get(other)), 'ARTIFACT_ID_MISMATCH', false],
];

const VARIANTS: ReadonlyArray<[string, ArtifactReference | undefined]> = [
  ['binding-only eligibility (project without a localization point)', undefined],
  ['current binding AND current point', POINT_B],
];

describe('W-APR: a candidate that may be current cannot be read or verified -> the whole resolution fails closed; the older candidate is never selected', () => {
  describe.each(VARIANTS)('%s', (_variant, point) => {
    it.each(FAULTS.flatMap(([label, fault, reason, retryable]) => [
      [label, 'older registered first', fault, reason, retryable, false] as const,
      [label, 'newer registered first', fault, reason, retryable, true] as const,
    ]))('the newer candidate: %s (%s) -> typed fault, never the older one', async (_label, _order, fault, reason, retryable, newerFirst) => {
      const s = await setup();
      const older = await s.assessment('older', contextNew, point);
      const newer = await s.assessment('newer', contextNew, point);
      for (const a of newerFirst ? [newer, older] : [older, newer]) await s.register(a, { point: point ?? null });
      fault(s, newer.artifact_id, older.artifact_id);

      expectFault(await outcomeOf(s.resolve(point)), { retryable, faults: [{ assessmentArtifactId: newer.artifact_id, reason, retryable }] }, [older.artifact_id, newer.artifact_id]);
    });

    it.each(FAULTS.filter(([, , reason]) => reason !== 'ARTIFACT_ID_MISMATCH'))(
      'the ONLY candidate: %s -> the typed fault, never REJECT_ASSESSMENT_PROJECTION_NOT_FOUND (OD-R2: a read error is not "no assessment")',
      async (_label, fault, reason, retryable) => {
        const s = await setup();
        const only = await s.assessment('only', contextNew, point);
        await s.register(only, { point: point ?? null });
        fault(s, only.artifact_id, only.artifact_id);

        expectFault(await outcomeOf(s.resolve(point)), { retryable, faults: [{ assessmentArtifactId: only.artifact_id, reason, retryable }] });
      },
    );
  });

  it('several unverifiable candidates: every one is reported; retryable only when every fault is; the same answer in both registration orders', async () => {
    for (const newerFirst of [false, true]) {
      const s = await setup();
      const a = await s.assessment('mixed-a');
      const b = await s.assessment('mixed-b');
      for (const x of newerFirst ? [b, a] : [a, b]) await s.register(x);
      FAULTS[0]![1](s, a.artifact_id, b.artifact_id); // EIO: retryable
      FAULTS[3]![1](s, b.artifact_id, a.artifact_id); // object gone: lasting
      expectFault(await outcomeOf(s.resolve()), {
        retryable: false,
        faults: [
          { assessmentArtifactId: a.artifact_id, reason: 'READ_ERROR', retryable: true },
          { assessmentArtifactId: b.artifact_id, reason: 'STORAGE_INTEGRITY_FAULT', retryable: false },
        ],
      });
    }
    const s = await setup();
    const a = await s.assessment('transient-a');
    const b = await s.assessment('transient-b');
    await s.register(a);
    await s.register(b);
    FAULTS[0]![1](s, a.artifact_id, b.artifact_id);
    FAULTS[1]![1](s, b.artifact_id, a.artifact_id);
    expectFault(await outcomeOf(s.resolve()), {
      retryable: true,
      faults: [
        { assessmentArtifactId: a.artifact_id, reason: 'READ_ERROR', retryable: true },
        { assessmentArtifactId: b.artifact_id, reason: 'READ_ERROR', retryable: true },
      ],
    });
  });

  it('every eligible candidate is examined and a fault is reported before any ambiguity refusal: two verified + one unreadable -> the fault, not AMBIGUOUS', async () => {
    for (const unreadableFirst of [false, true]) {
      const s = await setup();
      const one = await s.assessment('verified-1');
      const two = await s.assessment('verified-2');
      const broken = await s.assessment('unreadable');
      for (const x of unreadableFirst ? [broken, one, two] : [one, two, broken]) await s.register(x);
      FAULTS[3]![1](s, broken.artifact_id, one.artifact_id);
      expectFault(await outcomeOf(s.resolve()), {
        retryable: false,
        faults: [{ assessmentArtifactId: broken.artifact_id, reason: 'STORAGE_INTEGRITY_FAULT', retryable: false }],
      }, [one.artifact_id, two.artifact_id]);
      for (const id of [one.artifact_id, two.artifact_id, broken.artifact_id]) expect(s.repository.reads).toContain(id);
    }
  });

  it('a row whose context column contradicts a verified artifact that IS bound to the current context -> PROJECTION_ROW_INCONSISTENT (lasting), never the other candidate', async () => {
    for (const corruptedFirst of [false, true]) {
      const s = await setup();
      const sound = await s.assessment('row-sound');
      const misfiled = await s.assessment('row-misfiled');
      const registerMisfiled = () => s.register(misfiled, { context: contextOld }); // the row lies about the context
      if (corruptedFirst) { await registerMisfiled(); await s.register(sound); } else { await s.register(sound); await registerMisfiled(); }
      expectFault(await outcomeOf(s.resolve()), {
        retryable: false,
        faults: [{ assessmentArtifactId: misfiled.artifact_id, reason: 'PROJECTION_ROW_INCONSISTENT', retryable: false }],
      }, [sound.artifact_id, misfiled.artifact_id]);
    }
  });

  it('an unknown contract version on one candidate and a read fault on another -> the read fault, in both orders (never order-dependent)', async () => {
    for (const versionFirst of [false, true]) {
      const s = await setup();
      const base = await s.assessment('unknown-version');
      const payload = { ...base.payload, assessment_contract_version: 'LU_ASSESSMENT_CONTRACT_V999' } as unknown as LocalizationAssessmentArtifact['payload'];
      const hash = sha256ContentHash({ artifact_type: base.artifact_type, references: base.references, payload });
      const unknownVersion = { ...base, payload, content_hash: hash, artifact_id: `assessment-${hash.value}` } as LocalizationAssessmentArtifact;
      await s.repository.put({ artifact_id: unknownVersion.artifact_id, body: unknownVersion });
      const unreadable = await s.assessment('unreadable-beside-version');
      for (const x of versionFirst ? [unknownVersion, unreadable] : [unreadable, unknownVersion]) await s.register(x);
      FAULTS[0]![1](s, unreadable.artifact_id, unknownVersion.artifact_id);
      expectFault(await outcomeOf(s.resolve()), {
        retryable: true,
        faults: [{ assessmentArtifactId: unreadable.artifact_id, reason: 'READ_ERROR', retryable: true }],
      }, [unknownVersion.artifact_id]);
    }
  });
});

describe('W-APR: a candidate is skipped only when it provably cannot be current -- also when it cannot be read', () => {
  it('superseded point: the point-A assessment is never read, so its unreadable object cannot block point B', async () => {
    for (const [label, fault] of FAULTS.map(([l, f]) => [l, f] as const)) {
      const s = await setup();
      const atA = await s.assessment('at-a', contextNew, POINT_A);
      const atB = await s.assessment('at-b', contextNew, POINT_B);
      await s.register(atA, { point: POINT_A });
      await s.register(atB, { point: POINT_B });
      fault(s, atA.artifact_id, atB.artifact_id);
      expect(await outcomeOf(s.resolve(POINT_B)), label).toEqual({ resolved: atB.artifact_id });
      expect(s.repository.reads, label).not.toContain(atA.artifact_id);
    }
  });

  it('superseded binding: an assessment row bound to the superseded binding is never read, so its unreadable object cannot block the current one', async () => {
    const s = await setup();
    const oldBindingRef = await s.supersedeOldBinding();
    const historical = await s.assessment('historical', contextOld);
    const current = await s.assessment('current', contextNew);
    await s.register(historical, { binding: oldBindingRef });
    await s.register(current);
    FAULTS[3]![1](s, historical.artifact_id, current.artifact_id);
    expect(await outcomeOf(s.resolve())).toEqual({ resolved: current.artifact_id });
    expect(s.repository.reads).not.toContain(historical.artifact_id);
  });

  it('the row names the current point but the verified artifact is bound to point A -> skipped (its own content proves it is not current)', async () => {
    const s = await setup();
    const atA = await s.assessment('misrowed-at-a', contextNew, POINT_A);
    const atB = await s.assessment('row-at-b', contextNew, POINT_B);
    await s.register(atA, { point: POINT_B });
    await s.register(atB, { point: POINT_B });
    expect(await outcomeOf(s.resolve(POINT_B))).toEqual({ resolved: atB.artifact_id });
  });

  it('the row names the current binding and context but the verified artifact carries the superseded context -> skipped', async () => {
    const s = await setup();
    await s.supersedeOldBinding();
    const stale = await s.assessment('stale-context', contextOld);
    const current = await s.assessment('current-context', contextNew);
    await s.register(stale, { context: contextNew }); // row: current binding + current context; artifact: old context
    await s.register(current);
    expect(await outcomeOf(s.resolve())).toEqual({ resolved: current.artifact_id });
  });

  it('an assessment whose own verified context is not the current binding\'s is never presented as current, even when its row names the current binding', async () => {
    const s = await setup();
    await s.supersedeOldBinding();
    const stale = await s.assessment('stale-only', contextOld);
    await s.register(stale); // row context = the artifact's (old) context, row binding = the CURRENT binding
    const outcome = await outcomeOf(s.resolve());
    expect(outcome, 'an assessment computed for a superseded context was presented as current').not.toEqual({ resolved: stale.artifact_id });
    expect((outcome as { error: Error }).error.message).toMatch(/^REJECT_ASSESSMENT_PROJECTION_NOT_FOUND/);
  });
});

describe('W-APR: unchanged normal outcomes', () => {
  it('one verified candidate beside proven-historical ones -> that candidate', async () => {
    const s = await setup();
    const oldBindingRef = await s.supersedeOldBinding();
    const historical = await s.assessment('h', contextOld);
    const atA = await s.assessment('a', contextNew, POINT_A);
    const atB = await s.assessment('b', contextNew, POINT_B);
    await s.register(historical, { binding: oldBindingRef, point: POINT_B });
    await s.register(atA, { point: POINT_A });
    await s.register(atB, { point: POINT_B });
    expect(await outcomeOf(s.resolve(POINT_B))).toEqual({ resolved: atB.artifact_id });
  });

  it('two verified candidates for the current binding/point -> REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT, unchanged', async () => {
    const s = await setup();
    const one = await s.assessment('ambiguous-1', contextNew, POINT_B);
    const two = await s.assessment('ambiguous-2', contextNew, POINT_B);
    await s.register(one, { point: POINT_B });
    await s.register(two, { point: POINT_B });
    const outcome = await outcomeOf(s.resolve(POINT_B));
    expect((outcome as { error: Error }).error.message).toMatch(/^REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT/);
  });

  it('no row for the current binding/point -> REJECT_ASSESSMENT_PROJECTION_NOT_CURRENT, unchanged', async () => {
    const s = await setup();
    const atA = await s.assessment('only-a', contextNew, POINT_A);
    await s.register(atA, { point: POINT_A });
    const outcome = await outcomeOf(s.resolve(POINT_B));
    expect((outcome as { error: Error }).error.message).toMatch(/^REJECT_ASSESSMENT_PROJECTION_NOT_CURRENT/);
    expect(s.repository.reads).not.toContain(atA.artifact_id);
  });
});

/**
 * W-APR add-on 2 (U20CDF2 verifier, H1): the current ProjectContextBinding could not be resolved. That
 * used to be REJECT_ASSESSMENT_PROJECTION_NOT_FOUND ("current binding unavailable") whatever the
 * cause, i.e. 404 "no current assessment". Only a project with NO binding registered is absent; a
 * failure to read the binding (or its issuer, or the binding index) is a technical fault by its
 * nature, and a binding that fails verification is a refusal -- both typed, never REJECT_* absence.
 */
describe('W-APR add-on 2: the current binding cannot be resolved -> a typed fault by its nature, never "no assessment"', () => {
  const BINDING_CODE = 'ASSESSMENT_PROJECTION_BINDING_UNRESOLVABLE';
  type BindingFault = (s: Setup) => void;
  const BINDING_FAULTS: ReadonlyArray<[string, string, boolean, string | null, BindingFault]> = [
    ['the binding index cannot be listed (database unavailable)', 'READ_ERROR', true, null, (s) => { s.bindingIndex.failList = new Error('connect ECONNREFUSED 10.0.0.5:5432'); }],
    ['the current binding\'s CAS read fails (EIO)', 'READ_ERROR', true, null, (s) => s.repository.faults.set(s.newBindingRef.artifact_id, () => { throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' }); })],
    ['the current binding\'s object is gone behind its index entry', 'STORAGE_INTEGRITY_FAULT', false, null, (s) => s.repository.faults.set(s.newBindingRef.artifact_id, () => { throw Object.assign(new Error('MIMERS_ARTIFACT_OBJECT_MISSING: gone'), { code: 'MIMERS_ARTIFACT_OBJECT_MISSING' }); })],
    ['the current binding is listed but not in the CAS ("Artifact not found")', 'MISSING_FROM_CAS', false, null, (s) => { s.repository.values.delete(s.newBindingRef.artifact_id); }],
    ['the binding issuer cannot be read (torn index entry)', 'STORAGE_INTEGRITY_FAULT', false, null, (s) => s.repository.faults.set(pcbIssuer.artifact_id, () => { throw Object.assign(new Error('MIMERS_ARTIFACT_INDEX_READ_FAILED: torn'), { code: 'MIMERS_ARTIFACT_INDEX_READ_FAILED', reason: 'MALFORMED' }); })],
    ['the current binding\'s signature does not verify', 'REFUSED', false, 'REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_SIGNATURE', (s) => {
      const stored = s.repository.values.get(s.newBindingRef.artifact_id) as { attestation: { signature: string } };
      s.repository.values.set(s.newBindingRef.artifact_id, { ...stored, attestation: { ...stored.attestation, signature: `ed25519:${Buffer.alloc(64).toString('base64')}` } });
    }],
  ];

  it.each(BINDING_FAULTS)('%s -> %s (retryable %s, refusal %s), never REJECT_ASSESSMENT_PROJECTION_NOT_FOUND', async (_label, reason, retryable, refusalCode, fault) => {
    const s = await setup();
    const current = await s.assessment('binding-fault');
    await s.register(current);
    fault(s);

    const outcome = await outcomeOf(s.resolve());
    expect(outcome, 'an assessment was selected although the current binding could not be resolved').not.toEqual({ resolved: current.artifact_id });
    expect('error' in outcome).toBe(true);
    const error = (outcome as { error: Error & Record<string, unknown> }).error;
    expect(error.message, 'a binding that cannot be resolved for a technical reason or is refused is never "no assessment" (404)').not.toMatch(/^REJECT_/);
    expect({ code: error.code, reason: error.reason, retryable: error.retryable, refusalCode: error.refusalCode }).toEqual({ code: BINDING_CODE, reason, retryable, refusalCode });
    expect(error.message.startsWith(`${BINDING_CODE}:`)).toBe(true);
  });

  // W-BOOT (APR verifier F2): this case used to be pinned as "genuine absence" (404). It is not: the
  // project HAS a projection row, and a projection row is only ever written under a registered
  // binding (binding_artifact_id is NOT NULL and the index is append-only). A row with no binding
  // registered for its project therefore proves lost binding-index rows -- a lasting integrity fault
  // (503, not retryable), never "no assessment", and never a reason for the bootstrap to mint.
  // Genuine absence (no row at all) is still 404: see luAssessmentProjectionBindingIndexLossBOOT.
  it('projection rows but NO binding registered for the project -> BINDING_INDEX_INCONSISTENT (lost binding rows), never 404 absence', async () => {
    const s = await setup();
    const orphan = await s.assessment('no-binding-project');
    await s.index.register({
      projectId: 'project-without-binding-apr', assessmentArtifactId: orphan.artifact_id, assessmentArtifactType: orphan.artifact_type,
      projectContextRef: contextNew, bindingArtifactId: s.newBindingRef.artifact_id, releaseArtifactId: RELEASE_REF.artifact_id,
    });
    const outcome = await outcomeOf(s.resolve(undefined, 'project-without-binding-apr'));
    const error = (outcome as { error: Error & Record<string, unknown> }).error;
    expect(error.message).not.toMatch(/^REJECT_/);
    expect({ code: error.code, reason: error.reason, retryable: error.retryable, refusalCode: error.refusalCode }).toEqual({
      code: BINDING_CODE, reason: 'BINDING_INDEX_INCONSISTENT', retryable: false, refusalCode: null,
    });
    expect(s.repository.reads).not.toContain(orphan.artifact_id);
  });
});
