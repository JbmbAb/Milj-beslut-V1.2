import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  generatePermitDraftFromGemini as GeneratePermitDraft,
  getVerificationSecondOpinionFromOpenAi as GetSecondOpinion,
  suggestRequirementsFromGemini as SuggestRequirements,
} from '../../server/services/mvpAiGatewayService';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getGenerativeModel: vi.fn(),
  generateContent: vi.fn(),
}));

// Must use function (not arrow) to satisfy vitest v4 constructor mock requirement.
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function (this: Record<string, unknown>) {
    return { getGenerativeModel: mocks.getGenerativeModel };
  }),
}));

const originalFetch = globalThis.fetch;

// ─── Module re-import helpers ─────────────────────────────────────────────────
// mvpAiGatewayService has a module-level `cachedGeminiClient`. We must reset
// modules before each test so the cache starts as `undefined`.

type MvpService = {
  suggestRequirementsFromGemini: typeof SuggestRequirements;
  generatePermitDraftFromGemini: typeof GeneratePermitDraft;
  getVerificationSecondOpinionFromOpenAi: typeof GetSecondOpinion;
};

let svc: MvpService;

async function loadService() {
  vi.resetModules();
  svc = await import('../../server/services/mvpAiGatewayService') as MvpService;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockGeminiResponse(jsonText: string) {
  mocks.getGenerativeModel.mockReturnValue({
    generateContent: mocks.generateContent,
  });
  mocks.generateContent.mockResolvedValue({
    response: { text: () => jsonText },
  });
}

function mockOpenAiResponse(body: unknown, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mvpAiGatewayService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  // ── suggestRequirementsFromGemini ──────────────────────────────────────

  describe('suggestRequirementsFromGemini', () => {
    it('returns null when GEMINI_API_KEY is missing', async () => {
      await loadService();
      const result = await svc.suggestRequirementsFromGemini({ activityCode: '90.00', ewcCode: '20 01' });
      expect(result).toBeNull();
    });

    it('parses valid requirements JSON from Gemini', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      await loadService();
      mockGeminiResponse(
        JSON.stringify({
          requirements: [
            { rule: 'Anmälningsplikt', law: 'Miljöbalken', citation: '9 kap. § 6' },
            { rule: 'Avfallshantering', law: 'Avfallsförordningen', citation: '2 kap. § 3' },
          ],
        }),
      );

      const result = await svc.suggestRequirementsFromGemini({ activityCode: '90.00', ewcCode: '20 01' });

      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({
        rule: 'Anmälningsplikt',
        law: 'Miljöbalken',
        citation: '9 kap. § 6',
      });
    });

    it('returns null for malformed JSON response', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      await loadService();
      mockGeminiResponse('This is not JSON at all');

      const result = await svc.suggestRequirementsFromGemini({ activityCode: '90.00', ewcCode: '20 01' });
      expect(result).toBeNull();
    });

    it('returns null when requirements array is empty', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      await loadService();
      mockGeminiResponse(JSON.stringify({ requirements: [] }));

      const result = await svc.suggestRequirementsFromGemini({ activityCode: '90.00', ewcCode: '20 01' });
      expect(result).toBeNull();
    });

    it('filters out incomplete requirement entries', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      await loadService();
      mockGeminiResponse(
        JSON.stringify({
          requirements: [
            { rule: 'Complete', law: 'MB', citation: '1 kap § 1' },
            { rule: 'Missing citation', law: 'MB', citation: '' }, // invalid
            { rule: '', law: 'MB', citation: '2 kap § 1' }, // invalid
          ],
        }),
      );

      const result = await svc.suggestRequirementsFromGemini({ activityCode: 'X', ewcCode: 'Y' });

      expect(result).toHaveLength(1);
      expect(result![0].rule).toBe('Complete');
    });

    it('returns null when Gemini throws', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      await loadService();
      mocks.getGenerativeModel.mockReturnValue({
        generateContent: vi.fn().mockRejectedValue(new Error('API error')),
      });

      const result = await svc.suggestRequirementsFromGemini({ activityCode: 'X', ewcCode: 'Y' });
      expect(result).toBeNull();
    });
  });

  // ── generatePermitDraftFromGemini ──────────────────────────────────────

  describe('generatePermitDraftFromGemini', () => {
    it('returns null when GEMINI_API_KEY is missing', async () => {
      await loadService();
      const result = await svc.generatePermitDraftFromGemini({
        projectData: {},
        requirements: [],
        riskFlags: [],
        defaultDocumentType: 'PERMIT_APPLICATION',
      });
      expect(result).toBeNull();
    });

    it('parses valid permit draft from Gemini', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      await loadService();
      mockGeminiResponse(
        JSON.stringify({
          document_type: 'PERMIT_APPLICATION',
          draft_text: 'Härmed ansöker vi om tillstånd...',
        }),
      );

      const result = await svc.generatePermitDraftFromGemini({
        projectData: { name: 'Test project' },
        requirements: [{ rule: 'R1', law: 'MB', citation: '1 kap § 1' }],
        riskFlags: ['Strandskydd'],
        defaultDocumentType: 'PERMIT_APPLICATION',
      });

      expect(result).toEqual({
        document_type: 'PERMIT_APPLICATION',
        draft_text: 'Härmed ansöker vi om tillstånd...',
      });
    });

    it('returns null for missing draft_text', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      await loadService();
      mockGeminiResponse(JSON.stringify({ document_type: 'PERMIT_APPLICATION', draft_text: '' }));

      const result = await svc.generatePermitDraftFromGemini({
        projectData: {},
        requirements: [],
        riskFlags: [],
        defaultDocumentType: 'PERMIT_APPLICATION',
      });
      expect(result).toBeNull();
    });
  });

  // ── getVerificationSecondOpinionFromOpenAi ─────────────────────────────

  describe('getVerificationSecondOpinionFromOpenAi', () => {
    it('returns null when OPENAI_API_KEY is missing', async () => {
      await loadService();
      const result = await svc.getVerificationSecondOpinionFromOpenAi({ analysis: 'Analys text' });
      expect(result).toBeNull();
    });

    it('parses VERIFIED opinion from OpenAI', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      await loadService();
      mockOpenAiResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({ status: 'VERIFIED', missing_citations: [] }),
            },
          },
        ],
      });

      const result = await svc.getVerificationSecondOpinionFromOpenAi({ analysis: 'Korrekt text' });

      expect(result).toEqual({ status: 'VERIFIED', missing_citations: [] });
    });

    it('parses UNVERIFIED opinion with missing citations', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      await loadService();
      mockOpenAiResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: 'UNVERIFIED',
                missing_citations: ['26 kap. § 19', '9 kap. § 6'],
              }),
            },
          },
        ],
      });

      const result = await svc.getVerificationSecondOpinionFromOpenAi({ analysis: 'Saknar citat' });

      expect(result?.status).toBe('UNVERIFIED');
      expect(result?.missing_citations).toHaveLength(2);
    });

    it('returns null when OpenAI response is not ok', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      await loadService();
      mockOpenAiResponse({}, false);

      const result = await svc.getVerificationSecondOpinionFromOpenAi({ analysis: 'text' });
      expect(result).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      await loadService();
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await svc.getVerificationSecondOpinionFromOpenAi({ analysis: 'text' });
      expect(result).toBeNull();
    });
  });
});

