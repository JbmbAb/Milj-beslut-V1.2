/**
 * AI DOMAIN INTERFACE
 * Abstraktion för AI-tjänster (t.ex. LLMs) så att domänen inte är
 * hårt kopplad till en viss runtime. Produktion är local/on-prem och fail-closed.
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
