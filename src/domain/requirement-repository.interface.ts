import { Requirement } from './requirement';

export interface IRequirementRepository {
  findById(id: string): Promise<Requirement | null>;
  findByProject(projectId: string): Promise<Requirement[]>;
  save(requirement: Requirement): Promise<Requirement>;
  delete(id: string): Promise<void>;
}
