import { prisma } from '../../db.server';
import { AuditEvent, AuditAction } from '../domain/audit';
import { IAuditRepository } from '../domain/audit-repository.interface';

export class PrismaAuditRepository implements IAuditRepository {
  async save(event: AuditEvent): Promise<void> {
    // Current schema uses 'chainHash' and 'payloadHash'.
    // We'll create a simple mapping for now. In a real migration, we'd add 'signatureId' etc.
    await prisma.auditTrail.create({
      data: {
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action.toString(),
        userId: event.userId,
        timestamp: event.timestamp,
        payloadHash: event.details, // Storing full details in payloadHash for now
        chainHash: event.id, // Using event ID as chainHash for uniqueness
      },
    });
  }

  async findByEntity(entityType: string, entityId: string): Promise<AuditEvent[]> {
    const logs = await prisma.auditTrail.findMany({
      where: { entityType, entityId },
      orderBy: { timestamp: 'desc' },
    });

    return logs.map((l) => this.mapToDomain(l));
  }

  async findByUser(userId: string): Promise<AuditEvent[]> {
    const logs = await prisma.auditTrail.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
    });

    return logs.map((l) => this.mapToDomain(l));
  }

  async findLatest(limit: number): Promise<AuditEvent[]> {
    const logs = await prisma.auditTrail.findMany({
      take: limit,
      orderBy: { timestamp: 'desc' },
    });

    return logs.map((l) => this.mapToDomain(l));
  }

  private mapToDomain(log: any): AuditEvent {
    return {
      id: log.chainHash,
      timestamp: log.timestamp,
      userId: log.userId || 'SYSTEM',
      action: log.action as AuditAction,
      entityType: log.entityType,
      entityId: log.entityId,
      details: log.payloadHash,
    };
  }
}
