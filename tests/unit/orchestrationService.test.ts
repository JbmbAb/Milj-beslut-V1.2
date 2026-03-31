import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runComplianceWorkflow, type OrchestrationRequest } from '../../services/orchestrationService';

// ─── mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../services/geminiService', () => ({
  validateLabData: vi.fn(),
  analyzeLogisticsCompliance: vi.fn(),
}));

import * as geminiService from '../../services/geminiService';

const mockValidateLab = vi.mocked(geminiService.validateLabData);
const mockAnalyzeLogistics = vi.mocked(geminiService.analyzeLogisticsCompliance);

// ─── helpers ─────────────────────────────────────────────────────────────────

function baseRequest(overrides: Partial<OrchestrationRequest> = {}): OrchestrationRequest {
  return {
    wasteCode: '17 05 04*',
    volumeTons: 50,
    hazardousClassification: false,
    groundwaterProximity: false,
    missingDocumentation: false,
    labData: '{}',
    storageDuration: '30 days',
    location: 'Solna',
    receivingFacility: 'Stena Recycling',
    ...overrides,
  };
}

function labPassResult() {
  return {
    status: 'PASS' as const,
    parameters_exceeding_limits: [],
    applicable_guidelines: 'NFS 2006:9',
    environmental_risk_level: 'low' as const,
  };
}

function logisticsResult() {
  return {
    storage_compliance: 'OK',
    transport_requirements: ['ADR-märkning'],
    environmental_risks: [],
    recommended_actions: [],
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateLab.mockResolvedValue(labPassResult());
  mockAnalyzeLogistics.mockResolvedValue(logisticsResult());
});

describe('runComplianceWorkflow – happy path', () => {
  it('returns a result with all four expected keys', async () => {
    const result = await runComplianceWorkflow(baseRequest());
    expect(result).toHaveProperty('complianceScore');
    expect(result).toHaveProperty('labValidationResult');
    expect(result).toHaveProperty('logisticsAnalysis');
    expect(result).toHaveProperty('explainability');
  });

  it('passes labData to validateLabData', async () => {
    await runComplianceWorkflow(baseRequest({ labData: 'myLabData' }));
    expect(mockValidateLab).toHaveBeenCalledWith('myLabData');
  });

  it('passes correct logistics fields to analyzeLogisticsCompliance', async () => {
    await runComplianceWorkflow(
      baseRequest({
        wasteCode: '20 01 27*',
        volumeTons: 100,
        storageDuration: '14 days',
        location: 'Göteborg',
        receivingFacility: 'SAKAB',
      }),
    );
    expect(mockAnalyzeLogistics).toHaveBeenCalledWith(
      expect.objectContaining({
        wasteCode: '20 01 27*',
        volume: '100',
        storageDuration: '14 days',
        location: 'Göteborg',
        receivingFacility: 'SAKAB',
      }),
    );
  });

  it('populates explainability with 4 log entries', async () => {
    const result = await runComplianceWorkflow(baseRequest());
    expect(result.explainability).toHaveLength(4);
  });

  it('explainability contains volume and waste code', async () => {
    const result = await runComplianceWorkflow(baseRequest({ volumeTons: 250, wasteCode: '17 05 04*' }));
    expect(result.explainability[0]).toContain('250');
    expect(result.explainability[0]).toContain('17 05 04*');
  });
});

describe('runComplianceWorkflow – lab exceedances influence risk', () => {
  it('increases labExceedancesCount when lab returns failing params', async () => {
    mockValidateLab.mockResolvedValue({
      ...labPassResult(),
      status: 'FAIL',
      parameters_exceeding_limits: ['arsenik', 'bly', 'kadmium'],
    });
    const result = await runComplianceWorkflow(baseRequest());
    // 4 points for lab exceedances → rawScore 4 → MEDIUM
    expect(result.complianceScore.riskScore).toBe('MEDIUM');
  });

  it('labValidationResult is passed through unchanged', async () => {
    const lab = { ...labPassResult(), status: 'UNKNOWN' as const };
    mockValidateLab.mockResolvedValue(lab);
    const result = await runComplianceWorkflow(baseRequest());
    expect(result.labValidationResult).toEqual(lab);
  });
});

describe('runComplianceWorkflow – null guard (AI returns null)', () => {
  it('handles validateLabData returning null without crashing', async () => {
    mockValidateLab.mockResolvedValue(null as any);
    const result = await runComplianceWorkflow(baseRequest());
    expect(result.labValidationResult).toBeNull();
    expect(result.complianceScore.riskScore).toBe('LOW');
  });

  it('handles analyzeLogisticsCompliance returning null', async () => {
    mockAnalyzeLogistics.mockResolvedValue(null as any);
    const result = await runComplianceWorkflow(baseRequest());
    expect(result.logisticsAnalysis).toBeNull();
  });
});

describe('runComplianceWorkflow – rule engine integration', () => {
  it('hazardous classification triggers PERMIT', async () => {
    const result = await runComplianceWorkflow(baseRequest({ hazardousClassification: true }));
    expect(result.complianceScore.requiresPermitOrNotification).toBe('PERMIT');
  });

  it('volume > 10 000 tons triggers PERMIT', async () => {
    const result = await runComplianceWorkflow(baseRequest({ volumeTons: 15000 }));
    expect(result.complianceScore.requiresPermitOrNotification).toBe('PERMIT');
  });

  it('logisticsAnalysis is passed through unchanged', async () => {
    const logistics = { ...logisticsResult(), storage_compliance: 'NOK' };
    mockAnalyzeLogistics.mockResolvedValue(logistics);
    const result = await runComplianceWorkflow(baseRequest());
    expect(result.logisticsAnalysis).toEqual(logistics);
  });
});
