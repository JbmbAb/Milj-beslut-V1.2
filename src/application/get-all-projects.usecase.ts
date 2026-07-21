import { Project } from '../domain/project';
import { IProjectRepository } from '../domain/project-repository.interface';

export class GetAllProjectsUseCase {
  constructor(private projectRepo: IProjectRepository) {}

  async execute(organisationId?: string): Promise<Project[]> {
    return await this.projectRepo.findAllByOrganisation(organisationId);
  }
}
