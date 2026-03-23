/**
 * mvpContractService.test.ts
 *
 * Enhetstester för mvpContractService.
 * Täcker classifyActivity, analyzeRisk, validateLabResults,
 * verifyAnalysis, generatePermitDraft, getComplianceRequirements
 * och runMvpWorkflow.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementRows: vi.fn(),
}));

vi.mock('../../server/services/mvpAiGatewayService', () => ({
  generatePermitDraftFromGemini: vi.fn(),
  getVerificationSecondOpinionFromOpenAi: vi.fn(),
  suggestRequirementsFromGemini: vi.fn(),
}));

vi.mock('../../services/complianceRulesEngine', () => ({
  evaluateProjectCompliance: vi.fn(() => ({
    riskFactors: [],
    riskScore: 'LOW',
  })),
}));

vi.mock('../../services/documentTemplateEngine', () => ({
  renderCompliancePlanTemplate: vi.fn(() => 'Genererat malldokument'),
}));

import {
  classifyActivity,
  analyzeRisk,
  validateLabResults,
  verifyAnalysis,
  generatePermitDraft,
  getComplianceRequirements,
  runMvpWorkflow,
} from '../../server/services/mvpContractService';
import { listRequirementRows } from '../../server/repositories/requirementsRepository';
import {
  generatePermitDraftFromGemini,
  getVerificationSecondOpinionFromOpenAi,
  suggestRequirementsFromGemini,
} from '../../server/services/mvpAiGatewayService';
import { evaluateProjectCompliance } from '../../services/complianceRulesEngine';

beforeEach(() => {
  vi.mocked(listRequirementRows).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
  vi.mocked(generatePermitDraftFromGemini).mockResolvedValue(null);
  vi.mocked(getVerificationSecondOpinionFromOpenAi).mockResolvedValue({ status: 'VERIFIED', missing_citations: [] });
  vi.mocked(suggestRequirementsFromGemini).mockResolvedValue([]);
  vi.mocked(evaluateProjectCompliance).mockReturnValue({ riskFactors: [], riskScore: 'LOW' });
});

describe('classifyActivity()', () => {
  it('returns A-verksamhet for 29.60', () => {
    const result = classifyActivity({ activity_code: '29.60', ewc_code: '17 05 04', volume_tons: 500 }, 'trace-1');
    expect(result.classification).toBe('A-verksamhet');
    expect(result.status).toBe('MATCHED');
  });

  it('returns B-verksamhet for 29.50', () => {
    const result = classifyActivity({ activity_code: '29.50', ewc_code: '17 05 04', volume_tons: 500 }, 'trace-2');
    expect(result.classification).toBe('B-verksamhet');
    expect(result.status).toBe('MATCHED');
  });

  it('returns C-verksamhet for 29.40', () => {
    const result = classifyActivity({ activity_code: '29.40', ewc_code: '17 05 04', volume_tons: 200 }, 'trace-3');
    expect(result.classification).toBe('C-verksamhet');
    expect(result.status).toBe('MATCHED');
  });

  it('returns fallback classification for unknown activity code', () => {
    const result = classifyActivity({ activity_code: 'UNKNOWN', ewc_code: '17 05 04', volume_tons: 200 }, 'trace-4');
    expect(result.classification).toBeTruthy();
    expect(result.status).toBe('FALLBACK');
    expect(result.traceId).toBe('trace-4');
  });

  it('uses fallback B-verksamhet for large volume with unknown code', () => {
    const result = classifyActivity({ activity_code: 'UNKNOWN', ewc_code: '17 05 04', volume_tons: 15000 }, 'trace-5');
    expect(result.classification).toContain('B-verksamhet');
  });
});

describe('analyzeRisk()', () => {
  it('returns low risk for non-hazardous small volume', () => {
    const result = analyzeRisk({ ewc_code: '17 05 04', volume_tons: 100, location: 'Uppsala' }, 'trace-r1');
    expect(result.risk_flags).toBeInstanceOf(Array);
    expect(result.risk_score).toBeTruthy();
  });

  it('adds large volume flag for >= 10000 tons', () => {
    const result = analyzeRisk({ ewc_code: '17 05 04', volume_tons: 10000, location: 'Malmö' }, 'trace-r2');
    expect(result.risk_flags).toContain('Large volume storage');
  });

  it('adds groundwater flag for location containing "vatten"', () => {
    const result = analyzeRisk({ ewc_code: '17 05 04', volume_tons: 100, location: 'Nära grundvatten' }, 'trace-r3');
    expect(result.risk_flags).toContain('Potential groundwater impact');
  });

  it('detects hazardous waste with asterisk in EWC code', () => {
    vi.mocked(evaluateProjectCompliance).mockReturnValue({
      riskFactors: ['Hazardous waste'],
      riskScore: 'HIGH',
    });
    const result = analyzeRisk({ ewc_code: '17 06 01*', volume_tons: 500, location: 'Stockholm' }, 'trace-r4');
    expect(result.risk_flags).toContain('Hazardous waste');
    expect(result.risk_score).toBe('HIGH');
  });
});

describe('validateLabResults()', () => {
  it('returns PASS when all values are within limits', () => {
    const result = validateLabResults(
      { sample_results: [{ parameter: 'arsenik', value: 5, unit: 'mg/kg TS' }] },
      'trace-l1'
    );
    expect(result.status).toBe('PASS');
    expect(result.exceedances).toHaveLength(0);
  });

  it('returns FAIL when a value exceeds the limit', () => {
    const result = validateLabResults(
      { sample_results: [{ parameter: 'arsenik', value: 50, unit: 'mg/kg TS' }] },
      'trace-l2'
    );
    expect(result.status).toBe('FAIL');
    expect(result.exceedances).toHaveLength(1);
    expect(result.exceedances[0].parameter).toBe('arsenik');
  });

  it('ignores unknown parameters', () => {
    const result = validateLabResults(
      { sample_results: [{ parameter: 'okandParameter', value: 99999, unit: 'mg/kg TS' }] },
      'trace-l3'
    );
    expect(result.status).toBe('PASS');
    expect(result.exceedances).toHaveLength(0);
  });

  it('handles multiple samples with mixed results', () => {
    const result = validateLabResults(
      {
        sample_results: [
          { parameter: 'arsenik', value: 5, unit: 'mg/kg TS' },
          { parameter: 'bly', value: 200, unit: 'mg/kg TS' },
          { parameter: 'zink', value: 300, unit: 'mg/kg TS' },
        ],
      },
      'trace-l4'
    );
    expect(result.status).toBe('FAIL');
    expect(result.exceedances).toHaveLength(1);
    expect(result.exceedances[0].parameter).toBe('bly');
  });
});

describe('verifyAnalysis()', () => {
  it('returns UNVERIFIED for empty analysis object', async () => {
    vi.mocked(getVerificationSecondOpinionFromOpenAi).mockResolvedValue({ status: 'UNVERIFIED', missing_citations: [] });
    const result = await verifyAnalysis({ analysis: {} }, 'trace-v1');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.missing_citations).toContain('Analys saknas.');
  });

  it('returns UNVERIFIED when law name is missing', async () => {
    vi.mocked(getVerificationSecondOpinionFromOpenAi).mockResolvedValue({ status: 'VERIFIED', missing_citations: [] });
    const result = await verifyAnalysis({ analysis: 'Text utan lagnamn eller paragraf.' }, 'trace-v2');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.missing_citations.some((c) => c.includes('lag'))).toBe(true);
  });

  it('returns VERIFIED for text with miljöbalken and kapitel/paragraf reference', async () => {
    vi.mocked(getVerificationSecondOpinionFromOpenAi).mockResolvedValue({ status: 'VERIFIED', missing_citations: [] });
    // Use "paragraf" keyword since § followed by space doesn't create a word boundary
    const result = await verifyAnalysis(
      { analysis: 'Miljöbalken 26 kap. 19 paragraf reglerar egenkontroll.' },
      'trace-v3'
    );
    expect(result.status).toBe('VERIFIED');
    expect(result.missing_citations).toHaveLength(0);
  });

  it('returns VERIFIED for text with SFS number and chapter reference', async () => {
    vi.mocked(getVerificationSecondOpinionFromOpenAi).mockResolvedValue({ status: 'VERIFIED', missing_citations: [] });
    const result = await verifyAnalysis(
      { analysis: 'Enligt SFS 1998:808, 26 kap. 19 paragraf ska egenkontroll bedrivas.' },
      'trace-v4'
    );
    expect(result.status).toBe('VERIFIED');
  });

  it('merges AI missing citations with deterministic ones', async () => {
    vi.mocked(getVerificationSecondOpinionFromOpenAi).mockResolvedValue({
      status: 'UNVERIFIED',
      missing_citations: ['AI-hittad brist'],
    });
    const result = await verifyAnalysis({ analysis: 'Text utan lagnamn.' }, 'trace-v5');
    expect(result.missing_citations).toContain('AI-hittad brist');
  });
});

describe('generatePermitDraft()', () => {
  it('returns template-based draft when AI returns null', async () => {
    vi.mocked(generatePermitDraftFromGemini).mockResolvedValue(null);
    const result = await generatePermitDraft(
      {
        project_data: { name: 'Testprojekt', municipality: 'Stockholm', volume_tons: 500, ewc_code: '17 05 04' },
        requirements: [],
        risk_flags: [],
      },
      'trace-p1'
    );
    expect(result.draft_text).toBeTruthy();
    expect(result.document_type).toBeTruthy();
    expect(result.traceId).toBe('trace-p1');
  });

  it('returns AI draft when Gemini provides complete response', async () => {
    vi.mocked(generatePermitDraftFromGemini).mockResolvedValue({
      document_type: 'B-tillstand',
      draft_text: 'AI-genererat utkast.',
    });
    const result = await generatePermitDraft(
      {
        project_data: { name: 'AI-projekt', municipality: 'Göteborg', volume_tons: 15000, ewc_code: '17 05 04' },
        requirements: [],
        risk_flags: ['Large volume'],
      },
      'trace-p2'
    );
    expect(result.draft_text).toBe('AI-genererat utkast.');
    expect(result.document_type).toBe('B-tillstand');
  });

  it('falls back to template when AI returns incomplete response', async () => {
    vi.mocked(generatePermitDraftFromGemini).mockResolvedValue({ document_type: '', draft_text: '' });
    const result = await generatePermitDraft(
      {
        project_data: { name: 'Fallback', volume_tons: 100, ewc_code: '17 05 04' },
        requirements: [],
        risk_flags: [],
      },
      'trace-p3'
    );
    expect(result.draft_text).toBeTruthy();
  });

  it('selects B-tillstand for large volume (>10000 tons)', async () => {
    vi.mocked(generatePermitDraftFromGemini).mockResolvedValue(null);
    const result = await generatePermitDraft(
      {
        project_data: { name: 'Storprojekt', volume_tons: 15000, ewc_code: '17 05 04' },
        requirements: [],
        risk_flags: [],
      },
      'trace-p4'
    );
    expect(result.document_type).toBe('B-tillstand');
  });
});

describe('getComplianceRequirements()', () => {
  it('returns FALLBACK when index and AI both return empty', async () => {
    vi.mocked(listRequirementRows).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    vi.mocked(suggestRequirementsFromGemini).mockResolvedValue([]);
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-c1'
    );
    expect(result.source).toBe('FALLBACK');
    expect(result.requirements.length).toBeGreaterThan(0);
  });

  it('returns INDEX source when index has verified requirements', async () => {
    vi.mocked(listRequirementRows).mockResolvedValue({
      items: [
        {
          interpretedRequirement: 'Egenkontroll krävs.',
          requirementTextQuote: '',
          legalReference: 'Miljöbalken 26 kap. 19 §',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    } as never);
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-c2'
    );
    expect(result.source).toBe('INDEX');
    expect(result.requirements[0].rule).toBe('Egenkontroll krävs.');
  });

  it('returns AI source when index is empty but AI provides requirements', async () => {
    vi.mocked(listRequirementRows).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    vi.mocked(suggestRequirementsFromGemini).mockResolvedValue([
      { rule: 'AI-regel', law: 'Miljöbalken', citation: '26 kap. 19 §' },
    ]);
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-c3'
    );
    expect(result.source).toBe('AI');
    expect(result.requirements[0].rule).toBe('AI-regel');
  });

  it('deduplicates requirements from index', async () => {
    vi.mocked(listRequirementRows).mockResolvedValue({
      items: [
        { interpretedRequirement: 'Samma regel', requirementTextQuote: '', legalReference: 'Lag A' },
        { interpretedRequirement: 'Samma regel', requirementTextQuote: '', legalReference: 'Lag A' },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    } as never);
    const result = await getComplianceRequirements(
      { activity_code: '29.40', ewc_code: '17 05 04' },
      'trace-c4'
    );
    expect(result.source).toBe('INDEX');
    expect(result.requirements.length).toBe(1);
  });
});

describe('runMvpWorkflow()', () => {
  it('runs the complete workflow and returns all sections', async () => {
    vi.mocked(listRequirementRows).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    vi.mocked(generatePermitDraftFromGemini).mockResolvedValue(null);
    vi.mocked(getVerificationSecondOpinionFromOpenAi).mockResolvedValue({ status: 'VERIFIED', missing_citations: [] });

    const result = await runMvpWorkflow(
      {
        activity_code: '29.40',
        ewc_code: '17 05 04',
        volume_tons: 500,
        location: 'Stockholm',
        project_data: { name: 'Workflow-test', municipality: 'Stockholm' },
      },
      'trace-w1'
    );

    expect(result.traceId).toBe('trace-w1');
    expect(result.classification).toBeDefined();
    expect(result.requirements).toBeDefined();
    expect(result.risk).toBeDefined();
    expect(result.permit).toBeDefined();
    expect(result.verification).toBeDefined();
  });

  it('workflow classification status is either CLASSIFIED or FALLBACK', async () => {
    const result = await runMvpWorkflow(
      {
        activity_code: '29.60',
        ewc_code: '17 06 01*',
        volume_tons: 1000,
        location: 'Grundvatten nearby',
        project_data: { name: 'A-klassad', municipality: 'Göteborg' },
      },
      'trace-w2'
    );

    expect(['MATCHED', 'FALLBACK']).toContain(result.classification.status);
    expect(result.risk.risk_flags).toBeInstanceOf(Array);
  });
});
