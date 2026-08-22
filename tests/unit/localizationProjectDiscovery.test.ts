import { beforeEach, describe, expect, it, vi } from 'vitest';

const { projectCreate, projectFindMany, memberUpsert } = vi.hoisted(() => ({
  projectCreate: vi.fn(),
  projectFindMany: vi.fn(),
  memberUpsert: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: { create: projectCreate, findMany: projectFindMany },
    projectMember: { upsert: memberUpsert },
  },
}));

import { createLocalizationProject, listProjectsForProperty } from '../../server/modules/localization/localizationProjectDiscovery';

describe('PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B: localizationProjectDiscovery', () => {
  beforeEach(() => {
    projectCreate.mockReset();
    projectFindMany.mockReset();
    memberUpsert.mockReset();
  });

  it('createLocalizationProject ALWAYS inserts -- never checks for or reuses an existing project by designation', async () => {
    projectCreate.mockResolvedValue({ id: 'proj-2', name: 'Localization B', propertyDesignation: 'ORSA STACKMORA 3:12', status: 'ACTIVE', createdAt: new Date() });
    memberUpsert.mockResolvedValue({});

    const project = await createLocalizationProject({
      organisationId: 'org-1',
      propertyDesignation: 'orsa stackmora 3:12',
      name: 'Localization B',
      userId: 'user-1',
    });

    expect(projectCreate).toHaveBeenCalledTimes(1);
    expect(projectCreate).toHaveBeenCalledWith({
      data: { organisationId: 'org-1', name: 'Localization B', propertyDesignation: 'ORSA STACKMORA 3:12', status: 'ACTIVE' },
      select: expect.any(Object),
    });
    // No findFirst/upsert-by-designation lookup anywhere in this function -- create is unconditional.
    expect(projectFindMany).not.toHaveBeenCalled();
    expect(project.id).toBe('proj-2');
  });

  it('createLocalizationProject makes the creating user real ProjectMember{OWNER}', async () => {
    projectCreate.mockResolvedValue({ id: 'proj-3', name: 'X', propertyDesignation: 'ORSA STACKMORA 3:12', status: 'ACTIVE', createdAt: new Date() });
    memberUpsert.mockResolvedValue({});

    await createLocalizationProject({ organisationId: 'org-1', propertyDesignation: 'ORSA STACKMORA 3:12', name: 'X', userId: 'user-9' });

    expect(memberUpsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: 'proj-3', userId: 'user-9' } },
      create: { projectId: 'proj-3', userId: 'user-9', accessRole: 'OWNER' },
      update: {},
    });
  });

  it('createLocalizationProject rejects empty name/designation', async () => {
    await expect(createLocalizationProject({ organisationId: 'org-1', propertyDesignation: '', name: 'X', userId: 'u' })).rejects.toThrow();
    await expect(createLocalizationProject({ organisationId: 'org-1', propertyDesignation: 'X', name: '', userId: 'u' })).rejects.toThrow();
  });

  it('listProjectsForProperty is read-only discovery -- every row for the property, any status', async () => {
    projectFindMany.mockResolvedValue([
      { id: 'proj-1', name: 'A', propertyDesignation: 'ORSA STACKMORA 3:12', status: 'ACTIVE', createdAt: new Date() },
      { id: 'proj-2', name: 'B', propertyDesignation: 'ORSA STACKMORA 3:12', status: 'CLOSED', createdAt: new Date() },
    ]);

    const rows = await listProjectsForProperty({ organisationId: 'org-1', propertyDesignation: 'orsa stackmora 3:12' });

    expect(projectFindMany).toHaveBeenCalledWith({
      where: { organisationId: 'org-1', propertyDesignation: 'ORSA STACKMORA 3:12' },
      orderBy: { createdAt: 'desc' },
      select: expect.any(Object),
    });
    expect(rows).toHaveLength(2);
    expect(projectCreate).not.toHaveBeenCalled();
  });
});
