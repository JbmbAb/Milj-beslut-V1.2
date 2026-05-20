import { GeoAssessment, RiskLevel, GeoLayerType } from '../domain/geo';
import { IGeoRepository } from '../domain/geo-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { AuditAction } from '../domain/audit';
import { randomUUID } from 'node:crypto';

export interface AnalyzeGeoRiskInput {
  projectId: string;
  layerType: GeoLayerType;
  userId: string;
}

export class AnalyzeGeoRiskUseCase {
  constructor(
    private geoRepo: IGeoRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: AnalyzeGeoRiskInput): Promise<GeoAssessment> {
    // Här skulle vi normalt anropa en extern GIS-tjänst (Lantmäteriet, SGU, etc.)
    // För denna Core-kärna simulerar vi en analys.
    const assessment: GeoAssessment = {
      id: randomUUID(),
      projectId: input.projectId,
      layerType: input.layerType,
      riskLevel: RiskLevel.MEDIUM, // Exempelvärde
      details: `Geografisk analys genomförd för lager ${input.layerType}`,
      assessedAt: new Date(),
    };

    const saved = await this.geoRepo.save(assessment);

    await this.auditRepo.save({
      id: randomUUID(),
      timestamp: new Date(),
      userId: input.userId,
      action: AuditAction.CREATE,
      entityType: 'GeoAssessment',
      entityId: saved.id,
      details: `Geo risk assessed for project ${input.projectId}`,
    });

    return saved;
  }
}
