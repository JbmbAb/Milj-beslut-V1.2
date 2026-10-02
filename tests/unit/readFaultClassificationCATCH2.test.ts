// @vitest-environment node
/**
 * W-CATCH2 (A): the ONE classification of "read error vs genuine absence vs integrity fault vs failed
 * verification" (server/modules/localization/readFaultClassification.ts), on the real error shapes the
 * production storage stack throws (FileCASRepository -> MimersByteStorageBackend ->
 * CasBackedArtifactRepository in a mkdtemp directory, never a real CAS root) and on the real refusals of
 * ProjectContextBindingProvider.resolveCurrent.
 *
 * Owner decisions 2026-10-02/03 (OD-R1/OD-R2): a read error is technical, never "missing"; a corrupt or
 * unverifiable existing object is never minted over; absence only when proven.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The selection module imports the Prisma projection index at runtime: never a real database client.
vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
import { FileCASRepository } from '@miljobeslut/mimers-brunn-core';
import { MimersArtifactIndexReadError, MimersArtifactObjectMissingError, MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import {
  LU_READ_FAULT,
  LuReadFaultError,
  PROJECT_ACCESS_DENIED,
  causeChain,
  classifyReadFault,
  isExactlyTheDeterministicArtifact,
  isProjectAccessDenied,
  isProvenArtifactAbsence,
  isProvenBindingAbsence,
  readExistingOrProvenAbsent,
  readFaultHttpStatus,
  readFaultSentenceSv,
  toReadFaultError,
} from '../../server/modules/localization/readFaultClassification';
import {
  ProjectContextBindingCurrentUnavailableError,
  ProjectContextBindingIndexInconsistentError,
  ProjectContextBindingProvider,
} from '../../server/modules/localization/projectContextBindingRuntime';
import { classifyBindingResolutionFailure } from '../../server/modules/localization/projectContextBootstrapBindingGate';
import { resolveCurrentAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const errno = (code: string, message = `${code}: simulated`) => Object.assign(new Error(message), { code });
const casIntegrity = () => Object.assign(new Error('CAS Integrity Violation: hash mismatch'), { name: 'CASIntegrityError' });
const wrapped = (cause: unknown) => new ProjectContextBindingCurrentUnavailableError(false, cause);

describe('W-CATCH2 (A): classifyReadFault -- by stable code / class / REJECT_* token, never by free text', () => {
  const cases: Array<[string, unknown, string, boolean, string | null]> = [
    ['EIO (Node system error)', errno('EIO'), 'READ_ERROR', true, null],
    ['ECONNREFUSED (database down)', errno('ECONNREFUSED'), 'READ_ERROR', true, null],
    ['EBUSY (lock)', errno('EBUSY'), 'READ_ERROR', true, null],
    ['index entry that could not be READ (IO)', new MimersArtifactIndexReadError('a', 'p', 'IO', 'EISDIR', { cause: errno('EISDIR') }), 'READ_ERROR', true, null],
    ['torn index entry (MALFORMED)', new MimersArtifactIndexReadError('a', 'p', 'MALFORMED', 'json'), 'STORAGE_INTEGRITY_FAULT', false, null],
    ['object gone behind its index entry', new MimersArtifactObjectMissingError('a', 'h', 'get'), 'STORAGE_INTEGRITY_FAULT', false, null],
    ['corrupt bytes (CASIntegrityError)', casIntegrity(), 'STORAGE_INTEGRITY_FAULT', false, null],
    ['another object under a write-once id', new Error('WORM violation: a'), 'STORAGE_INTEGRITY_FAULT', false, null],
    ['"never stored" for something that must exist', new Error('Artifact not found: a'), 'MISSING_FROM_CAS', false, null],
    ['Prisma connection error (P1001)', Object.assign(new Error("Can't reach database server"), { code: 'P1001' }), 'READ_ERROR', true, null],
    ['Prisma client error (by class name)', Object.assign(new Error('x'), { name: 'PrismaClientUnknownRequestError' }), 'READ_ERROR', true, null],
    ['U30-R3 re-execution storage fault', Object.assign(new Error('LU_REEXECUTION_STORAGE_FAULT: x'), { code: 'LU_REEXECUTION_STORAGE_FAULT' }), 'READ_ERROR', true, null],
    ['U30-R3 re-execution storage fault over a lasting cause', Object.assign(new Error('x', { cause: new MimersArtifactObjectMissingError('a', 'h', 'get') }), { code: 'LU_REEXECUTION_STORAGE_FAULT' }), 'STORAGE_INTEGRITY_FAULT', false, null],
    ['a plain refusal', new Error('REJECT_PROJECT_CONTEXT_BINDING_V2_SIGNATURE'), 'REFUSED', false, 'REJECT_PROJECT_CONTEXT_BINDING_V2_SIGNATURE'],
    ['resolveCurrent wrapper over EIO', wrapped(errno('EIO')), 'READ_ERROR', true, null],
    ['resolveCurrent wrapper over a refusal', wrapped(new Error('REJECT_PROJECT_CONTEXT_BINDING_ISSUER_TRUST')), 'REFUSED', false, 'REJECT_PROJECT_CONTEXT_BINDING_ISSUER_TRUST'],
    ['resolveCurrent wrapper over "Artifact not found"', wrapped(new Error('Artifact not found: b')), 'MISSING_FROM_CAS', false, null],
    ['resolveCurrent wrapper over corrupt bytes', wrapped(casIntegrity()), 'STORAGE_INTEGRITY_FAULT', false, null],
    ['resolveCurrent wrapper over the typed index inconsistency', wrapped(new ProjectContextBindingIndexInconsistentError('1 supersession relation(s) registered for the project but no binding')), 'BINDING_INDEX_INCONSISTENT', false, null],
    ['an unknown error while READING', wrapped(new TypeError('x is undefined')), 'READ_ERROR', true, null],
    // A refusal wrapper that keeps its cause (W-CATCH2 #9/#7): the ROOT decides.
    ['a refusal wrapper over a wrapper over EIO', new Error('REJECT_VIEWER_CAPABILITY_CURRENT_BINDING_UNAVAILABLE', { cause: wrapped(errno('EIO')) }), 'READ_ERROR', true, null],
    ['a refusal wrapper over a wrapper over a refusal', new Error('REJECT_VIEWER_CAPABILITY_CURRENT_BINDING_UNAVAILABLE', { cause: wrapped(new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: fork')) }), 'REFUSED', false, 'REJECT_PROJECT_CONTEXT_BINDING_HEAD'],
  ];
  for (const [name, error, faultClass, retryable, refusalCode] of cases) {
    it(`${name} -> ${faultClass}`, () => {
      expect(classifyReadFault(error)).toEqual({ faultClass, retryable, refusalCode });
    });
  }

  it('W-BOOT verifier finding 3: structural binding-INDEX damage behind a head refusal is BINDING_INDEX_INCONSISTENT, not a verification refusal', () => {
    for (const reason of ['bindings', 'binding project', 'supersession project', 'missing relation binding']) {
      expect(classifyReadFault(wrapped(new Error(`REJECT_PROJECT_CONTEXT_BINDING_HEAD: ${reason}`))), reason).toEqual({
        faultClass: 'BINDING_INDEX_INCONSISTENT',
        retryable: false,
        refusalCode: null,
      });
    }
    // A graph-level contradiction of SIGNED relations stays a refusal.
    for (const reason of ['fork', 'cycle', 'ambiguous head']) {
      expect(classifyReadFault(wrapped(new Error(`REJECT_PROJECT_CONTEXT_BINDING_HEAD: ${reason}`))), reason).toEqual({
        faultClass: 'REFUSED',
        retryable: false,
        refusalCode: 'REJECT_PROJECT_CONTEXT_BINDING_HEAD',
      });
    }
  });

  it("phase 'verify': an unrecognised failure of an object that WAS read is a failed verification (REFUSED), a read inside it stays READ_ERROR", () => {
    expect(classifyReadFault(new TypeError("Cannot read properties of undefined (reading 'issuer_key_id')"), 'verify')).toEqual({
      faultClass: 'REFUSED',
      retryable: false,
      refusalCode: null,
    });
    expect(classifyReadFault(errno('EIO'), 'verify')).toEqual({ faultClass: 'READ_ERROR', retryable: true, refusalCode: null });
    expect(classifyReadFault(new Error('Artifact not found: issuer'), 'verify').faultClass).toBe('MISSING_FROM_CAS');
    expect(classifyReadFault(new Error('REJECT_VIEWER_CAPABILITY_SIGNATURE'), 'verify')).toEqual({
      faultClass: 'REFUSED',
      retryable: false,
      refusalCode: 'REJECT_VIEWER_CAPABILITY_SIGNATURE',
    });
    // A database that cannot answer DURING a verification is a read fault, recognised by its Prisma
    // class name (mutation A06), never a failed verification of the object.
    expect(classifyReadFault(Object.assign(new Error("Can't reach database server"), { name: 'PrismaClientInitializationError' }), 'verify')).toEqual({
      faultClass: 'READ_ERROR',
      retryable: true,
      refusalCode: null,
    });
    // 'read' (the default): the same unrecognised error has unknown persistence.
    expect(classifyReadFault(new TypeError('x'))).toEqual({ faultClass: 'READ_ERROR', retryable: true, refusalCode: null });
  });

  it('never by free text: a message that merely mentions a code or "not found" is not that class', () => {
    expect(classifyReadFault(new Error('the index said MIMERS_ARTIFACT_OBJECT_MISSING once')).faultClass).toBe('READ_ERROR');
    expect(classifyReadFault(new Error('not found: a')).faultClass).toBe('READ_ERROR');
    expect(classifyReadFault(new Error('some text REJECT_X')).faultClass).toBe('READ_ERROR');
  });

  it('an already typed LuReadFaultError keeps its class, wherever it is classified again', () => {
    const typed = new LuReadFaultError('viewer-capability', { faultClass: 'STORAGE_INTEGRITY_FAULT', retryable: false, refusalCode: null }, errno('EIO'));
    expect(classifyReadFault(typed)).toEqual({ faultClass: 'STORAGE_INTEGRITY_FAULT', retryable: false, refusalCode: null });
    expect(classifyReadFault(typed, 'verify')).toEqual({ faultClass: 'STORAGE_INTEGRITY_FAULT', retryable: false, refusalCode: null });
    expect(toReadFaultError('other', typed)).toBe(typed);
  });

  it('the cause chain is bounded and cycle-safe', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(causeChain(a)).toHaveLength(2);
    expect(classifyReadFault(a).faultClass).toBe('READ_ERROR');
    let deep: unknown = errno('EIO');
    for (let i = 0; i < 20; i += 1) deep = new Error(`w${i}`, { cause: deep });
    expect(causeChain(deep)).toHaveLength(8);
  });
});

describe('W-CATCH2 (A): absence only when proven', () => {
  it("isProvenArtifactAbsence: exactly the repository's `Artifact not found: <id>` for the id asked for", () => {
    expect(isProvenArtifactAbsence(new Error('Artifact not found: x'), 'x')).toBe(true);
    expect(isProvenArtifactAbsence(new Error('Artifact not found: y'), 'x')).toBe(false);
    expect(isProvenArtifactAbsence(new Error('Artifact not found: x (and more)'), 'x')).toBe(false);
    expect(isProvenArtifactAbsence(new Error('wrapped', { cause: new Error('Artifact not found: x') }), 'x')).toBe(false);
    expect(isProvenArtifactAbsence(new MimersArtifactObjectMissingError('x', 'h', 'get'), 'x')).toBe(false);
    expect(isProvenArtifactAbsence(errno('ENOENT'), 'x')).toBe(false);
    expect(isProvenArtifactAbsence('Artifact not found: x', 'x')).toBe(false);
  });

  it("isProvenBindingAbsence: resolveCurrent's own refusal with noBindingRegistered AND the empty-graph cause (real provider, empty index)", async () => {
    const emptyIndex = { listBindingRefs: async () => [], listSupersessionRefs: async () => [] };
    const provider = new ProjectContextBindingProvider({} as never, emptyIndex as never, {} as never);
    const absence = await provider.resolveCurrent('p').catch((error: unknown) => error);
    expect(isProvenBindingAbsence(absence)).toBe(true);

    // The flag alone is not enough (W-BOOT verifier finding 4: defence in depth).
    expect(isProvenBindingAbsence(new ProjectContextBindingCurrentUnavailableError(true, new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: ambiguous head')))).toBe(false);
    expect(isProvenBindingAbsence(new ProjectContextBindingCurrentUnavailableError(false, new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings')))).toBe(false);
    expect(isProvenBindingAbsence(Object.assign(new Error('REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE', { cause: new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings') }), { noBindingRegistered: 'true' }))).toBe(false);

    // A listing that FAILS is never absence.
    const downIndex = { listBindingRefs: async () => { throw errno('ECONNREFUSED'); }, listSupersessionRefs: async () => [] };
    const down = await new ProjectContextBindingProvider({} as never, downIndex as never, {} as never).resolveCurrent('p').catch((error: unknown) => error);
    expect(isProvenBindingAbsence(down)).toBe(false);
    expect(classifyReadFault(down)).toEqual({ faultClass: 'READ_ERROR', retryable: true, refusalCode: null });
  });

  it('isProjectAccessDenied: only the access check\'s own typed denial', () => {
    expect(isProjectAccessDenied(Object.assign(new Error('User is not a member of this project'), { code: PROJECT_ACCESS_DENIED }))).toBe(true);
    expect(isProjectAccessDenied(new Error('User is not a member of this project'))).toBe(false);
    expect(isProjectAccessDenied(Object.assign(new Error("Can't reach database server"), { code: 'P1001' }))).toBe(false);
    expect(isProjectAccessDenied(undefined)).toBe(false);
  });
});

describe('W-CATCH2 (A): readExistingOrProvenAbsent on a REAL FileCAS stack (mkdtemp)', () => {
  let root: string;
  let casDir: string;
  let indexDir: string;
  const repository = () =>
    new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(casDir, { durabilityMode: 'none' }), indexDir));
  const indexEntryPath = (id: string) => path.join(indexDir, `${createHash('sha256').update(id).digest('hex')}.idx`);
  const objectPath = (id: string) =>
    new FileCASRepository(casDir).getFilePath((JSON.parse(readFileSync(indexEntryPath(id), 'utf8')) as { hash: string }).hash);
  const REF = { artifact_id: 'catch2-artifact', artifact_type: 'viewer_capability' } as const;
  const BODY = { artifact_id: REF.artifact_id, artifact_type: REF.artifact_type, payload: { n: 1 } };

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'wcatch2-readfault-'));
    casDir = path.join(root, 'cas');
    indexDir = path.join(root, 'index');
    mkdirSync(casDir, { recursive: true });
    mkdirSync(indexDir, { recursive: true });
    await new FileCASRepository(casDir, { durabilityMode: 'none' }).initialize();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function store(): Promise<void> {
    await repository().put({ artifact_id: REF.artifact_id, content_hash: { algorithm: 'sha256', value: 'x' }, body: BODY } as never);
  }
  async function outcome() {
    try {
      return await readExistingOrProvenAbsent(repository(), REF, 'subject-under-test');
    } catch (error) {
      return error as LuReadFaultError;
    }
  }

  it('never stored -> { found: false } (the only absence)', async () => {
    expect(await outcome()).toEqual({ found: false });
  });
  it('stored -> { found: true, value }', async () => {
    await store();
    expect(await outcome()).toEqual({ found: true, value: BODY });
  });

  const damage: Array<[string, () => void, string, boolean]> = [
    ['object gone behind its index entry', () => unlinkSync(objectPath(REF.artifact_id)), 'STORAGE_INTEGRITY_FAULT', false],
    ['torn index entry', () => writeFileSync(indexEntryPath(REF.artifact_id), '{"artifact_id":"'), 'STORAGE_INTEGRITY_FAULT', false],
    ['index entry unreadable (EISDIR)', () => { unlinkSync(indexEntryPath(REF.artifact_id)); mkdirSync(indexEntryPath(REF.artifact_id)); }, 'READ_ERROR', true],
    ['corrupt bytes', () => writeFileSync(objectPath(REF.artifact_id), Buffer.from('{"not":"what the hash says"}')), 'STORAGE_INTEGRITY_FAULT', false],
  ];
  for (const [name, sabotage, faultClass, retryable] of damage) {
    it(`${name} -> typed LuReadFaultError ${faultClass} (never { found: false })`, async () => {
      await store();
      sabotage();
      const result = await outcome();
      expect(result).toBeInstanceOf(LuReadFaultError);
      const typed = result as LuReadFaultError;
      expect({ code: typed.code, subject: typed.subject, faultClass: typed.faultClass, retryable: typed.retryable }).toEqual({
        code: LU_READ_FAULT,
        subject: 'subject-under-test',
        faultClass,
        retryable,
      });
      // The message carries only stable codes: no id, no path, no cause text.
      expect(typed.message).toBe(`LU_READ_FAULT: subject-under-test: ${faultClass}`);
      expect(typed.cause).toBeDefined();
    });
  }
});

describe('W-CATCH2 (A): no second copy -- the bootstrap gate (W-BOOT) and the selection (W-APR) classify a binding failure exactly as the shared rule', () => {
  // Every resolveCurrent failure shape the W-APR/W-BOOT suites and the BOOT verifier's probes use.
  const corpus: Array<[string, unknown]> = [
    ['EIO', wrapped(errno('EIO'))],
    ['ECONNREFUSED', wrapped(errno('ECONNREFUSED'))],
    ['P1001', wrapped(Object.assign(new Error('x'), { code: 'P1001' }))],
    ['index entry IO', wrapped(new MimersArtifactIndexReadError('b', 'p', 'IO', 'EISDIR', { cause: errno('EISDIR') }))],
    ['index entry MALFORMED', wrapped(new MimersArtifactIndexReadError('b', 'p', 'MALFORMED', 'json'))],
    ['object missing', wrapped(new MimersArtifactObjectMissingError('b', 'h', 'get'))],
    ['corrupt bytes', wrapped(casIntegrity())],
    ['Artifact not found', wrapped(new Error('Artifact not found: b'))],
    ['signature', wrapped(new Error('REJECT_PROJECT_CONTEXT_BINDING_V2_SIGNATURE'))],
    ['contract version', wrapped(new Error("REJECT_PROJECT_CONTEXT_BINDING: unknown binding_contract_version '9'"))],
    ['two heads', wrapped(new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: ambiguous head'))],
    ['fork', wrapped(new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: fork'))],
    ['unknown TypeError', wrapped(new TypeError('x'))],
    ['typed index inconsistency', wrapped(new ProjectContextBindingIndexInconsistentError('1 supersession relation(s) registered for the project but no binding'))],
    // W-BOOT verifier finding 3 (A1/A2/A7/A9): structural index damage.
    ['relation names a binding the index lost', wrapped(new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: missing relation binding'))],
    ['the same binding row listed twice', wrapped(new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings'))],
    ["a row naming another project's binding", wrapped(new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: binding project'))],
  ];

  it('the bootstrap gate: reason / retryable / refusalCode are the shared classification', () => {
    for (const [name, error] of corpus) {
      const shared = classifyReadFault(error);
      const gate = classifyBindingResolutionFailure(error);
      expect({ reason: gate.reason, retryable: gate.retryable, refusalCode: gate.refusalCode }, name).toEqual({
        reason: shared.faultClass,
        retryable: shared.retryable,
        refusalCode: shared.refusalCode,
      });
    }
  });

  it('the selection: a binding that cannot be resolved for a project WITH rows gets the shared class', async () => {
    const row = {
      projectId: 'p',
      assessmentArtifactId: 'assessment-x',
      assessmentArtifactType: 'LOCALIZATION_ASSESSMENT',
      projectContextRefId: 'c',
      projectContextRefType: 'LU_PROJECT_CONTEXT',
      bindingArtifactId: 'b',
      releaseArtifactId: 'r',
      localizationGeometryArtifactId: null,
    };
    for (const [name, error] of corpus) {
      const thrown = (await resolveCurrentAssessmentProjection({
        projectId: 'p',
        artifactRepository: { resolve: async () => { throw new Error('never read'); } } as never,
        currentBindingProvider: { resolveCurrent: async () => { throw error; } } as never,
        index: { listForProject: async () => [row] } as never,
      }).catch((e: unknown) => e)) as { reason?: string; retryable?: boolean; refusalCode?: string | null };
      const shared = classifyReadFault(error);
      expect({ reason: thrown.reason, retryable: thrown.retryable, refusalCode: thrown.refusalCode }, name).toEqual({
        reason: shared.faultClass,
        retryable: shared.retryable,
        refusalCode: shared.refusalCode,
      });
    }
    expect(hermeticPrismaTouches).toEqual([]);
  });
});

describe('W-CATCH2 #10/#11: an existing artifact under a deterministic id must be exactly that artifact', () => {
  const bare = { artifact_id: 'issuer-x', artifact_type: 't', content_hash: { algorithm: 'sha256', value: 'h' }, payload: { issuer_key_id: 'k', owner_authority_ref: { artifact_id: 'o', artifact_type: 'a' } } };
  it('the same content with an attestation, in another key order -> exactly it', () => {
    const stored = { attestation: { signer: 'k' }, payload: { owner_authority_ref: { artifact_type: 'a', artifact_id: 'o' }, issuer_key_id: 'k' }, content_hash: { value: 'h', algorithm: 'sha256' }, artifact_type: 't', artifact_id: 'issuer-x' };
    expect(isExactlyTheDeterministicArtifact(stored, bare)).toBe(true);
  });
  it('any edited field, an extra field or a non-object -> not it', () => {
    expect(isExactlyTheDeterministicArtifact({ ...bare, payload: { ...bare.payload, owner_authority_ref: { artifact_id: 'edited', artifact_type: 'a' } } }, bare)).toBe(false);
    expect(isExactlyTheDeterministicArtifact({ ...bare, extra: 1 }, bare)).toBe(false);
    expect(isExactlyTheDeterministicArtifact({ ...bare, payload: { ...bare.payload, issuer_key_id: 'other' } }, bare)).toBe(false);
    expect(isExactlyTheDeterministicArtifact(null, bare)).toBe(false);
    expect(isExactlyTheDeterministicArtifact('issuer-x', bare)).toBe(false);
  });
});

describe('W-CATCH2 (A): presentation helpers', () => {
  it('a refusal is 409, every other fault 503 -- never 404', () => {
    expect(readFaultHttpStatus({ faultClass: 'REFUSED', retryable: false, refusalCode: null })).toBe(409);
    for (const faultClass of ['READ_ERROR', 'STORAGE_INTEGRITY_FAULT', 'MISSING_FROM_CAS', 'BINDING_INDEX_INCONSISTENT'] as const) {
      expect(readFaultHttpStatus({ faultClass, retryable: faultClass === 'READ_ERROR', refusalCode: null })).toBe(503);
    }
  });
  it('the Swedish sentence says whether a retry can help, and never carries a code', () => {
    const read = readFaultSentenceSv({ faultClass: 'READ_ERROR', retryable: true, refusalCode: null }, 'Projektets koppling till fastigheten');
    expect(read).toBe('Projektets koppling till fastigheten kunde inte läsas (tekniskt fel). Ett nytt försök kan lyckas.');
    const lasting = readFaultSentenceSv({ faultClass: 'MISSING_FROM_CAS', retryable: false, refusalCode: null }, 'Kapabiliteten');
    expect(lasting).toBe(
      'Kapabiliteten kunde inte läsas eller verifieras ur arkivet (bestående lagrings- eller integritetsfel). Felet är bestående och löses inte av ett nytt försök. Kontakta systemets administratör.',
    );
    for (const faultClass of ['READ_ERROR', 'STORAGE_INTEGRITY_FAULT', 'MISSING_FROM_CAS', 'BINDING_INDEX_INCONSISTENT', 'REFUSED'] as const) {
      expect(readFaultSentenceSv({ faultClass, retryable: faultClass === 'READ_ERROR', refusalCode: 'REJECT_X' }, 'X')).not.toMatch(/[A-Z]{3,}_[A-Z0-9_]{2,}/);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// W-CATCH3 (CATCH2 verifier finding 13, classification details): a timeout or an abort has unknown
// persistence -- it is a READ_ERROR (retryable) in both phases, never "refused at verification"
// (409, "bestående"). Errors without a code that come from verifying an object that WAS read
// (SyntaxError, TypeError, an unknown Error subclass) stay REFUSED, as before.
// ------------------------------------------------------------------------------------------------
describe('W-CATCH3: a timeout or an abort is a read of unknown persistence, in both phases', () => {
  const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const abort = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  for (const [what, make] of [['TimeoutError', timeout], ['AbortError', abort]] as const) {
    it(`${what} without a code -> READ_ERROR (retryable) when reading AND when verifying`, () => {
      expect(classifyReadFault(make(), 'read')).toEqual({ faultClass: 'READ_ERROR', retryable: true, refusalCode: null });
      expect(classifyReadFault(make(), 'verify')).toEqual({ faultClass: 'READ_ERROR', retryable: true, refusalCode: null });
    });
    it(`${what} as the cause of a refusal-shaped wrapper -> READ_ERROR (a read inside the verification)`, () => {
      expect(classifyReadFault(new Error('REJECT_X_UNAVAILABLE', { cause: make() }), 'verify').faultClass).toBe('READ_ERROR');
    });
  }
  it('control: SyntaxError / TypeError / an unknown Error subclass while verifying stay REFUSED (unchanged)', () => {
    class SomethingElse extends Error {}
    for (const error of [new SyntaxError('Unexpected token'), new TypeError('x is not a function'), new SomethingElse('?')]) {
      expect(classifyReadFault(error, 'verify')).toEqual({ faultClass: 'REFUSED', retryable: false, refusalCode: null });
    }
  });
});
