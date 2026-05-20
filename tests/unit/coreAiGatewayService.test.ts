import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocka Vertex-gatewayen istället för den gamla Gemini/OpenAI-SDK:n.
// coreAiGatewayService använder enbart generateJsonWithVertex och skickar
// med en parse-funktion — vi kan simulera det genom att låta mock-funktionen
// anropa parsern med det tillhandahållna payloadet.
const mocks = vi.hoisted(() => ({
  generateJsonWithVertex: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../server/services/vertexAiService', () => ({
  generateJsonWithVertex: mocks.generateJsonWithVertex,
  __resetVertexClientForTest: vi.fn(),
  vertexConfigStatus: vi.fn(() => ({
    configured: true,
    missing: [],
    projectId: 'test',
    location: 'europe-west1',
  })),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

type AiGatewayModule = typeof import('../../server/services/coreAiGatewayService');

/**
 * Hjälpfunktion: simulera att Vertex returnerar `jsonPayload` genom att
 * köra anroparens `parse`-funktion på det.
 */
function mockVertexPayload(jsonPayload: unknown): void {
  mocks.generateJsonWithVertex.mockImplementation(async (_prompt: string, opts?: any) => {
    if (opts?.parse) {
      return opts.parse(jsonPayload);
    }
    return jsonPayload;
  });
}

describe('coreAiGatewayService (Vertex AI)', () => {
  let mod: AiGatewayModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    process.env.VERTEX_PROJECT_ID = 'test-project';
    mod = await import('../../server/services/coreAiGatewayService');
  });

  afterEach(() => {
    delete process.env.VERTEX_PROJECT_ID;
  });

  describe('suggestRequirementsFromGemini', () => {
    it('returns parsed requirements when Vertex returns valid JSON', async () => {
      mockVertexPayload({
        requirements: [{ rule: 'Egenkontroll krävs', law: 'Miljöbalken', citation: '26 kap. 19 §' }],
      });

      const result = await mod.suggestRequirementsFromGemini({
        activityCode: '29.40',
        ewcCode: '17 05 04',
      });
      expect(result).toHaveLength(1);
      expect(result![0].rule).toBe('Egenkontroll krävs');
    });

    it('returns null when Vertex returns empty requirements array', async () => {
      mockVertexPayload({ requirements: [] });
      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.50', ewcCode: '' });
      expect(result).toBeNull();
    });

    it('returns null when Vertex throws', async () => {
      mocks.generateJsonWithVertex.mockRejectedValue(new Error('Vertex timeout'));
      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.40', ewcCode: '' });
      expect(result).toBeNull();
    });

    it('filters out entries missing required fields', async () => {
      mockVertexPayload({
        requirements: [
          { rule: 'Valid rule', law: 'Miljöbalken', citation: '26 kap. 19 §' },
          { rule: '', law: 'Miljöbalken', citation: '1 §' },
          { rule: 'Missing law', law: '', citation: '2 §' },
        ],
      });
      const result = await mod.suggestRequirementsFromGemini({ activityCode: '29.40', ewcCode: '' });
      expect(result).toHaveLength(1);
      expect(result![0].rule).toBe('Valid rule');
    });
  });

  describe('generatePermitDraftFromGemini', () => {
    it('returns parsed permit draft on success', async () => {
      mockVertexPayload({
        document_type: 'C-anmalan',
        draft_text: 'Tillståndstext för projektet.',
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

    it('returns null when Vertex returns incomplete payload', async () => {
      mockVertexPayload({ document_type: '' });
      const result = await mod.generatePermitDraftFromGemini({
        projectData: {},
        requirements: [],
        riskFlags: [],
        defaultDocumentType: 'C-anmalan',
      });
      expect(result).toBeNull();
    });

    it('returns null when Vertex throws', async () => {
      mocks.generateJsonWithVertex.mockRejectedValue(new Error('API error'));
      const result = await mod.generatePermitDraftFromGemini({
        projectData: {},
        requirements: [],
        riskFlags: [],
        defaultDocumentType: 'C-anmalan',
      });
      expect(result).toBeNull();
    });
  });

  describe('getVerificationSecondOpinionFromOpenAi (nu Vertex)', () => {
    it('returns VERIFIED when payload är korrekt', async () => {
      mockVertexPayload({ status: 'VERIFIED', missing_citations: [] });
      const result = await mod.getVerificationSecondOpinionFromOpenAi({
        analysis: 'Enligt Miljöbalken 26 kap. 19 § ska egenkontroll utföras.',
      });
      expect(result?.status).toBe('VERIFIED');
      expect(result?.missing_citations).toHaveLength(0);
    });

    it('returns UNVERIFIED med missing citations', async () => {
      mockVertexPayload({ status: 'UNVERIFIED', missing_citations: ['Saknar SFS-nummer'] });
      const result = await mod.getVerificationSecondOpinionFromOpenAi({ analysis: 'Ingen lagtext' });
      expect(result?.status).toBe('UNVERIFIED');
      expect(result?.missing_citations).toContain('Saknar SFS-nummer');
    });

    it('returns null när Vertex kraschar', async () => {
      mocks.generateJsonWithVertex.mockRejectedValue(new Error('Network error'));
      const result = await mod.getVerificationSecondOpinionFromOpenAi({ analysis: 'text' });
      expect(result).toBeNull();
    });

    it('returns null när status inte är VERIFIED/UNVERIFIED', async () => {
      mockVertexPayload({ status: 'UNKNOWN_VALUE', missing_citations: [] });
      const result = await mod.getVerificationSecondOpinionFromOpenAi({ analysis: 'text' });
      expect(result).toBeNull();
    });
  });
});
