/**
 * AI DOMAIN INTERFACE
 * Abstraktion för AI-tjänster (t.ex. LLMs) så att domänen inte är
 * hårt kopplad till specifikt Gemini, OpenAI etc.
 */

export interface AIAnalysisResult {
  confidenceScore: number;
  extractedText: string;
  suggestedCategory: string;
  metadata: Record<string, any>;
}

export interface IAIService {
  analyzeDocumentText(text: string, contextPrompt: string): Promise<AIAnalysisResult>;
  extractRequirements(text: string): Promise<any[]>;
}
