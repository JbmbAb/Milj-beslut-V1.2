import { z } from 'zod';
import { IGeoProvider, IGeoRepository } from '../domain/geo-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { GetPropertyDetailsUseCase } from '../application/get-property-details.usecase';

export const PropertyLookupSchema = z.object({
  designation: z.string().min(3),
  projectId: z.string().optional(),
});

export class GeoController {
  private getPropertyUseCase: GetPropertyDetailsUseCase;

  constructor(
    private geoProvider: IGeoProvider,
    private geoRepo: IGeoRepository,
    private auditRepo: IAuditRepository,
  ) {
    this.getPropertyUseCase = new GetPropertyDetailsUseCase(geoProvider, auditRepo);
  }

  async getProperty(data: unknown, userId: string) {
    const validated = PropertyLookupSchema.parse(data);
    return await this.getPropertyUseCase.execute({
      designation: validated.designation,
      projectId: validated.projectId,
      userId,
    });
  }

  async getProjectAssessments(projectId: string) {
    return await this.geoRepo.findByProject(projectId);
  }
}
