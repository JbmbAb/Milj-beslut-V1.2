import { describe, expect, it, vi } from 'vitest';

import { AddRequirementUseCase } from '../../src/application/add-requirement.usecase';
import { CreateProjectUseCase } from '../../src/application/create-project.usecase';
import { GetAllProjectsUseCase } from '../../src/application/get-all-projects.usecase';
import { GetProjectAuditTrailUseCase } from '../../src/application/get-project-audit-trail.usecase';
import { GetPropertyDetailsUseCase } from '../../src/application/get-property-details.usecase';
import { RegisterDocumentUseCase } from '../../src/application/register-document.usecase';
import { RegisterPermitUseCase } from '../../src/application/register-permit.usecase';
import { UpdateGpsPositionUseCase } from '../../src/application/update-gps-position.usecase';
import { AuditAction } from '../../src/domain/audit';
import { DocumentCategory, DocumentStatus } from '../../src/domain/document';
import { DecisionType } from '../../src/domain/permit';
import { ProjectStatus, ProjectType } from '../../src/domain/project';
import { RequirementLevel, RequirementStatus } from '../../src/domain/requirement';

describe('src application basic use cases', () => {
  it('creates a project and writes an audit event', async () => {
    const projectRepo = {
      save: vi.fn(async (project) => project),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };

    const useCase = new CreateProjectUseCase(projectRepo as any, auditRepo as any);
    const result = await useCase.execute({
      name: 'Provprojekt',
      description: 'Testar skapande',
      type: ProjectType.ENV_PERMIT,
      location: {
        lat: 59.33,
        lng: 18.06,
        address: 'Testgatan 1',
        propertyId: 'FAST-1',
        municipality: 'Stockholm',
      },
      organisationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.status).toBe(ProjectStatus.DRAFT);
    expect(result.createdBy).toBe('user-1');
    expect(projectRepo.save).toHaveBeenCalledOnce();
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CREATE,
        entityType: 'Project',
        entityId: result.id,
      }),
    );
  });

  it('returns all projects for an organisation', async () => {
    const projects = [{ id: 'project-1', name: 'A' }];
    const projectRepo = {
      findAllByOrganisation: vi.fn().mockResolvedValue(projects),
    };

    const useCase = new GetAllProjectsUseCase(projectRepo as any);
    await expect(useCase.execute('org-1')).resolves.toEqual(projects);
    expect(projectRepo.findAllByOrganisation).toHaveBeenCalledWith('org-1');
  });

  it('returns project audit trail', async () => {
    const auditEvents = [{ id: 'audit-1', entityId: 'project-1' }];
    const auditRepo = {
      findByEntity: vi.fn().mockResolvedValue(auditEvents),
    };

    const useCase = new GetProjectAuditTrailUseCase(auditRepo as any);
    await expect(useCase.execute('project-1')).resolves.toEqual(auditEvents);
    expect(auditRepo.findByEntity).toHaveBeenCalledWith('Project', 'project-1');
  });

  it('registers a document with default PDF metadata and audit', async () => {
    const documentRepo = {
      save: vi.fn(async (document) => document),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };

    const useCase = new RegisterDocumentUseCase(documentRepo as any, auditRepo as any);
    const result = await useCase.execute({
      projectId: 'project-1',
      name: 'Beslut',
      fileName: 'beslut.pdf',
      sizeBytes: 1024,
      category: DocumentCategory.PERMIT_DECISION,
      storagePath: '/docs/beslut.pdf',
      checksum: 'abc123',
      userId: 'user-1',
    });

    expect(result.status).toBe(DocumentStatus.RECEIVED);
    expect(result.mimeType).toBe('application/pdf');
    expect(documentRepo.save).toHaveBeenCalledOnce();
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.UPDATE,
        entityType: 'Document',
        entityId: result.id,
      }),
    );
  });

  it('adds a requirement and marks it pending', async () => {
    const requirementRepo = {
      save: vi.fn(async (requirement) => requirement),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };

    const useCase = new AddRequirementUseCase(requirementRepo as any, auditRepo as any);
    const result = await useCase.execute({
      code: 'KRAV-001',
      category: 'Masshantering',
      text: 'Kravet ska verifieras innan genomförande.',
      level: RequirementLevel.MANDATORY,
      sourceDocumentId: 'doc-1',
      userId: 'user-1',
    });

    expect(result.status).toBe(RequirementStatus.PENDING);
    expect(result.isMinimumRequirement).toBe(false);
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CREATE,
        entityType: 'Requirement',
        entityId: result.id,
      }),
    );
  });

  it('registers a permit case and logs it', async () => {
    const permitRepo = {
      save: vi.fn(async (permit) => permit),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };

    const useCase = new RegisterPermitUseCase(permitRepo as any, auditRepo as any);
    const result = await useCase.execute({
      projectId: 'project-1',
      caseNumber: 'M-123',
      authorityName: 'Miljönämnden',
      municipality: 'Göteborg',
      decisionType: DecisionType.BIFALL,
      userId: 'user-1',
    });

    expect(result.decisionType).toBe(DecisionType.BIFALL);
    expect(result.authorityName).toBe('Miljönämnden');
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'PermitCase',
        action: AuditAction.CREATE,
        entityId: result.id,
      }),
    );
  });

  it('fetches property details and writes an access audit', async () => {
    const geoProvider = {
      fetchPropertyInfo: vi.fn().mockResolvedValue({
        designation: 'FAST-1',
        geometry: null,
      }),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };

    const useCase = new GetPropertyDetailsUseCase(geoProvider as any, auditRepo as any);
    const result = await useCase.execute({
      designation: 'FAST-1',
      userId: 'user-1',
      projectId: 'project-1',
    });

    expect(result).toEqual({ designation: 'FAST-1', geometry: null });
    expect(geoProvider.fetchPropertyInfo).toHaveBeenCalledWith('FAST-1');
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ACCESS,
        entityType: 'Property',
        entityId: 'FAST-1',
      }),
    );
  });

  it('skips audit when property lookup returns null', async () => {
    const geoProvider = {
      fetchPropertyInfo: vi.fn().mockResolvedValue(null),
    };
    const auditRepo = {
      save: vi.fn(),
    };

    const useCase = new GetPropertyDetailsUseCase(geoProvider as any, auditRepo as any);
    await expect(
      useCase.execute({
        designation: 'FAST-404',
        userId: 'user-1',
      }),
    ).resolves.toBeNull();

    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  it('updates GPS position with chain hash and previous hash', async () => {
    const logisticsRepo = {
      getLatestPosition: vi.fn().mockResolvedValue({ hash: 'prev-hash' }),
      addGpsPosition: vi.fn(async (position) => position),
    };
    const auditRepo = {
      save: vi.fn(),
    };

    const useCase = new UpdateGpsPositionUseCase(logisticsRepo as any, auditRepo as any);
    const result = await useCase.execute({
      bookingId: 'booking-1',
      projectId: 'project-1',
      lat: 57.7,
      lng: 11.97,
      speedKmh: 40,
      userId: 'user-1',
    });

    expect(result.prevHash).toBe('prev-hash');
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(logisticsRepo.getLatestPosition).toHaveBeenCalledWith('booking-1');
    expect(logisticsRepo.addGpsPosition).toHaveBeenCalledOnce();
    expect(auditRepo.save).not.toHaveBeenCalled();
  });
});
