import { describe, expect, it, vi } from 'vitest';

import { AnalyzeDocumentAIUseCase } from '../../src/application/analyze-document-ai.usecase';
import { AnalyzeGeoRiskUseCase } from '../../src/application/analyze-geo-risk.usecase';
import { RegisterTransportUseCase } from '../../src/application/register-transport.usecase';
import { AuditAction } from '../../src/domain/audit';
import { GeoLayerType, RiskLevel } from '../../src/domain/geo';
import { TransportStatus } from '../../src/domain/logistics';

describe('src application remaining use cases', () => {
  it('analyzes a document with AI, saves requirements and audits each extracted item', async () => {
    const aiService = {
      extractRequirements: vi.fn().mockResolvedValue([
        { code: 'AI-1', text: 'Första kravet', level: 'MANDATORY' },
        { code: 'AI-2', text: 'Andra kravet', level: 'RECOMMENDED' },
      ]),
    };
    const requirementRepo = {
      save: vi.fn(async (requirement) => requirement),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };

    const useCase = new AnalyzeDocumentAIUseCase(aiService as any, requirementRepo as any, auditRepo as any);
    const result = await useCase.execute({
      documentId: 'doc-1',
      documentText: 'Kravtext',
      userId: 'user-1',
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      code: 'AI-1',
      category: 'AI_EXTRACTED',
      sourceDocumentId: 'doc-1',
    });
    expect(requirementRepo.save).toHaveBeenCalledTimes(2);
    expect(auditRepo.save).toHaveBeenCalledTimes(2);
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CREATE,
        entityType: 'Requirement',
      }),
    );
  });

  it('creates a geo risk assessment and audits it', async () => {
    const geoRepo = {
      save: vi.fn(async (assessment) => assessment),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };

    const useCase = new AnalyzeGeoRiskUseCase(geoRepo as any, auditRepo as any);
    const result = await useCase.execute({
      projectId: 'project-1',
      layerType: GeoLayerType.FLOOD_RISK,
      userId: 'user-1',
    });

    expect(result.layerType).toBe(GeoLayerType.FLOOD_RISK);
    expect(result.riskLevel).toBe(RiskLevel.MEDIUM);
    expect(geoRepo.save).toHaveBeenCalledOnce();
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'GeoAssessment',
        action: AuditAction.CREATE,
        entityId: result.id,
      }),
    );
  });

  it('registers a planned transport booking and audits it', async () => {
    const logisticsRepo = {
      saveBooking: vi.fn(async (booking) => booking),
    };
    const auditRepo = {
      save: vi.fn(async (event) => event),
    };

    const useCase = new RegisterTransportUseCase(logisticsRepo as any, auditRepo as any);
    const plannedDate = new Date('2026-04-03T09:00:00.000Z');
    const result = await useCase.execute({
      projectId: 'project-1',
      wasteCode: '17 05 04',
      tons: 12,
      plannedDate,
      userId: 'user-1',
    });

    expect(result.status).toBe(TransportStatus.PLANNED);
    expect(result.plannedDate).toBe(plannedDate);
    expect(logisticsRepo.saveBooking).toHaveBeenCalledOnce();
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'TransportBooking',
        action: AuditAction.CREATE,
        entityId: result.id,
      }),
    );
  });
});
