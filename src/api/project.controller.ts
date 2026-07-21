import { CreateProjectUseCase, CreateProjectInput } from '../application/create-project.usecase';
import { GetProjectAuditTrailUseCase } from '../application/get-project-audit-trail.usecase';
import { GetAllProjectsUseCase } from '../application/get-all-projects.usecase';
import { PrismaProjectRepository } from '../infrastructure/prisma-project-repository';
import { PrismaAuditRepository } from '../infrastructure/prisma-audit-repository';
import { CreateProjectSchema } from './project.schema';

export class ProjectController {
  private createProjectUseCase: CreateProjectUseCase;
  private getAuditTrailUseCase: GetProjectAuditTrailUseCase;
  private getAllProjectsUseCase: GetAllProjectsUseCase;

  constructor(projectRepo?: PrismaProjectRepository, auditRepo?: PrismaAuditRepository) {
    const pRepo = projectRepo || new PrismaProjectRepository();
    const aRepo = auditRepo || new PrismaAuditRepository();

    this.createProjectUseCase = new CreateProjectUseCase(pRepo, aRepo);
    this.getAuditTrailUseCase = new GetProjectAuditTrailUseCase(aRepo);
    this.getAllProjectsUseCase = new GetAllProjectsUseCase(pRepo);
  }

  async create(data: unknown, userId: string) {
    const validatedData = CreateProjectSchema.parse(data);
    const input: CreateProjectInput = {
      name: validatedData.name,
      description: validatedData.description,
      type: validatedData.type,
      location: {
        lat: validatedData.location.lat,
        lng: validatedData.location.lng,
        address: validatedData.location.address,
        propertyId: validatedData.location.propertyId,
        municipality: validatedData.location.municipality,
      },
      organisationId: validatedData.organisationId,
      userId,
    };
    return await this.createProjectUseCase.execute(input);
  }

  async getAuditTrail(projectId: string) {
    return await this.getAuditTrailUseCase.execute(projectId);
  }

  async getAllByOrganisation(organisationId?: string) {
    return await this.getAllProjectsUseCase.execute(organisationId);
  }
}
