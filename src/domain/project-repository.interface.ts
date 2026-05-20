import { Project } from './project';

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findAllByOrganisation(organisationId?: string): Promise<Project[]>;
  save(project: Project): Promise<Project>;
  delete(id: string): Promise<void>;
}
