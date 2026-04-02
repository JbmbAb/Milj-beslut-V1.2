import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  classifyActivity as ClassifyActivity,
  analyzeRisk as AnalyzeRisk,
  validateLabResults as ValidateLabResults,
  getComplianceRequirements as GetComplianceRequirements,
  generatePermitDraft as GeneratePermitDraft,
  verifyAnalysis as VerifyAnalysis,
} from '../../server/services/mvpContractService';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listRequirementRows: vi.fn(),
  evaluateProjectCompliance: vi.fn(),
  renderCompliancePlanTemplate: vi.fn(),
  suggestRequirementsFromGemini: vi.fn(),
  generatePermitDraftFromGemini: vi.fn(),
  getVerificationSecondOpinionFromOpenAi: vi.fn(),
}));

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementRows: mocks.listRequirementRows,
}));

vi.mock('../../server/services/complianceRuleEngine', () => ({
  evaluateProjectCompliance: mocks.evaluateProjectCompliance,
}));

vi.mock('../../services/documentTemplateEngine', () => ({
  renderCompliancePlanTemplate: mocks.renderCompliancePlanTemplate,
}));

vi.mock('../../server/services/mvpAiGatewayService', () => ({
  suggestRequirementsFromGemini: mocks.suggestRequirementsFromGemini,
  generatePermitDraftFromGemini: mocks.generatePermitDraftFromGemini,
  getVerificationSecondOpinionFromOpenAi: mocks.getVerificationSecondOpinionFromOpenAi,
}));

// ─── Re-import helpers ────────────────────────────────────────────────────────

type ContractService = {
  classifyActivity: typeof ClassifyActivity;
  analyzeRisk: typeof AnalyzeRisk;
  validateLabResults: typeof ValidateLabResults;
  getComplianceRequirements: typeof GetComplianceRequirements;
  generatePermitDraft: typeof GeneratePermitDraft;
  verifyAnalysis: typeof VerifyAnalysis;
};

let svc: ContractService;

async function loadService() {
  vi.resetModules();
  svc = (await import('../../server/services/mvpContractService')) as unknown as ContractService;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mvpContractService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await loadService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── classifyActivity ────────────────────────────────────────────────────────
  describe('classifyActivity', () => {
    it('returns MATCHED result for known activity code 29.40', () => {
      const result = svc.classifyActivity(
        { activity_code: '29.40', ewc_code: '17 05 04', volume_tons: 100 },
        'trace-1',
      );
      expect(result.status).toBe('MATCHED');
      expect(result.classification).toBe('C-verksamhet');
      expect(result.traceId).toBe('trace-1');
    });

    it('returns MATCHED result for known activity code 29.50', () => {
      const result = svc.classifyActivity(
        { activity_code: '29.50', ewc_code: '17 05 04', volume_tons: 500 },
        'trace-2',
      );
      expect(result.status).toBe('MATCHED');
      expect(result.classification).toBe('B-verksamhet');
    });

    it('returns MATCHED result for known activity code 29.60', () => {
      const result = svc.classifyActivity(
        { activity_code: '29.60', ewc_code: '17 05 04', volume_tons: 2000 },
        'trace-3',
      );
      expect(result.status).toBe('MATCHED');
      expect(result.classification).toBe('A-verksamhet');
    });

    it('returns FALLBACK B-verksamhet for unknown code with volume > 10000', () => {
      const result = svc.classifyActivity(
        { activity_code: '99.99', ewc_code: '', volume_tons: 15000 },
        'trace-4',
      );
      expect(result.status).toBe('FALLBACK');
      expect(result.classification).toBe('B-verksamhet');
    });

    it('returns FALLBACK C-verksamhet for unknown code with volume <= 10000', () => {
      const result = svc.classifyActivity(
        { activity_code: '00.00', ewc_code: '', volume_tons: 50 },
        'trace-5',
      );
      expect(result.status).toBe('FALLBACK');
      expect(result.classification).toBe('C-verksamhet');
    });

    it('preserves ewc_code and volume_tons in result', () => {
      const result = svc.classifyActivity(
        { activity_code: '29.40', ewc_code: '17 05 04', volume_tons: 42 },
        'trace-6',
      );
      expect(result.ewc_code).toBe('17 05 04');
      expect(result.volume_tons).toBe(42);
    });
  });

  // ── analyzeRisk ─────────────────────────────────────────────────────────────
  describe('analyzeRisk', () => {
    beforeEach(() => {
      mocks.evaluateProjectCompliance.mockReturnValue({
        riskScore: 'LOW',
        riskFactors: [],
      });
    });

    it('calls evaluateProjectCompliance with correct parameters', () => {
      svc.analyzeRisk({ ewc_code: '17 05 04', volume_tons: 100, location: 'inland' }, 'trace-r1');
      expect(mocks.evaluateProjectCompliance).toHaveBeenCalledWith(
        expect.objectContaining({
          volumeTons: 100,
          hazardousClassification: false,
          groundwaterProximity: false,
        }),
      );
    });

    it('detects hazardous waste via asterisk in ewc_code', () => {
      mocks.evaluateProjectCompliance.mockReturnValue({
        riskScore: 'HIGH',
        riskFactors: ['Hazardous waste'],
      });
      const result = svc.analyzeRisk({ ewc_code: '17 09 04 *', volume_tons: 100, location: '' }, 'trace-r2');
      expect(mocks.evaluateProjectCompliance).toHaveBeenCalledWith(
        expect.objectContaining({ hazardousClassification: true }),
      );
      expect(result.risk_score).toBe('HIGH');
    });

    it('detects groundwater proximity from location text', () => {
      svc.analyzeRisk({ ewc_code: '17 05 04', volume_tons: 100, location: 'nära grundvatten' }, 'trace-r3');
      expect(mocks.evaluateProjectCompliance).toHaveBeenCalledWith(
        expect.objectContaining({ groundwaterProximity: true }),
      );
    });

    it('adds "Large volume storage" flag for volume >= 10000', () => {
      mocks.evaluateProjectCompliance.mockReturnValue({ riskScore: 'MEDIUM', riskFactors: [] });
      const result = svc.analyzeRisk({ ewc_code: '17 05 04', volume_tons: 10000, location: '' }, 'trace-r4');
      expect(result.risk_flags).toContain('Large volume storage');
    });

    it('does NOT add "Large volume storage" for volume < 10000', () => {
      mocks.evaluateProjectCompliance.mockReturnValue({ riskScore: 'LOW', riskFactors: [] });
      const result = svc.analyzeRisk({ ewc_code: '17 05 04', volume_tons: 9999, location: '' }, 'trace-r5');
      expect(result.risk_flags).not.toContain('Large volume storage');
    });

    it('adds "Potential groundwater impact" flag when near groundwater', () => {
      mocks.evaluateProjectCompliance.mockReturnValue({ riskScore: 'MEDIUM', riskFactors: [] });
      const result = svc.analyzeRisk(
        { ewc_code: '17 05 04', volume_tons: 100, location: 'brunn nära' },
        'trace-r6',
      );
      expect(result.risk_flags).toContain('Potential groundwater impact');
    });

    it('deduplicates risk flags from baseline and analysis', () => {
      mocks.evaluateProjectCompliance.mockReturnValue({
        riskScore: 'HIGH',
        riskFactors: ['Potential groundwater impact'],
      });
      const result = svc.analyzeRisk(
        { ewc_code: '17 05 04', volume_tons: 100, location: 'vatten' },
        'trace-r7',
      );
      const gwFlags = result.risk_flags.filter((f) => f === 'Potential groundwater impact');
      expect(gwFlags).toHaveLength(1);
    });

    it('includes traceId in result', () => {
      const result = svc.analyzeRisk({ ewc_code: '17 05 04', volume_tons: 50, location: '' }, 'my-trace');
      expect(result.traceId).toBe('my-trace');
    });
  });

  // ── validateLabResults ──────────────────────────────────────────────────────
  describe('validateLabResults', () => {
    it('returns PASS when all samples are within limits', () => {
      const result = svc.validateLabResults(
        { sample_results: [{ parameter: 'arsenik', value: 5, unit: 'mg/kg TS' }] },
        'trace-l1',
      );
      expect(result.status).toBe('PASS');
      expect(result.exceedances).toHaveLength(0);
    });

    it('returns FAIL when a sample exceeds its limit', () => {
      const result = svc.validateLabResults(
        { sample_results: [{ parameter: 'arsenik', value: 15, unit: 'mg/kg TS' }] },
        'trace-l2',
      );
      expect(result.status).toBe('FAIL');
      expect(result.exceedances).toHaveLength(1);
      expect(result.exceedances[0].parameter).toBe('arsenik');
      expect(result.exceedances[0].limit).toBe(10);
    });

    it('ignores unknown parameters', () => {
      const result = svc.validateLabResults(
        { sample_results: [{ parameter: 'okand-param', value: 9999, unit: 'mg/kg TS' }] },
        'trace-l3',
      );
      expect(result.status).toBe('PASS');
      expect(result.exceedances).toHaveLength(0);
    });

    it('reports multiple exceedances across different parameters', () => {
      const result = svc.validateLabResults(
        {
          sample_results: [
            { parameter: 'bly', value: 100, unit: 'mg/kg TS' },
            { parameter: 'kadmium', value: 2, unit: 'mg/kg TS' },
            { parameter: 'krom', value: 50, unit: 'mg/kg TS' },
          ],
        },
        'trace-l4',
      );
      expect(result.status).toBe('FAIL');
      expect(result.exceedances).toHaveLength(2);
      const params = result.exceedances.map((e) => e.parameter);
      expect(params).toContain('bly');
      expect(params).toContain('kadmium');
    });

    it('PASS when value equals exact limit (not strictly greater)', () => {
      // arsenik limit = 10; value = 10 should pass
      const result = svc.validateLabResults(
        { sample_results: [{ parameter: 'arsenik', value: 10, unit: 'mg/kg TS' }] },
        'trace-l5',
      );
      expect(result.status).toBe('PASS');
    });

    it('includes traceId in result', () => {
      const result = svc.validateLabResults(
        { sample_results: [{ parameter: 'nickel', value: 1 }] },
        'my-trace-l',
      );
      expect(result.traceId).toBe('my-trace-l');
    });
  });

  // ── getComplianceRequirements ───────────────────────────────────────────────
  describe('getComplianceRequirements', () => {
    it('returns INDEX source when verified requirements exist in the database', async () => {
      mocks.listRequirementRows.mockResolvedValue({
        items: [
          {
            interpretedRequirement: 'Egenkontroll krävs.',
            requirementTextQuote: '',
            legalReference: 'Miljöbalken 26 kap. 19 §',
          },
        ],
        total: 1,
      });
      const result = await svc.getComplianceRequirements(
        { activity_code: '29.40', ewc_code: '17 05 04' },
        'trace-c1',
        'org-1',
      );
      expect(result.source).toBe('INDEX');
      expect(result.requirements).toHaveLength(1);
      expect(result.requirements[0].rule).toBe('Egenkontroll krävs.');
    });

    it('returns AI source when DB is empty but Gemini responds', async () => {
      mocks.listRequirementRows.mockResolvedValue({ items: [], total: 0 });
      mocks.suggestRequirementsFromGemini.mockResolvedValue([
        { rule: 'AI rule 1', law: 'Miljöbalken', citation: '26 kap. 19 §' },
      ]);
      const result = await svc.getComplianceRequirements(
        { activity_code: '29.40', ewc_code: '17 05 04' },
        'trace-c2',
        'org-1',
      );
      expect(result.source).toBe('AI');
      expect(result.requirements[0].rule).toBe('AI rule 1');
    });

    it('returns FALLBACK when both DB and AI are empty', async () => {
      mocks.listRequirementRows.mockResolvedValue({ items: [], total: 0 });
      mocks.suggestRequirementsFromGemini.mockResolvedValue([]);
      const result = await svc.getComplianceRequirements(
        { activity_code: '29.40', ewc_code: '17 05 04' },
        'trace-c3',
        'org-1',
      );
      expect(result.source).toBe('FALLBACK');
      expect(result.requirements.length).toBeGreaterThan(0);
    });

    it('skips DB lookup when no organisationId is provided', async () => {
      mocks.suggestRequirementsFromGemini.mockResolvedValue([]);
      const result = await svc.getComplianceRequirements(
        { activity_code: '29.40', ewc_code: '17 05 04' },
        'trace-c4',
      );
      expect(mocks.listRequirementRows).not.toHaveBeenCalled();
      expect(result.source).toBe('FALLBACK');
    });

    it('deduplicates identical requirements from INDEX', async () => {
      const duplicate = {
        interpretedRequirement: 'Egenkontroll krävs.',
        requirementTextQuote: '',
        legalReference: 'Miljöbalken 26 kap. 19 §',
      };
      mocks.listRequirementRows.mockResolvedValue({ items: [duplicate, duplicate], total: 2 });
      const result = await svc.getComplianceRequirements(
        { activity_code: '29.40', ewc_code: '' },
        'trace-c5',
        'org-1',
      );
      expect(result.requirements).toHaveLength(1);
    });
  });

  // ── verifyAnalysis ──────────────────────────────────────────────────────────
  describe('verifyAnalysis', () => {
    it('returns VERIFIED when text contains law name and chapter/paragraph', async () => {
      mocks.getVerificationSecondOpinionFromOpenAi.mockResolvedValue({
        status: 'VERIFIED',
        missing_citations: [],
      });
      const result = await svc.verifyAnalysis(
        { analysis: 'Enligt Miljöbalken (1998:808), 26 kap. 19 § ska egenkontroll utföras.' },
        'trace-v1',
      );
      expect(result.status).toBe('VERIFIED');
      expect(result.missing_citations).toHaveLength(0);
    });

    it('returns UNVERIFIED and lists missing law name when absent', async () => {
      mocks.getVerificationSecondOpinionFromOpenAi.mockResolvedValue({
        status: 'VERIFIED',
        missing_citations: [],
      });
      const result = await svc.verifyAnalysis(
        { analysis: 'Verksamheten ska ha egenkontroll, 26 kap. 19 §.' },
        'trace-v2',
      );
      expect(result.status).toBe('UNVERIFIED');
      expect(
        result.missing_citations.some((m) => /lag/i.test(m) || /f.rordning/i.test(m) || /SFS/i.test(m)),
      ).toBe(true);
    });

    it('returns UNVERIFIED and lists missing paragraph ref when absent', async () => {
      mocks.getVerificationSecondOpinionFromOpenAi.mockResolvedValue({
        status: 'VERIFIED',
        missing_citations: [],
      });
      const result = await svc.verifyAnalysis(
        { analysis: 'Miljöbalken (1998:808) är tillämplig.' },
        'trace-v3',
      );
      expect(result.status).toBe('UNVERIFIED');
      expect(result.missing_citations.some((m) => /kapitel|paragraf|§/i.test(m))).toBe(true);
    });

    it('returns UNVERIFIED when analysis is empty', async () => {
      mocks.getVerificationSecondOpinionFromOpenAi.mockResolvedValue({
        status: 'VERIFIED',
        missing_citations: [],
      });
      const result = await svc.verifyAnalysis({ analysis: '' }, 'trace-v4');
      expect(result.status).toBe('UNVERIFIED');
    });

    it('merges AI missing citations with deterministic ones', async () => {
      mocks.getVerificationSecondOpinionFromOpenAi.mockResolvedValue({
        status: 'UNVERIFIED',
        missing_citations: ['AI says missing X'],
      });
      const result = await svc.verifyAnalysis({ analysis: 'Ingen lag nämns.' }, 'trace-v5');
      expect(result.missing_citations).toContain('AI says missing X');
      expect(result.missing_citations.length).toBeGreaterThan(1);
    });

    it('deduplicates merged missing citations', async () => {
      const sharedMsg = 'Saknar lag- eller forordningsnamn (eller SFS-nummer).';
      mocks.getVerificationSecondOpinionFromOpenAi.mockResolvedValue({
        status: 'UNVERIFIED',
        missing_citations: [sharedMsg],
      });
      const result = await svc.verifyAnalysis({ analysis: 'Ingen text.' }, 'trace-v6');
      const count = result.missing_citations.filter((m) => m === sharedMsg).length;
      expect(count).toBe(1);
    });

    it('accepts SFS-nummer as valid law reference', async () => {
      mocks.getVerificationSecondOpinionFromOpenAi.mockResolvedValue({
        status: 'VERIFIED',
        missing_citations: [],
      });
      const result = await svc.verifyAnalysis(
        { analysis: 'SFS 1998:808 gäller. 26 kap. 19 § är tillämplig.' },
        'trace-v7',
      );
      expect(result.status).toBe('VERIFIED');
    });
  });

  // ── generatePermitDraft ─────────────────────────────────────────────────────
  describe('generatePermitDraft', () => {
    beforeEach(() => {
      mocks.renderCompliancePlanTemplate.mockReturnValue('base permit text');
    });

    it('uses AI draft when Gemini returns a valid response', async () => {
      mocks.generatePermitDraftFromGemini.mockResolvedValue({
        document_type: 'B-tillstand',
        draft_text: 'AI generated permit text',
      });
      const result = await svc.generatePermitDraft(
        {
          project_data: { name: 'Test AB', municipality: 'Malmö', ewc_code: '17 05 04', volume_tons: 5000 },
          requirements: [{ rule: 'Egenkontroll', law: 'Miljöbalken', citation: '26 kap. 19 §' }],
          risk_flags: [],
        },
        'trace-p1',
      );
      expect(result.draft_text).toBe('AI generated permit text');
      expect(result.document_type).toBe('B-tillstand');
    });

    it('falls back to template when Gemini returns nothing', async () => {
      mocks.generatePermitDraftFromGemini.mockResolvedValue(null);
      const result = await svc.generatePermitDraft(
        {
          project_data: { name: 'Fallback AB', municipality: 'Lund', ewc_code: '17 05 04', volume_tons: 500 },
          requirements: [],
          risk_flags: [],
        },
        'trace-p2',
      );
      expect(result.draft_text).toContain('base permit text');
    });

    it('resolves document type as B-tillstand for volume > 10000', async () => {
      mocks.generatePermitDraftFromGemini.mockResolvedValue(null);
      const result = await svc.generatePermitDraft(
        {
          project_data: { name: 'BigCo', municipality: 'Stockholm', volume_tons: 15000, ewc_code: '' },
          requirements: [],
          risk_flags: [],
        },
        'trace-p3',
      );
      expect(result.document_type).toBe('B-tillstand');
    });

    it('resolves document type as C-anmalan for small volume', async () => {
      mocks.generatePermitDraftFromGemini.mockResolvedValue(null);
      const result = await svc.generatePermitDraft(
        {
          project_data: { name: 'SmallCo', municipality: 'Lund', volume_tons: 100, ewc_code: '' },
          requirements: [],
          risk_flags: [],
        },
        'trace-p4',
      );
      expect(result.document_type).toBe('C-anmalan');
    });

    it('includes traceId in response', async () => {
      mocks.generatePermitDraftFromGemini.mockResolvedValue(null);
      const result = await svc.generatePermitDraft(
        { project_data: { name: 'X', municipality: 'Y' }, requirements: [], risk_flags: [] },
        'my-trace-permit',
      );
      expect(result.traceId).toBe('my-trace-permit');
    });
  });
});
