import { describe, expect, it, vi, beforeEach } from 'vitest';

const { projectFindUnique, memberFindFirst } = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  memberFindFirst: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: { findUnique: projectFindUnique },
    projectMember: { findFirst: memberFindFirst },
  },
}));

const { mimersCreate, resolveCurrentMock, getVerifierMock } = vi.hoisted(() => ({
  mimersCreate: vi.fn(),
  resolveCurrentMock: vi.fn(),
  getVerifierMock: vi.fn(),
}));

vi.mock('@miljobeslut/mps-runtime', () => ({
  MimersIntegration: { create: mimersCreate },
}));
vi.mock('../../server/modules/localization/projectContextBindingRuntime', () => ({
  ProjectContextBindingProvider: class {
    resolveCurrent(...args: unknown[]) {
      return resolveCurrentMock(...args);
    }
  },
}));
vi.mock('../../server/security/projectContextBindingIssuerKey', () => ({
  getProjectContextBindingIssuerVerifier: getVerifierMock,
  getProjectContextBindingIssuerSigner: vi.fn(),
}));
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: vi.fn(),
}));

import { executeProjectContextBootstrap } from '../../server/modules/localization/luProjectContextBootstrap';

describe('PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B: executeProjectContextBootstrap', () => {
  beforeEach(() => {
    projectFindUnique.mockReset();
    memberFindFirst.mockReset();
    mimersCreate.mockReset();
    resolveCurrentMock.mockReset();
    getVerifierMock.mockReset();
    mimersCreate.mockResolvedValue({ artifactRepository: {} });
  });

  it('nonexistent project -> FAILED_CLOSED (PROJECT_NOT_FOUND), no CAS/property work attempted', async () => {
    projectFindUnique.mockResolvedValue(null);
    const outcome = await executeProjectContextBootstrap({ projectId: 'no-such-project', propertyDesignation: 'ORSA STACKMORA 3:12' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('PROJECT_NOT_FOUND');
    expect(memberFindFirst).not.toHaveBeenCalled();
    expect(mimersCreate).not.toHaveBeenCalled();
  });

  it('property mismatch (request claims a different property than the project actually has) -> FAILED_CLOSED', async () => {
    projectFindUnique.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1', propertyDesignation: 'ORSA STACKMORA 3:12' });
    const outcome = await executeProjectContextBootstrap({ projectId: 'proj-1', propertyDesignation: 'SOME OTHER PROPERTY 1:1' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('PROPERTY_MISMATCH');
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  it('no legitimate ProjectMember{OWNER} on the project -> FAILED_CLOSED, never mints on the worker\'s own say-so', async () => {
    projectFindUnique.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1', propertyDesignation: 'ORSA STACKMORA 3:12' });
    memberFindFirst.mockResolvedValue(null);
    const outcome = await executeProjectContextBootstrap({ projectId: 'proj-1', propertyDesignation: 'ORSA STACKMORA 3:12' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('NO_LEGITIMATE_OWNER');
    expect(mimersCreate).not.toHaveBeenCalled();
  });

  it('binding already valid for project -> recognized/reused, no re-mint attempted', async () => {
    projectFindUnique.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1', propertyDesignation: 'ORSA STACKMORA 3:12' });
    memberFindFirst.mockResolvedValue({
      userId: 'user-1',
      user: { id: 'user-1', organisationId: 'org-1', bankidId: 'admin:admin', role: 'ADMIN', identityEnvironment: 'LEGACY' },
    });
    resolveCurrentMock.mockResolvedValue({ artifact_id: 'project-context-binding-existing-xyz' });

    const outcome = await executeProjectContextBootstrap({ projectId: 'proj-1', propertyDesignation: 'ORSA STACKMORA 3:12' });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.contextBindingArtifactId).toBe('project-context-binding-existing-xyz');
      expect(outcome.reused).toBe(true);
    }
  });
});
