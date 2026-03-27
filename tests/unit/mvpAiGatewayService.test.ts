import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getGenerativeModel: vi.fn(),
  fetchFn: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@google/generative-ai', () => ({
  // Use a regular function so `new GoogleGenerativeAI(key)` works correctly.
  GoogleGenerativeAI: function MockGAI(this: Record<string, unknown>) {
    this.getGenerativeModel = mocks.getGenerativeModel;
  },
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

type AiGatewayModule = typeof import('../../server/services/mvpAiGatewayService');

describe('mvpAiGatewayService', () => {
  let mod: AiGatewayModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    mocks.getGenerativeModel.mockReturnValue({ generateContent: mocks.generateContent });
    vi.stubGlobal('fetch', mocks.fetchFn);
    mod = await import('../../server/services/mvpAiGatewayService');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  describe('suggestRequirementsFromGemini', () => {
    it('returns parsed requirements when Gemini returns valid JSON', async () => {
      mocks.generateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              requirements: [
                { rule: 'Egenkontroll krävs', law: 'Miljöbalken', citation: '26 kap. 19 §' },
              ],
            }),
        },
      });

      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.40', ewcCode: '17 05 04' });
      expect(result).toHaveLength(1);
      expect(result![0].rule).toBe('Egenkontroll krävs');
      expect(result![0].law).toBe('Miljöbalken');
      expect(result![0].citation).toBe('26 kap. 19 §');
    });

    it('returns null when no GEMINI_API_KEY is set', async () => {
      delete process.env.GEMINI_API_KEY;
      vi.resetModules();
      const freshMod = await import('../../server/services/mvpAiGatewayService');
      const result = await freshMod.suggestRequirementsFromGemini({ activityCode: '29.40', ewcCode: '17 05 04' });
      expect(result).toBeNull();
    });

    it('returns null when Gemini returns invalid JSON', async () => {
      mocks.generateContent.mockResolvedValue({
        response: { text: () => 'not-valid-json-at-all' },
      });
      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.40', ewcCode: '' });
      expect(result).toBeNull();
    });

    it('returns null when requirements array is empty', async () => {
      mocks.generateContent.mockResolvedValue({
        response: { text: () => JSON.stringify({ requirements: [] }) },
      });
      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.50', ewcCode: '' });
      expect(result).toBeNull();
    });

    it('returns null when Gemini call throws', async () => {
      mocks.generateContent.mockRejectedValue(new Error('Gemini timeout'));
      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.40', ewcCode: '' });
      expect(result).toBeNull();
    });

    it('filters out entries missing required fields', async () => {
      mocks.generateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              requirements: [
                { rule: 'Valid rule', law: 'Miljöbalken', citation: '26 kap. 19 §' },
                { rule: '', law: 'Miljöbalken', citation: '1 §' },
                { rule: 'Missing law rule', law: '', citation: '2 §' },
              ],
            }),
        },
      });
      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.40', ewcCode: '' });
      expect(result).toHaveLength(1);
      expect(result![0].rule).toBe('Valid rule');
    });

    it('parses JSON embedded in surrounding text (extraction fallback)', async () => {
      const json = JSON.stringify({
        requirements: [{ rule: 'Extracted rule', law: 'MB', citation: '1 §' }],
      });
      mocks.generateContent.mockResolvedValue({
        response: { text: () => `Some preamble text\n${json}\nsome trailing text` },
      });
      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.40', ewcCode: '' });
      expect(result).not.toBeNull();
      expect(result![0].rule).toBe('Extracted rule');
    });
  });

  describe('generatePermitDraftFromGemini', () => {
    it('returns parsed permit draft on success', async () => {
      mocks.generateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              document_type: 'C-anmalan',
              draft_text: 'Tillståndstext för projektet.',
            }),
        },
      });

      const result = await mod.generatePermitDraftFromGemini({
        projectData: { name: 'Test Project', municipality: 'Stockholm' },
        requirements: [{ rule: 'R1', law: 'MB', citation: '1 §' }],
        riskFlags: ['Large volume'],
        defaultDocumentType: 'C-anmalan',
      });

      expect(result?.document_type).toBe('C-anmalan');
      expect(result?.draft_text).toBe('Tillståndstext för projektet.');
    });

    it('returns null when Gemini returns incomplete payload', async () => {
      mocks.generateContent.mockResolvedValue({
        response: { text: () => JSON.stringify({ document_type: '' }) },
      });
      const result = await mod.generatePermitDraftFromGemini({
        projectData: {},
        requirements: [],
        riskFlags: [],
        defaultDocumentType: 'C-anmalan',
      });
      expect(result).toBeNull();
    });

    it('returns null when Gemini throws', async () => {
      mocks.generateContent.mockRejectedValue(new Error('API error'));
      const result = await mod.generatePermitDraftFromGemini({
        projectData: {},
        requirements: [],
        riskFlags: [],
        defaultDocumentType: 'C-anmalan',
      });
      expect(result).toBeNull();
    });
  });

  describe('getVerificationSecondOpinionFromOpenAi', () => {
    it('returns VERIFIED with empty missing_citations on success', async () => {
      mocks.fetchFn.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ status: 'VERIFIED', missing_citations: [] }),
              },
            },
          ],
        }),
      });

      const result = await mod.getVerificationSecondOpinionFromOpenAi({
        analysis: 'Enligt Miljöbalken 26 kap. 19 § ska egenkontroll utföras.',
      });
      expect(result?.status).toBe('VERIFIED');
      expect(result?.missing_citations).toHaveLength(0);
    });

    it('returns UNVERIFIED with populated missing_citations', async () => {
      mocks.fetchFn.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ status: 'UNVERIFIED', missing_citations: ['Saknar SFS-nummer'] }),
              },
            },
          ],
        }),
      });

      const result = await mod.getVerificationSecondOpinionFromOpenAi({ analysis: 'Ingen lagtext' });
      expect(result?.status).toBe('UNVERIFIED');
      expect(result?.missing_citations).toContain('Saknar SFS-nummer');
    });

    it('returns null when OpenAI API responds with non-ok status', async () => {
      mocks.fetchFn.mockResolvedValue({ ok: false });
      const result = await mod.getVerificationSecondOpinionFromOpenAi({ analysis: 'text' });
      expect(result).toBeNull();
    });

    it('returns null when no OPENAI_API_KEY is set', async () => {
      delete process.env.OPENAI_API_KEY;
      vi.resetModules();
      const freshMod = await import('../../server/services/mvpAiGatewayService');
      const result = await freshMod.getVerificationSecondOpinionFromOpenAi({ analysis: 'text' });
      expect(result).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      mocks.fetchFn.mockRejectedValue(new Error('Network error'));
      const result = await mod.getVerificationSecondOpinionFromOpenAi({ analysis: 'text' });
      expect(result).toBeNull();
    });

    it('returns null when status is neither VERIFIED nor UNVERIFIED', async () => {
      mocks.fetchFn.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ status: 'UNKNOWN_VALUE', missing_citations: [] }),
              },
            },
          ],
        }),
      });
      const result = await mod.getVerificationSecondOpinionFromOpenAi({ analysis: 'text' });
      expect(result).toBeNull();
    });
  });
});
