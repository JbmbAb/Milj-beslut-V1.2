import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/services/mvpAiGatewayService', () => ({
  suggestRequirementsFromGemini: vi.fn(),
  generatePermitDraftFromGemini: vi.fn(),
  getVerificationSecondOpinionFromOpenAi: vi.fn(),
}));

vi.mock('../../services/complianceRulesEngine', () => ({
  evaluateProjectCompliance: vi.fn(),
}));

vi.mock('../../services/documentTemplateEngine', () => ({
  renderCompliancePlanTemplate: vi.fn(),
}));

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementRows: vi.fn(),
}));

import {
  classifyActivity,
  analyzeRisk,
  validateLabResults,
  getComplianceRequirements,
  verifyAnalysis,
  generatePermitDraft,
} from '../../server/services/mvpContractService';

import { evaluateProjectCompliance } from '../../services/complianceRulesEngine';
import { renderCompliancePlanTemplate } from '../../services/documentTemplateEngine';
import { listRequirementRows } from '../../server/repositories/requirementsRepository';
import {
  suggestRequirementsFromGemini,
  generatePermitDraftFromGemini,
  getVerificationSecondOpinionFromOpenAi,
} from '../../server/services/mvpAiGatewayService';

const mockEvaluate = vi.mocked(evaluateProjectCompliance);
const mockRenderTemplate = vi.mocked(renderCompliancePlanTemplate);
const mockListRequirements = vi.mocked(listRequirementRows);
const mockSuggestRequirements = vi.mocked(suggestRequirementsFromGemini);
const mockGeneratePermit = vi.mocked(generatePermitDraftFromGemini);
const mockVerification = vi.mocked(getVerificationSecondOpinionFromOpenAi);

const baseRuleResult = {
  riskScore: 'LOW' as const,
  riskFactors: [],
  requiresPermitOrNotification: 'NONE' as const,
  requirements: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockEvaluate.mockReturnValue(baseRuleResult);
  mockRenderTemplate.mockReturnValue('Rendered template text');
});

describe('classifyActivity', () => {
  it('returns MATCHED C-verksamhet for activity code 29.40', () => {
    const result = classifyActivity(
      { activity_code: '29.40', ewc_code: '17 05 04', volume_tons: 500 },
      'trace-1',
    );
    expect(result.status).toBe('MATCHED');
    expect(result.classification).toBe('C-verksamhet');
    expect(result.traceId).toBe('trace-1');
    expect(result.ewc_code).toBe('17 05 04');
  });

  it('returns MATCHED B-verksamhet for activity code 29.50', () => {
    const result = classifyActivity(
      { activity_code: '29.50', ewc_code: '', volume_tons: 100 },
      'trace-2',
    );
    expect(result.status).toBe('MATCHED');
    expect(result.classification).toBe('B-verksamhet');
  });

  it('returns MATCHED A-verksamhet for activity code 29.60', () => {
    const result = classifyActivity(
      { activity_code: '29.60', ewc_code: '', volume_tons: 50 },
      'trace-3',
    );
    expect(result.status).toBe('MATCHED');
    expect(result.classification).toBe('A-verksamhet');
  });

  it('falls back to B-verksamhet when volume > 10000 and code unknown', () => {
    const result = classifyActivity(
      { activity_code: 'UNKNOWN', ewc_code: '', volume_tons: 15000 },
      'trace-4',
    );
    expect(result.status).toBe('FALLBACK');
    expect(result.classification).toBe('B-verksamhet');
    expect(result.volume_tons).toBe(15000);
  });

  it('falls back to C-verksamhet when volume <= 10000 and code unknown', () => {
    const result = classifyActivity(
      { activity_code: 'UNKNOWN', ewc_code: '', volume_tons: 500 },
      'trace-5',
    );
    expect(result.status).toBe('FALLBACK');
    expect(result.classification).toBe('C-verksamhet');
  });
});

describe('analyzeRisk', () => {
  it('detects hazardous waste via ewc_code with asterisk', () => {
    mockEvaluate.mockReturnValue({ ...baseRuleResult, riskScore: 'HIGH', riskFactors: ['Hazardous waste'] });
    const result = analyzeRisk({ ewc_code: '15 02 02*', volume_tons: 100, location: 'Stockholm' }, 'trace-6');
    expect(result.risk_score).toBe('HIGH');
    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ hazardousClassification: true }),
    );
  });

  it('detects hazardous waste via 17 09 prefix', () => {
    const result = analyzeRisk({ ewc_code: '17 09 04', volume_tons: 50, location: '' }, 'trace-7');
    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ hazardousClassification: true }),
    );
  });

  it('adds "Large volume storage" flag when volume >= 10000', () => {
    const result = analyzeRisk({ ewc_code: '17 05 04', volume_tons: 10000, location: '' }, 'trace-8');
    expect(result.risk_flags).toContain('Large volume storage');
  });

  it('does not add large volume flag when volume < 10000', () => {
    const result = analyzeRisk({ ewc_code: '17 05 04', volume_tons: 9999, location: '' }, 'trace-9');
    expect(result.risk_flags).not.toContain('Large volume storage');
  });

  it('adds groundwater flag when location contains "vatten"', () => {
    const result = analyzeRisk({ ewc_code: '17 05 04', volume_tons: 100, location: 'Nära grundvatten' }, 'trace-10');
    expect(result.risk_flags).toContain('Potential groundwater impact');
    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ groundwaterProximity: true }),
    );
  });

  it('adds groundwater flag when location contains "brunn"', () => {
    const result = analyzeRisk({ ewc_code: '17 05 04', volume_tons: 100, location: 'Nära en brunn' }, 'trace-11');
    expect(result.risk_flags).toContain('Potential groundwater impact');
  });

  it('deduplicates risk flags from rule engine and additions', () => {
    mockEvaluate.mockReturnValue({ ...baseRuleResult, riskFlags: ['Large volume storage'] } as any);
    const result = analyzeRisk({ ewc_code: '17 05 04', volume_tons: 10000, location: '' }, 'trace-12');
    const unique = new Set(result.risk_flags);
    expect(unique.size).toBe(result.risk_flags.length);
  });
});

describe('validateLabResults', () => {
  it('returns PASS when all sample values are within limits', () => {
    const result = validateLabResults(
      { sample_results: [{ parameter: 'arsenik', value: 5, unit: 'mg/kg TS' }] },
      'trace-13',
    );
    expect(result.status).toBe('PASS');
    expect(result.exceedances).toHaveLength(0);
  });

  it('returns FAIL and reports exceedance when value exceeds limit', () => {
    const result = validateLabResults(
      { sample_results: [{ parameter: 'bly', value: 100, unit: 'mg/kg TS' }] },
      'trace-14',
    );
    expect(result.status).toBe('FAIL');
    expect(result.exceedances).toHaveLength(1);
    expect(result.exceedances[0].parameter).toBe('bly');
    expect(result.exceedances[0].limit).toBe(80);
    expect(result.exceedances[0].value).toBe(100);
  });

  it('ignores unknown parameters without failing', () => {
    const result = validateLabResults(
      { sample_results: [{ parameter: 'okant_amne', value: 9999, unit: 'mg/kg TS' }] },
      'trace-15',
    );
    expect(result.status).toBe('PASS');
    expect(result.exceedances).toHaveLength(0);
  });

  it('handles multiple samples and reports all exceedances', () => {
    const result = validateLabResults(
      {
        sample_results: [
          { parameter: 'arsenik', value: 20, unit: 'mg/kg TS' },
          { parameter: 'kadmium', value: 0.5, unit: 'mg/kg TS' },
          { parameter: 'kvicksilver', value: 1.0, unit: 'mg/kg TS' },
        ],
      },
      'trace-16',
    );
    expect(result.status).toBe('FAIL');
    expect(result.exceedances).toHaveLength(2);
  });

  it('value exactly at limit passes', () => {
    const result = validateLabResults(
      { sample_results: [{ parameter: 'arsenik', value: 10, unit: 'mg/kg TS' }] },
      'trace-17',
    );
    expect(result.status).toBe('PASS');
  });
});

describe('getComplianceRequirements', () => {
  it('returns FALLBACK when no org and Gemini returns null', async () => {
    mockSuggestRequirements.mockResolvedValue(null);
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-18',
    );
    expect(result.source).toBe('FALLBACK');
    expect(result.requirements.length).toBeGreaterThan(0);
    expect(result.traceId).toBe('trace-18');
  });

  it('returns AI requirements when Gemini provides them', async () => {
    mockSuggestRequirements.mockResolvedValue([
      { rule: 'AI rule text', law: 'Miljöbalken', citation: '26 kap. 19 §' },
    ]);
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-19',
    );
    expect(result.source).toBe('AI');
    expect(result.requirements[0].rule).toBe('AI rule text');
  });

  it('returns INDEX requirements when organisationId provided and index has items', async () => {
    mockListRequirements.mockResolvedValue({
      items: [
        {
          interpretedRequirement: 'Index rule text',
          legalReference: '26 kap. 1 §',
          requirementTextQuote: '',
          id: 'r-1',
        } as any,
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-20',
      'org-123',
    );
    expect(result.source).toBe('INDEX');
    expect(result.requirements[0].rule).toBe('Index rule text');
  });

  it('falls back to AI when org index returns empty items', async () => {
    mockListRequirements.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    mockSuggestRequirements.mockResolvedValue([
      { rule: 'Fallback AI rule', law: 'Avfallsförordningen', citation: '2 kap. 1 §' },
    ]);
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-21',
      'org-empty',
    );
    expect(result.source).toBe('AI');
  });

  it('deduplicates requirements with identical rule+law+citation', async () => {
    const dup = { rule: 'Dup rule', law: 'Lagen', citation: '1 §' };
    mockSuggestRequirements.mockResolvedValue([dup, dup]);
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-22',
    );
    expect(result.requirements).toHaveLength(1);
  });
});

describe('verifyAnalysis', () => {
  it('marks UNVERIFIED and adds message when analysis is empty', async () => {
    mockVerification.mockResolvedValue({ status: 'UNVERIFIED', missing_citations: [] });
    const result = await verifyAnalysis({ analysis: '' }, 'trace-23');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.missing_citations).toContain('Analys saknas.');
  });

  it('marks UNVERIFIED when law name is absent', async () => {
    mockVerification.mockResolvedValue({ status: 'UNVERIFIED', missing_citations: [] });
    const result = await verifyAnalysis({ analysis: 'Verksamheten bedrivs korrekt' }, 'trace-24');
    expect(result.missing_citations).toContain(
      'Saknar lag- eller forordningsnamn (eller SFS-nummer).',
    );
  });

  it('marks VERIFIED when text has law name and chapter/paragraph reference', async () => {
    mockVerification.mockResolvedValue({ status: 'VERIFIED', missing_citations: [] });
    // Use "paragraf" form: the regex requires a word-char after the citation keyword to satisfy \b
    const analysis = 'Enligt Miljöbalken 26 kap. 19 paragraf ska egenkontroll utföras.';
    const result = await verifyAnalysis({ analysis }, 'trace-25');
    expect(result.status).toBe('VERIFIED');
    expect(result.missing_citations).toHaveLength(0);
  });

  it('merges AI missing citations with deterministic ones', async () => {
    mockVerification.mockResolvedValue({
      status: 'UNVERIFIED',
      missing_citations: ['AI: Saknar SFS-nummer'],
    });
    const result = await verifyAnalysis({ analysis: 'Ingen lagtext här alls' }, 'trace-26');
    expect(result.missing_citations).toContain('AI: Saknar SFS-nummer');
    expect(result.missing_citations.length).toBeGreaterThan(1);
  });

  it('deduplicates citations appearing in both AI and deterministic lists', async () => {
    const duplicated = 'Saknar lag- eller forordningsnamn (eller SFS-nummer).';
    mockVerification.mockResolvedValue({ status: 'UNVERIFIED', missing_citations: [duplicated] });
    const result = await verifyAnalysis({ analysis: 'Ingen text' }, 'trace-27');
    const count = result.missing_citations.filter((c) => c === duplicated).length;
    expect(count).toBe(1);
  });
});

describe('generatePermitDraft', () => {
  const baseInput = {
    project_data: {
      name: 'Test Project',
      municipality: 'Malmö',
      volume_tons: 500,
      ewc_code: '17 05 04',
      classification: 'C-verksamhet',
    },
    requirements: [{ rule: 'Rule 1', law: 'Miljöbalken', citation: '26 kap. 19 §' }],
    risk_flags: [],
  };

  it('returns AI draft when Gemini provides a valid response', async () => {
    mockGeneratePermit.mockResolvedValue({ document_type: 'B-tillstand', draft_text: 'AI draft text' });
    const result = await generatePermitDraft(baseInput, 'trace-28');
    expect(result.document_type).toBe('B-tillstand');
    expect(result.draft_text).toBe('AI draft text');
    expect(result.traceId).toBe('trace-28');
  });

  it('falls back to template when Gemini returns null', async () => {
    mockGeneratePermit.mockResolvedValue(null);
    const result = await generatePermitDraft(baseInput, 'trace-29');
    expect(result.draft_text).toContain('Rendered template text');
    expect(result.document_type).toBe('C-anmalan');
  });

  it('falls back to template when Gemini returns incomplete object', async () => {
    mockGeneratePermit.mockResolvedValue({ document_type: '', draft_text: '' });
    const result = await generatePermitDraft(baseInput, 'trace-30');
    expect(result.draft_text).toContain('Rendered template text');
  });

  it('chooses B-tillstand document type when volume > 10000', async () => {
    mockGeneratePermit.mockResolvedValue(null);
    const result = await generatePermitDraft(
      { ...baseInput, project_data: { ...baseInput.project_data, volume_tons: 15000 } },
      'trace-31',
    );
    expect(result.document_type).toBe('B-tillstand');
  });

  it('includes requirements appendix in fallback draft', async () => {
    mockGeneratePermit.mockResolvedValue(null);
    mockRenderTemplate.mockReturnValue('Template base');
    const result = await generatePermitDraft(baseInput, 'trace-32');
    expect(result.draft_text).toContain('JURIDISKA KRAV');
    expect(result.draft_text).toContain('Rule 1');
  });
});
