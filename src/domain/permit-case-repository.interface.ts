import { PermitCase } from './permit';

export interface IPermitCaseRepository {
  findById(id: string): Promise<PermitCase | null>;
  findByProject(projectId: string): Promise<PermitCase[]>;
  save(permit: PermitCase): Promise<PermitCase>;
}
