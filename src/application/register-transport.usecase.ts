import { TransportBooking, TransportStatus } from '../domain/logistics';
import { ILogisticsRepository } from '../domain/logistics-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { AuditAction } from '../domain/audit';
import { randomUUID } from 'node:crypto';

export interface RegisterTransportInput {
  projectId: string;
  wasteCode: string;
  tons: number;
  plannedDate: Date;
  userId: string;
}

export class RegisterTransportUseCase {
  constructor(
    private logisticsRepo: ILogisticsRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: RegisterTransportInput): Promise<TransportBooking> {
    const booking: TransportBooking = {
      id: randomUUID(),
      projectId: input.projectId,
      wasteCode: input.wasteCode,
      tons: input.tons,
      status: TransportStatus.PLANNED,
      plannedDate: input.plannedDate,
    };

    const saved = await this.logisticsRepo.saveBooking(booking);

    await this.auditRepo.save({
      id: randomUUID(),
      timestamp: new Date(),
      userId: input.userId,
      action: AuditAction.CREATE,
      entityType: 'TransportBooking',
      entityId: saved.id,
      details: `Transport of ${input.tons} tons planned for project ${input.projectId}`,
    });

    return saved;
  }
}
