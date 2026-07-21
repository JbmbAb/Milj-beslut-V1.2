import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';

const { getUserFromAccessToken, assertProjectMembership, findUnique, findMany, create } = vi.hoisted(() => ({
  getUserFromAccessToken: vi.fn(),
  assertProjectMembership: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../../server/security/auth', () => ({
  getUserFromAccessToken,
}));

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership,
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    requirementCase: {
      findUnique,
    },
    caseNote: {
      findMany,
      create,
    },
  },
}));

import { action, loader } from '../../legacy/remix-poc/routes/api.cases.$caseId.notes';

function asLoaderArgs(request: Request, caseId = 'case-1'): LoaderFunctionArgs {
  return { request, params: { caseId }, context: {} as never };
}

function asActionArgs(request: Request, caseId = 'case-1'): ActionFunctionArgs {
  return { request, params: { caseId }, context: {} as never };
}

describe('legacy/remix-poc/routes/api.cases.$caseId.notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getUserFromAccessToken.mockResolvedValue({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'bankid-1',
      role: 'ADMIN',
    });
    findUnique.mockResolvedValue({
      id: 'case-1',
      organisationId: 'org-1',
      projectId: 'project-1',
    });
    assertProjectMembership.mockResolvedValue(undefined);
    findMany.mockResolvedValue([]);
    create.mockResolvedValue({
      id: 'note-default',
      text: 'Ny anteckning',
      author: 'Handläggare (Admin)',
      createdAt: new Date('2026-03-29T13:00:00.000Z'),
    });
  });

  it('returns notes without requiring bearer token in the archived remix route', async () => {
    const response = await loader(asLoaderArgs(new Request('http://localhost/api/cases/case-1/notes')));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { caseId: 'case-1' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, text: true, author: true, createdAt: true },
    });
  });

  it('returns notes from prisma without project-membership gating in the archived route', async () => {
    findMany.mockResolvedValue([
      {
        id: 'note-1',
        text: 'Verifierad notering',
        author: 'Handlaggare (ADMIN)',
        createdAt: new Date('2026-03-29T12:00:00.000Z'),
      },
    ]);

    const response = await loader(
      asLoaderArgs(
        new Request('http://localhost/api/cases/case-1/notes', {
          headers: { Authorization: 'Bearer valid-token' },
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        id: 'note-1',
        text: 'Verifierad notering',
        author: 'Handlaggare (ADMIN)',
        timestamp: '2026-03-29T12:00:00.000Z',
      },
    ]);
    expect(assertProjectMembership).not.toHaveBeenCalled();
  });

  it('ignores project-membership failures because the archived route has no access check', async () => {
    assertProjectMembership.mockRejectedValue(new Error('User is not a member of this project'));

    const response = await loader(
      asLoaderArgs(
        new Request('http://localhost/api/cases/case-1/notes', {
          headers: { Authorization: 'Bearer valid-token' },
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it('treats any authorization header as admin-like label in the archived route', async () => {
    getUserFromAccessToken.mockRejectedValue(new Error('Invalid signature'));

    const response = await action(
      asActionArgs(
        new Request('http://localhost/api/cases/case-1/notes', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer definitely-not-valid',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'Ny anteckning' }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'note-default',
      text: 'Ny anteckning',
      author: 'Handläggare (Admin)',
      timestamp: '2026-03-29T13:00:00.000Z',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        text: 'Ny anteckning',
        author: 'Handläggare (Admin)',
      },
    });
  });

  it('creates notes with a verified author label', async () => {
    create.mockResolvedValue({
      id: 'note-2',
      text: 'Ny anteckning',
      author: 'Handläggare (Admin)',
      createdAt: new Date('2026-03-29T13:00:00.000Z'),
    });

    const response = await action(
      asActionArgs(
        new Request('http://localhost/api/cases/case-1/notes', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'Ny anteckning' }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'note-2',
      text: 'Ny anteckning',
      author: 'Handläggare (Admin)',
      timestamp: '2026-03-29T13:00:00.000Z',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        text: 'Ny anteckning',
        author: 'Handläggare (Admin)',
      },
    });
  });
});
