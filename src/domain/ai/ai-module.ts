// src/domain/ai/ai-module.ts

export type AiCapability = 'Decision' | 'Knowledge' | 'Spatial' | 'OCR' | 'Summarization';

export interface AiRequest {
  capability: AiCapability;
  prompt: string;
  payload: Record<string, unknown>;
  policies?: string[];
}

export interface AiCitation {
  documentId: string;   // Stabilt dokument-ID i Mimers Brunn
  version: string;      // Exakt dokumentversion vid hämtningstillfället
  page: number;         // Sida
  paragraph?: string;   // Specifikt kapitel/avsnitt
  exactText?: string;   // Citerad lagtext/regel
}

export interface AiResponse {
  success: boolean;
  narrative: string;                         // Den genererade löptexten på svenska
  citations: AiCitation[];                   // Verifierade källhänvisningar till Mimers Brunn
  confidence: 'high' | 'medium' | 'low';     // AI:ns konfidensgrad
  structuredData?: Record<string, unknown>;  // Maskinläsbara fakta som extraherats
  warnings: string[];                        // Eventuella avvikelser eller efterlevnadsvarningar
  audit: {
    requestId: string;                       // Unikt ID för revisionsspårning av detta anrop
    traceId: string;                         // Distribuerat Trace-ID för att kedja samman webbegäran, loggar och PDF
    modelUsed: string;                       // Modellprofil och version (t.ex. 'Gemini-2.0-Flash-Reasoning-v1')
  };
}

export interface IAiOrchestrator {
  execute(request: AiRequest): Promise<AiResponse>;
}
