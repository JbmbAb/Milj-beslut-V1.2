import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../src/application/compute-compliance-profile.usecase', () => ({
  ComputeComplianceProfileUseCase: vi.fn(function MockedComputeUseCase() {
    return {
      execute: vi.fn().mockResolvedValue({ projectId: 'project-1', overallScore: 88 }),
    };
  }),
}));

vi.mock('../../src/application/create-project.usecase', () => ({
  CreateProjectUseCase: vi.fn(function MockedCreateProjectUseCase() {
    return {
      execute: vi.fn().mockResolvedValue({ id: 'project-1', name: 'Projekt 1' }),
    };
  }),
}));

vi.mock('../../src/application/get-project-audit-trail.usecase', () => ({
  GetProjectAuditTrailUseCase: vi.fn(function MockedGetAuditTrailUseCase() {
    return {
      execute: vi.fn().mockResolvedValue([{ id: 'audit-1' }]),
    };
  }),
}));

vi.mock('../../src/application/get-all-projects.usecase', () => ({
  GetAllProjectsUseCase: vi.fn(function MockedGetAllProjectsUseCase() {
    return {
      execute: vi.fn().mockResolvedValue([{ id: 'project-1' }]),
    };
  }),
}));

vi.mock('../../src/infrastructure/prisma-project-repository', () => ({
  PrismaProjectRepository: vi.fn(),
}));

vi.mock('../../src/infrastructure/prisma-audit-repository', () => ({
  PrismaAuditRepository: vi.fn(),
}));

import { ComplianceController } from '../../src/api/compliance.api';
import { DocumentController, RegisterDocumentSchema } from '../../src/api/document.api';
import { PermitController } from '../../src/api/permit.api';
import { ProjectController } from '../../src/api/project.controller';
import { RequirementController } from '../../src/api/requirement.api';
import { DocumentCategory } from '../../src/domain/document';
import { DecisionType } from '../../src/domain/permit';
import { ProjectType } from '../../src/domain/project';
import { RequirementLevel } from '../../src/domain/requirement';

describe('additional src api controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a document through DocumentController', async () => {
    const documentRepo = {
      save: vi.fn(async (document) => document),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };
    const controller = new DocumentController(documentRepo as any, auditRepo as any);

    await expect(
      controller.register(
        {
          projectId: '11111111-1111-4111-8111-111111111111',
          name: 'Beslut',
          fileName: 'beslut.pdf',
          sizeBytes: 2048,
          category: DocumentCategory.PERMIT_DECISION,
          storagePath: '/docs/beslut.pdf',
          checksum: 'abc123',
        },
        'user-1',
      ),
    ).resolves.toMatchObject({
      projectId: '11111111-1111-4111-8111-111111111111',
      name: 'Beslut',
      uploadedBy: 'user-1',
    });
  });

  it('rejects invalid document payloads', () => {
    expect(() =>
      RegisterDocumentSchema.parse({
        projectId: 'not-a-uuid',
        name: 'X',
        fileName: 'x.pdf',
        sizeBytes: 0,
        category: DocumentCategory.PERMIT_DECISION,
        storagePath: '/docs/x.pdf',
        checksum: 'abc123',
      }),
    ).toThrow(z.ZodError);
  });

  it('registers a permit through PermitController', async () => {
    const controller = new PermitController(
      {
        save: vi.fn(async (permit) => permit),
      } as any,
      {
        save: vi.fn(async (event) => event),
      } as any,
    );

    await expect(
      controller.register(
        {
          projectId: '11111111-1111-4111-8111-111111111111',
          caseNumber: 'M-2026-1',
          authorityName: 'Miljönämnden',
          municipality: 'Malmö',
          decisionType: DecisionType.BIFALL,
        },
        'user-1',
      ),
    ).resolves.toMatchObject({
      authorityName: 'Miljönämnden',
      municipality: 'Malmö',
      decisionType: DecisionType.BIFALL,
    });
  });

  it('adds a requirement through RequirementController', async () => {
    const controller = new RequirementController(
      {
        save: vi.fn(async (requirement) => requirement),
      } as any,
      {
        save: vi.fn(async (event) => event),
      } as any,
    );

    await expect(
      controller.add(
        {
          code: 'KRAV-001',
          category: 'Miljö',
          text: 'Detta är ett tillräckligt långt krav för valideringen.',
          level: RequirementLevel.MANDATORY,
          sourceDocumentId: '11111111-1111-4111-8111-111111111111',
        },
        'user-1',
      ),
    ).resolves.toMatchObject({
      code: 'KRAV-001',
      level: RequirementLevel.MANDATORY,
      status: 'PENDING',
    });
  });

  it('creates projects through ProjectController and validates schema', async () => {
    const controller = new ProjectController();

    await expect(
      controller.create(
        {
          name: 'Projekt 1',
          type: ProjectType.ENV_PERMIT,
          location: {
            lat: 59.33,
            lng: 18.06,
            address: 'Testgatan 1',
            propertyId: 'FAST-1',
            municipality: 'Stockholm',
          },
          organisationId: '11111111-1111-4111-8111-111111111111',
        },
        'user-1',
      ),
    ).resolves.toEqual({ id: 'project-1', name: 'Projekt 1' });
  });

  it('rejects invalid project create payloads', async () => {
    const controller = new ProjectController();

    await expect(
      controller.create(
        {
          name: 'No',
          type: ProjectType.ENV_PERMIT,
          location: {
            lat: 59.33,
            lng: 18.06,
            address: 'Testgatan 1',
            propertyId: 'FAST-1',
            municipality: 'Stockholm',
          },
          organisationId: 'not-a-uuid',
        },
        'user-1',
      ),
    ).rejects.toThrow(z.ZodError);
  });

  it('delegates audit trail and organisation project lookups', async () => {
    const controller = new ProjectController();

    await expect(controller.getAuditTrail('project-1')).resolves.toEqual([{ id: 'audit-1' }]);
    await expect(controller.getAllByOrganisation('org-1')).resolves.toEqual([{ id: 'project-1' }]);
  });

  it('reuses latest compliance profile or recomputes when missing', async () => {
    const complianceRepo = {
      findLatestProfile: vi
        .fn()
        .mockResolvedValueOnce({ projectId: 'project-1', overallScore: 77 })
        .mockResolvedValueOnce(null),
    };
    const controller = new ComplianceController(complianceRepo as any, {} as any, {} as any, {} as any);

    await expect(controller.getProfile('project-1')).resolves.toEqual({
      projectId: 'project-1',
      overallScore: 77,
    });
    await expect(controller.getProfile('project-1')).resolves.toEqual({
      projectId: 'project-1',
      overallScore: 88,
    });
    await expect(controller.recomputeProfile('project-1')).resolves.toEqual({
      projectId: 'project-1',
      overallScore: 88,
    });
  });
});
