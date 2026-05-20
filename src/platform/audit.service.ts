import { IAuditRepository } from '../domain/audit-repository.interface';
import { AuditAction, AuditEvent } from '../domain/audit';
import { randomUUID } from 'node:crypto';

/**
 * AuditService (Platform Layer)
 * Ansvarar för att förenkla och standardisera hur vi loggar juridiska händelser.
 */
export class AuditService {
  constructor(private auditRepo: IAuditRepository) {}

  async log(params: {
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    details: any;
    signatureId?: string;
  }): Promise<void> {
    const event: AuditEvent = {
      id: randomUUID(),
      timestamp: new Date(),
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: typeof params.details === 'string' ? params.details : JSON.stringify(params.details),
      signatureId: params.signatureId,
    };

    // Spara händelsen i det oföränderliga audit-lagret
    await this.auditRepo.save(event);

    // Här kan man i framtiden lägga till:
    // 1. Skicka händelsen till en extern log-aggregator
    // 2. Trigga realtidsnotifikationer
    // 3. Verifiera kedjan av händelser (Blockchain-liknande signering)
  }

  async getHistory(entityType: string, entityId: string): Promise<AuditEvent[]> {
    return await this.auditRepo.findByEntity(entityType, entityId);
  }
}
