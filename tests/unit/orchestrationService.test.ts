import { describe, expect, it, vi } from 'vitest';
import { runComplianceWorkflow } from '../../services/orchestrationService';
import * as geminiService from '../../services/geminiService';
import * as complianceRulesEngine from '../../services/complianceRulesEngine';

vi.mock('../../services/geminiService', () => ({
  validateLabData: vi.fn(),
  analyzeLogisticsCompliance: vi.fn(),
}));

vi.mock('../../services/complianceRulesEngine', () => ({
  evaluateProjectCompliance: vi.fn(),
}));

describe('orchestrationService', () => {
  it('runs the full compliance workflow', async () => {
    vi.mocked(geminiService.validateLabData).mockResolvedValue({
      status: 'FAIL',
      parameters_exceeding_limits: ['Pb'],
      applicable_guidelines: 'Naturvårdsverket',
      environmental_risk_level: 'high',
    });

    vi.mocked(complianceRulesEngine.evaluateProjectCompliance).mockReturnValue({
      riskScore: 'HIGH',
      riskFactors: ['Farligt avfall (HW) identifierat.'],
      requiresPermitOrNotification: 'PERMIT',
      requirements: [],
    });

    const req = {
      wasteCode: '17 05 03*',
      volumeTons: 500,
      hazardousClassification: true,
      groundwaterProximity: false,
      missingDocumentation: false,
      labData: 'Pb: 100',
      storageDuration: '10 days',
      location: 'Site A',
      receivingFacility: 'Facility B',
    };

    const res = await runComplianceWorkflow(req);

    expect(res.labValidationResult?.status).toBe('FAIL');
    expect(res.complianceScore.riskScore).toBe('HIGH');
  });
});
