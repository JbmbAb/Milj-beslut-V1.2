import { prisma } from '../../db.server';
import { Project, ProjectStatus, ProjectType } from '../domain/project';
import { IProjectRepository } from '../domain/project-repository.interface';
import { ProjectStatus as PrismaProjectStatus } from '@prisma/client';

export class PrismaProjectRepository implements IProjectRepository {
  async findById(id: string): Promise<Project | null> {
    const project = await prisma.project.findUnique({
      where: { id },
      include: { planState: true },
    });

    if (!project) return null;

    return this.mapToDomain(project);
  }

  async findAllByOrganisation(organisationId?: string): Promise<Project[]> {
    const where = organisationId ? { organisationId } : {};
    const projects = await prisma.project.findMany({
      where,
      include: { planState: true },
      orderBy: { createdAt: 'desc' },
      take: 50, // Begränsning för dashboarden i V2
    });

    return projects.map((p) => this.mapToDomain(p));
  }

  async save(project: Project): Promise<Project> {
    // Upsert implementation
    const data = {
      organisationId: project.organisationId,
      propertyDesignation: project.location.propertyId, // Mapping name to propertyDesignation
      status: this.mapStatusToPrisma(project.status),
      // createdAt and updatedAt managed by Prisma if we use prisma.@updatedAt in schema,
      // but Project has Date objects. For now, we manually sync.
    };

    const upserted = await prisma.project.upsert({
      where: { id: project.id },
      update: data,
      create: { ...data, id: project.id },
      include: { planState: true },
    });

    // Also handle ProjectPlanState for extra domain fields
    const planData = {
      name: project.name,
      description: project.description,
      type: project.type,
      location: project.location,
    };

    await prisma.projectPlanState.upsert({
      where: { projectId: upserted.id },
      update: { plan: planData as any },
      create: {
        projectId: upserted.id,
        plan: planData as any,
      },
    });

    return this.mapToDomain({ ...upserted, planState: { plan: planData } as any });
  }

  async delete(id: string): Promise<void> {
    await prisma.project.delete({ where: { id } });
  }

  private mapToDomain(prismaProject: any): Project {
    const plan = (prismaProject.planState?.plan as any) || {};

    return {
      id: prismaProject.id,
      name: plan.name || prismaProject.propertyDesignation,
      description: plan.description || '',
      status: this.mapStatusToDomain(prismaProject.status),
      type: (plan.type as ProjectType) || ProjectType.ENV_PERMIT,
      location: plan.location || {
        lat: 0,
        lng: 0,
        address: '',
        propertyId: prismaProject.propertyDesignation,
        municipality: '',
      },
      organisationId: prismaProject.organisationId,
      createdBy: '', // This info is in projectMember/User, needs more logic if needed
      createdAt: prismaProject.createdAt,
      updatedAt: prismaProject.planState?.updatedAt || prismaProject.createdAt,
    };
  }

  private mapStatusToDomain(status: PrismaProjectStatus): ProjectStatus {
    switch (status) {
      case 'ACTIVE':
        return ProjectStatus.ACTIVE;
      case 'ARCHIVED':
        return ProjectStatus.ARCHIVED;
      case 'CLOSED':
        return ProjectStatus.COMPLETED;
      default:
        return ProjectStatus.DRAFT;
    }
  }

  private mapStatusToPrisma(status: ProjectStatus): PrismaProjectStatus {
    switch (status) {
      case ProjectStatus.ACTIVE:
        return 'ACTIVE';
      case ProjectStatus.ARCHIVED:
        return 'ARCHIVED';
      case ProjectStatus.COMPLETED:
        return 'CLOSED';
      default:
        return 'ACTIVE'; // Fallback
    }
  }
}
