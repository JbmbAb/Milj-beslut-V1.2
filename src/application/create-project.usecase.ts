import { Project, ProjectStatus, ProjectType, ProjectLocation } from '../domain/project';
import { IProjectRepository } from '../domain/project-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { AuditAction } from '../domain/audit';
import { randomUUID } from 'node:crypto';

export interface CreateProjectInput {
  name: string;
  description: string;
  type: ProjectType;
  location: ProjectLocation;
  organisationId: string;
  userId: string;
}

export class CreateProjectUseCase {
  constructor(
    private projectRepo: IProjectRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      status: ProjectStatus.DRAFT,
      type: input.type,
      location: input.location,
      organisationId: input.organisationId,
      createdBy: input.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 1. Spara projektet
    const savedProject = await this.projectRepo.save(project);

    // 2. Logga händelsen för juridisk spårbarhet
    await this.auditRepo.save({
      id: randomUUID(),
      timestamp: new Date(),
      userId: input.userId,
      action: AuditAction.CREATE,
      entityType: 'Project',
      entityId: savedProject.id,
      details: `Project "${savedProject.name}" created by ${input.userId}`,
    });

    return savedProject;
  }
}
