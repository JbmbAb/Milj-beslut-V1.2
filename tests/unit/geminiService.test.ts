import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(function () {
    return {
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      }),
    };
  }),
}));

describe('geminiService', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Offline Fallbacks (Ingen API-nyckel)', () => {
    let geminiService: typeof import('../../services/geminiService');

    beforeEach(async () => {
      vi.resetModules();
      process.env = { ...originalEnv };
      delete process.env.GEMINI_API_KEY;
      geminiService = await import('../../services/geminiService');
    });

    it('analyzePermitRisk uses offline fallback', async () => {
      const permit = {
        decision_type: 'AVSLAG',
        municipality: 'Orsa',
        property_id: '1:1',
        waste_codes: '17',
        full_text: 'text',
      };
      const res = await geminiService.analyzePermitRisk(permit as any);
      expect(res).toContain('Offline-analys');
      expect(res).toContain('högre regulatorisk risk');
    });

    it('chatWithPermit uses offline fallback', async () => {
      const permit = {
        decision_type: 'AVSLAG',
        municipality: 'Orsa',
        property_id: '1:1',
        waste_codes: '17',
        full_text: 'text',
      };
      const res = await geminiService.chatWithPermit(permit as any, 'Hello', []);
      expect(res).toContain('Offline-svar');
    });

    it('analyzeSiteImage uses offline fallback', async () => {
      const res = await geminiService.analyzeSiteImage('base64', 'image/png');
      expect(res).toContain('Offline-analys');
    });

    it('analyzeTechnicalDrawing uses offline fallback', async () => {
      const res = await geminiService.analyzeTechnicalDrawing('base64', 'image/png');
      expect(res).toContain('Offline-analys');
    });

    it('analyzeDrawingOCR uses offline fallback', async () => {
      const res = await geminiService.analyzeDrawingOCR('base64', 'image/png');
      expect(res).toContain('Offline OCR');
    });

    it('classifyAsset uses offline fallback', async () => {
      const res = await geminiService.classifyAsset('base64', 'image/png');
      expect(res).toBeDefined();
    });

    it('suggestStakeholders uses fallback', async () => {
      const res = await geminiService.suggestStakeholders('Stockholm', 'desc');
      expect(res.length).toBe(3);
      expect(res[0].role).toBe('Tillsyn');
    });

    it('generatePlanDraft uses offline fallback', async () => {
      const resBg = await geminiService.generatePlanDraft('background', 'ctx');
      expect(resBg).toContain('Projektet avser');

      const resDesc = await geminiService.generatePlanDraft('description', 'ctx');
      expect(resDesc).toContain('Genomförande sker etappvis');

      const resGoals = await geminiService.generatePlanDraft('goals', 'ctx');
      expect(resGoals).toContain('Kvalitetssäkrad');
    });

    it('analyzeBiodiversity computes offline rules', async () => {
      const res = await geminiService.analyzeBiodiversity(59, 18);
      expect(res.summary).toContain('Offline-analys');
      expect(res.compliance).toBeDefined();
    });

    it('predictWeatherRisk returns offline forecast', async () => {
      const res = await geminiService.predictWeatherRisk('Göteborg');
      expect(res.level).toBe('Medel');
      expect(res.description).toContain('Offline-prognos');
    });

    it('autoFillFormSection uses offline fallback', async () => {
      const res = await geminiService.autoFillFormSection('Section 1', {});
      expect(res).toContain('Offline-utkast');
    });

    it('fetchMunicipalityContext uses offline fallback', async () => {
      const res = await geminiService.fetchMunicipalityContext('Stockholm');
      expect(res.text).toContain('Offline-kontext');
    });

    it('performSpatialAudit uses offline fallback', async () => {
      const res = await geminiService.performSpatialAudit(59, 18);
      expect(res.text).toBeDefined();
    });

    it('askGeneralAssistant uses offline fallback', async () => {
      const res = await geminiService.askGeneralAssistant('Hello', []);
      expect(res).toContain('Offline-assistent');
    });

    it('generateFigmaAiResponse uses offline fallback', async () => {
      const resBrief = await geminiService.generateFigmaAiResponse('Prompt', { style: 'brief' });
      expect(resBrief).toContain('status först');

      const resBullet = await geminiService.generateFigmaAiResponse('Prompt', { style: 'bullet' });
      expect(resBullet).toContain('Fokus');

      const resDetailed = await geminiService.generateFigmaAiResponse('Prompt', { style: 'detailed' });
      expect(resDetailed).toContain('top-down-layout');
    });

    it('generateFigmaUiSpec uses offline fallback', async () => {
      const res = await geminiService.generateFigmaUiSpec('Prompt');
      expect(res.title).toBe('Miljöbeslut UI');
    });

    it('processDocumentOCR uses offline fallback', async () => {
      const res = await geminiService.processDocumentOCR('base64', 'application/pdf');
      expect(res.municipality).toBe('Haninge');
    });

    it('generateMarketingSummary uses offline fallback', async () => {
      const res = await geminiService.generateMarketingSummary([]);
      expect(res.text).toContain('Offline-marknadsrapport');
    });

    it('validateLabData uses offline fallback', async () => {
      const res = await geminiService.validateLabData('Pb: 100');
      expect(res?.status).toBe('UNKNOWN');
    });

    it('analyzeLogisticsCompliance uses offline fallback', async () => {
      const res = await geminiService.analyzeLogisticsCompliance({} as any);
      expect(res?.environmental_risks).toContain('Okänd risk (Offline)');
    });

    it('analyzeCourtRuling uses offline fallback', async () => {
      const res = await geminiService.analyzeCourtRuling('text');
      expect(res?.precedent_strength).toBe('unknown');
    });
  });

  describe('Online AI Generation (Med API-nyckel)', () => {
    let geminiServiceOnline: typeof import('../../services/geminiService');

    beforeEach(async () => {
      vi.resetModules();
      process.env = { ...originalEnv, GEMINI_API_KEY: 'fake-key' };
      geminiServiceOnline = await import('../../services/geminiService');

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Mocked AI response',
        },
      });
    });

    it('calls GoogleGenerativeAI for text generation', async () => {
      const res = await geminiServiceOnline.analyzePermitRisk({} as any);
      expect(res).toBe('Mocked AI response');
    });

    it('parses JSON from AI response correctly', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => 'Some text \n {"status": "PASS", "parameters_exceeding_limits": []} \n more text',
        },
      });
      const res = await geminiServiceOnline.validateLabData('lab data');
      expect(res?.status).toBe('PASS');
    });

    it('handles JSON parsing errors and falls back', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => 'Invalid JSON \n { "status": ',
        },
      });
      const res = await geminiServiceOnline.validateLabData('lab data');
      expect(res?.status).toBe('UNKNOWN');
    });

    it('handles AI throw errors gracefully', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('AI failed'));
      const res = await geminiServiceOnline.analyzePermitRisk({
        decision_type: 'BIFALL',
        municipality: 'M',
        property_id: '1',
      } as any);
      expect(res).toContain('Offline-analys'); // Fallback triggered
    });
  });
});
