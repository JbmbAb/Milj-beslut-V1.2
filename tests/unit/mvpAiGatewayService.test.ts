import { describe, it, expect, vi, beforeEach } from 'vitest';

// Symbols to help access the mocks
const { mockGenerateContent, mockFetch } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockFetch: vi.fn(),
}));

// Mock @google/generative-ai
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(function () {
    return {
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      }),
    };
  }),
}));

// Mock global fetch for OpenAI
vi.stubGlobal('fetch', mockFetch);

import {
  suggestRequirementsFromGemini,
  generatePermitDraftFromGemini,
  getVerificationSecondOpinionFromOpenAi,
} from '../../server/services/mvpAiGatewayService';

describe('mvpAiGatewayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'fake-key';
    process.env.OPENAI_API_KEY = 'fake-key';
  });

  describe('suggestRequirementsFromGemini', () => {
    it('returns parsed requirements on success', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              requirements: [{ rule: 'R1', law: 'L1', citation: 'C1' }],
            }),
        },
      });

      const result = await suggestRequirementsFromGemini({ activityCode: 'A1', ewcCode: 'E1' });
      expect(result).toHaveLength(1);
      expect(result![0].rule).toBe('R1');
    });

    it('handles malformed JSON response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Invalid JSON {',
        },
      });

      const result = await suggestRequirementsFromGemini({ activityCode: 'A1', ewcCode: 'E1' });
      expect(result).toBeNull();
    });

    it('handles missing requirements array in JSON', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({ something_else: [] }),
        },
      });

      const result = await suggestRequirementsFromGemini({ activityCode: 'A1', ewcCode: 'E1' });
      expect(result).toBeNull();
    });
  });

  describe('generatePermitDraftFromGemini', () => {
    it('returns draft suggestion on success', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              document_type: 'Anmälan',
              draft_text: 'Test draft',
            }),
        },
      });

      const result = await generatePermitDraftFromGemini({
        projectData: {},
        requirements: [],
        riskFlags: [],
        defaultDocumentType: 'Type',
      });

      expect(result?.document_type).toBe('Anmälan');
    });

    it('returns null on Gemini error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('AI error'));
      const result = await generatePermitDraftFromGemini({} as any);
      expect(result).toBeNull();
    });
  });

  describe('getVerificationSecondOpinionFromOpenAi', () => {
    it('returns verification result on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: 'VERIFIED',
                  missing_citations: [],
                }),
              },
            },
          ],
        }),
      });

      const result = await getVerificationSecondOpinionFromOpenAi({ analysis: 'test' });
      expect(result?.status).toBe('VERIFIED');
    });

    it('handles unsuccessful OpenAI response', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      const result = await getVerificationSecondOpinionFromOpenAi({ analysis: 'test' });
      expect(result).toBeNull();
    });

    it('handles missing choices in OpenAI response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [] }),
      });
      const result = await getVerificationSecondOpinionFromOpenAi({ analysis: 'test' });
      expect(result).toBeNull();
    });
  });
});
