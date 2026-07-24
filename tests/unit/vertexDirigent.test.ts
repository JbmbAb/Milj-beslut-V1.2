import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  runComplianceWorkflowWithToolTrace,
  type OrchestrationRequest,
} from '../../services/orchestrationService';
import { toolTraceContentHash, summarizeVerifiedToolTrace } from '../../server/services/vertexDirigent';
import {
  evaluateProjectCompliance,
  type ComplianceMetrics,
} from '../../server/services/complianceRuleEngine';

vi.mock('../../services/geminiService', () => ({
  validateLabData: vi.fn(),
  analyzeLogisticsCompliance: vi.fn(),
}));

import * as geminiService from '../../services/geminiService';

const mockValidateLab = vi.mocked(geminiService.validateLabData);
const mockAnalyzeLogistics = vi.mocked(geminiService.analyzeLogisticsCompliance);

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

function labPass() {
  return {
    status: 'PASS' as const,
    parameters_exceeding_limits: [] as string[],
    applicable_guidelines: 'NFS 2006:9',
    environmental_risk_level: 'low' as const,
  };
}

function logistics() {
  return {
    storage_compliance: 'OK',
    transport_requirements: [] as string[],
    environmental_risks: [] as string[],
    recommended_actions: [] as string[],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERTEX_PROJECT_ID', '');
  mockValidateLab.mockResolvedValue(labPass());
  mockAnalyzeLogistics.mockResolvedValue(logistics());
});

describe('bevis: toolTrace = källa, inte LLM', () => {
  it('runComplianceWorkflowWithToolTrace: rule_engine_evaluate output matchar direkt evaluateProjectCompliance (samma metrics)', async () => {
    const req = baseRequest();
    const result = await runComplianceWorkflowWithToolTrace(req);
    const labN = result.labValidationResult?.parameters_exceeding_limits?.length ?? 0;
    const metrics: ComplianceMetrics = {
      volumeTons: req.volumeTons,
      hazardousClassification: req.hazardousClassification,
      groundwaterProximity: req.groundwaterProximity,
      missingDocumentation: req.missingDocumentation,
      labExceedancesCount: labN,
    };
    const direct = evaluateProjectCompliance(metrics);
    const fromTrace = result.toolTrace.find((t) => t.toolId === 'rule_engine_evaluate')?.output;
    expect(fromTrace).toEqual(direct);
    expect(result.complianceScore).toEqual(direct);
  });

  it('tre verktyg i ordning; innehålls-hash stabil för samma spår', async () => {
    const r = await runComplianceWorkflowWithToolTrace(baseRequest());
    expect(r.toolTrace.map((t) => t.toolId)).toEqual([
      'lab_validate',
      'rule_engine_evaluate',
      'logistics_analyze',
    ]);
    const h1 = toolTraceContentHash(r.toolTrace);
    const h2 = toolTraceContentHash(r.toolTrace);
    expect(h1).toBe(h2);
  });

  it('summarizeVerifiedToolTrace utan Vertex lämnar riskScore synlig oförändrad från spåret (ingen hallucination yta)', async () => {
    const r = await runComplianceWorkflowWithToolTrace(baseRequest({ volumeTons: 500 }));
    const text = await summarizeVerifiedToolTrace(r.toolTrace);
    const rule = r.toolTrace.find((t) => t.toolId === 'rule_engine_evaluate')?.output as {
      riskScore: string;
    };
    expect(text).toContain('rule_engine riskScore: ' + rule.riskScore);
    expect(text).toContain('[offline/utan Vertex]');
  });
});
