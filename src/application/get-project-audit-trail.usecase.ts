import { AuditEvent } from '../domain/audit';
import { IAuditRepository } from '../domain/audit-repository.interface';

export class GetProjectAuditTrailUseCase {
  constructor(private auditRepo: IAuditRepository) {}

  async execute(projectId: string): Promise<AuditEvent[]> {
    // Hämtar alla händelser för entitetstypen "Project" och specifikt ID
    return await this.auditRepo.findByEntity('Project', projectId);
  }
}
