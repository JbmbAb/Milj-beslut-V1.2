/**
 * W-CATCH2 #14: the project-access check's own DECISION "no access" is a typed ProjectAccessDeniedError
 * (code PROJECT_ACCESS_DENIED, the same messages as before); a database that cannot answer is never that
 * denial -- it propagates as it was, and the shared classification reads it as a read fault.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ project: null as unknown, member: null as unknown, error: null as Error | null }));
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(async () => { if (db.error) throw db.error; return db.project; }) },
    projectMember: { findUnique: vi.fn(async () => db.member) },
  },
}));

import { assertProjectMembership, ProjectAccessDeniedError, PROJECT_ACCESS_DENIED } from '../../server/repositories/projectAccessRepository';
import { classifyReadFault, isProjectAccessDenied, projectAccessFailure } from '../../server/modules/localization/readFaultClassification';

const INPUT = { projectId: 'p1', userId: 'u1', organisationId: 'o1' };

beforeEach(() => {
  db.project = { id: 'p1', organisationId: 'o1', status: 'ACTIVE' };
  db.member = { id: 'm1' };
  db.error = null;
});

describe('W-CATCH2 #14: the access check types its denial', () => {
  const denials: Array<[string, () => void]> = [
    ['Project not found', () => { db.project = null; }],
    ['Cross-organisation access denied', () => { db.project = { id: 'p1', organisationId: 'other', status: 'ACTIVE' }; }],
    ['Project is not active', () => { db.project = { id: 'p1', organisationId: 'o1', status: 'ARCHIVED' }; }],
    ['User is not a member of this project', () => { db.member = null; }],
  ];
  for (const [message, arrange] of denials) {
    it(`"${message}" -> ProjectAccessDeniedError (code ${PROJECT_ACCESS_DENIED}, same message), answered 403`, async () => {
      arrange();
      const error = await assertProjectMembership(INPUT).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProjectAccessDeniedError);
      expect(error).toMatchObject({ message, code: PROJECT_ACCESS_DENIED });
      expect(isProjectAccessDenied(error)).toBe(true);
      expect(projectAccessFailure(error)).toEqual({ ok: false, status: 403, error: 'Not authorized for this project.' });
    });
  }

  it('a member passes (unchanged)', async () => {
    await expect(assertProjectMembership(INPUT)).resolves.toBeUndefined();
  });

  it('a database that cannot answer is NOT a denial: it propagates unchanged and classifies as a read fault (503)', async () => {
    db.error = Object.assign(new Error("Can't reach database server"), { name: 'PrismaClientInitializationError' });
    const error = await assertProjectMembership(INPUT).catch((e: unknown) => e);
    expect(error).toBe(db.error);
    expect(isProjectAccessDenied(error)).toBe(false);
    expect(classifyReadFault(error).faultClass).toBe('READ_ERROR');
    expect(projectAccessFailure(error)).toMatchObject({ status: 503, code: 'PROJECT_ACCESS_UNRESOLVED', retryable: true });
  });
});
