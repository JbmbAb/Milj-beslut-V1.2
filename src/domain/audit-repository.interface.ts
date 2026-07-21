import { AuditEvent } from './audit';

export interface IAuditRepository {
  save(event: AuditEvent): Promise<void>;
  findByEntity(entityType: string, entityId: string): Promise<AuditEvent[]>;
  findByUser(userId: string): Promise<AuditEvent[]>;
  findLatest(limit: number): Promise<AuditEvent[]>;
}
