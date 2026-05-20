import { PropertyInfo } from '../domain/geo';
import { IGeoProvider } from '../domain/geo-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { AuditAction } from '../domain/audit';
import { randomUUID } from 'node:crypto';

export interface GetPropertyDetailsInput {
  designation: string;
  userId: string;
  projectId?: string;
}

export class GetPropertyDetailsUseCase {
  constructor(
    private geoProvider: IGeoProvider,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: GetPropertyDetailsInput): Promise<PropertyInfo | null> {
    const property = await this.geoProvider.fetchPropertyInfo(input.designation);

    if (property) {
      // Always log access to property information for GDPR/Legal compliance
      await this.auditRepo.save({
        id: randomUUID(),
        timestamp: new Date(),
        userId: input.userId,
        action: AuditAction.ACCESS,
        entityType: 'Property',
        entityId: property.designation,
        details: `Property info accessed for ${property.designation}${input.projectId ? ` in project ${input.projectId}` : ''}`,
      });
    }

    return property;
  }
}
