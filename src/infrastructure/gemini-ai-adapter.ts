import { IAIService, AIAnalysisResult } from '../domain/ai.interface';

/**
 * AI-adapter (infralager) – produktion kör generering via `vertexAiService` / API;
 * detta lager används här främst för arkitektur-test och health-ytor utan separat API-nyckel.
 */
export class GeminiAIAdapter implements IAIService {
  /** @deprecated För bakåtkompabilitet; Vertex använder ADC, inte en klient-API-nyckel. */
  constructor(_legacyApiKey?: string) {}

  async analyzeDocumentText(text: string, contextPrompt: string): Promise<AIAnalysisResult> {
    console.log(`[GeminiAIAdapter] Analyzing text length: ${text.length}`);

    return {
      confidenceScore: 0.85,
      extractedText: 'Sammanfattning genererad av AI',
      suggestedCategory: 'MILJÖRAPPORT',
      metadata: { model: 'vertex', surface: 'platform-stub' },
    };
  }

  async extractRequirements(text: string): Promise<any[]> {
    return [{ code: 'AI-KRAV-1', text: 'Bullernivå max 55 dB', level: 'MANDATORY' }];
  }
}
