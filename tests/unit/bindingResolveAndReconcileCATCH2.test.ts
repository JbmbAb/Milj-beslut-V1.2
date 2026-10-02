/**
 * W-CATCH2 #7 and #16 (owner decisions 2026-10-02/03, OD-R2), the smaller "the cause is lost" cases on
 * surfaces this unit touched:
 *  - #7 ProjectContextBindingProvider.resolve(): an index read error, a CAS read error and a failed
 *    verification all became the same REJECT_* refusal with the cause dropped. The refusal messages stay
 *    exactly as they were (callers key on them); the original failure is now kept as `cause`, so the
 *    shared classification can tell a read error (retryable) from a refusal.
 *  - #16 reconcileAssessmentProjection (operator reconciliation): every CAS read failure became
 *    MISSING_CAS_ARTIFACT. Only the repository's proven "never stored" for that id is; any other read
 *    failure propagates as a typed LuReadFaultError -- like the projection-store failure it already
 *    propagates -- so an operator run never records a read error as a missing artifact.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import { MimersArtifactObjectMissingError } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { reconcileAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { classifyReadFault, LuReadFaultError } from '../../server/modules/localization/readFaultClassification';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const errno = (code: string) => Object.assign(new Error(`${code}: simulated`), { code });
const CONTEXT = { artifact_id: 'lu-context-catch2', artifact_type: 'LU_PROJECT_CONTEXT' } as const;

describe('W-CATCH2 #7: ProjectContextBindingProvider.resolve keeps the cause behind its unchanged refusals', () => {
  it('the index cannot be read -> REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE with the read error as cause (READ_ERROR)', async () => {
    const provider = new ProjectContextBindingProvider({} as never, { resolve: async () => { throw errno('ECONNREFUSED'); } } as never, {} as never);
    const error = (await provider.resolve('p', CONTEXT).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
    expect((error.cause as { code?: string }).code).toBe('ECONNREFUSED');
    expect(classifyReadFault(error).faultClass).toBe('READ_ERROR');
  });

  it('the binding cannot be read from CAS -> the same refusal with the storage fault as cause (STORAGE_INTEGRITY_FAULT)', async () => {
    const repo = { resolve: async () => { throw new MimersArtifactObjectMissingError('b', 'h', 'get'); } };
    const provider = new ProjectContextBindingProvider(repo as never, { resolve: async () => 'b' } as never, {} as never);
    const error = (await provider.resolve('p', CONTEXT).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
    expect(error.cause).toBeInstanceOf(MimersArtifactObjectMissingError);
    expect(classifyReadFault(error).faultClass).toBe('STORAGE_INTEGRITY_FAULT');
  });

  it('a binding the index names is not in the CAS -> the same refusal, cause "Artifact not found" (MISSING_FROM_CAS)', async () => {
    const repo = { resolve: async () => { throw new Error('Artifact not found: b'); } };
    const provider = new ProjectContextBindingProvider(repo as never, { resolve: async () => 'b' } as never, {} as never);
    const error = (await provider.resolve('p', CONTEXT).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
    expect(classifyReadFault(error).faultClass).toBe('MISSING_FROM_CAS');
  });

  it('the index answers "no unambiguous binding" -> the refusal keeps the index refusal as cause (REFUSED, its own token)', async () => {
    const provider = new ProjectContextBindingProvider({} as never, { resolve: async () => { throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE'); } } as never, {} as never);
    const error = (await provider.resolve('p', CONTEXT).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
    expect(classifyReadFault(error)).toEqual({ faultClass: 'REFUSED', retryable: false, refusalCode: 'REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE' });
  });
});

describe('W-CATCH2 #16: reconcileAssessmentProjection records MISSING_CAS_ARTIFACT only for a proven absence', () => {
  const base = {
    projectId: 'p',
    assessmentArtifactId: 'assessment-x',
    currentProjectContextRef: CONTEXT,
    currentBindingRef: { artifact_id: 'b', artifact_type: 'project_context_binding' },
    currentReleaseRef: { artifact_id: 'r', artifact_type: 'product_release' },
    index: { register: async () => { throw new Error('never registered in this test'); } } as never,
  };

  it('"Artifact not found: <that id>" -> MISSING_CAS_ARTIFACT (unchanged)', async () => {
    const result = await reconcileAssessmentProjection({ ...base, artifactRepository: { resolve: async () => { throw new Error('Artifact not found: assessment-x'); } } as never });
    expect(result).toEqual({ reconciled: false, reason: 'MISSING_CAS_ARTIFACT' });
  });

  for (const [name, fault, faultClass] of [
    ['a read error (EIO)', () => errno('EIO'), 'READ_ERROR'],
    ['an object gone behind its index entry', () => new MimersArtifactObjectMissingError('assessment-x', 'h', 'get'), 'STORAGE_INTEGRITY_FAULT'],
    ['corrupt bytes', () => Object.assign(new Error('hash mismatch'), { name: 'CASIntegrityError' }), 'STORAGE_INTEGRITY_FAULT'],
  ] as const) {
    it(`${name} -> a typed LuReadFaultError ${faultClass}, never MISSING_CAS_ARTIFACT`, async () => {
      const outcome = await reconcileAssessmentProjection({ ...base, artifactRepository: { resolve: async () => { throw fault(); } } as never }).catch((e: unknown) => e);
      expect(outcome).toBeInstanceOf(LuReadFaultError);
      expect({ subject: (outcome as LuReadFaultError).subject, faultClass: (outcome as LuReadFaultError).faultClass }).toEqual({ subject: 'assessment', faultClass });
      expect(hermeticPrismaTouches).toEqual([]);
    });
  }
});
