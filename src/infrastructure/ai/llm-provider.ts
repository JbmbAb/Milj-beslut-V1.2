// src/infrastructure/ai/llm-provider.ts

import { AiRequest } from '../../domain/ai/ai-module';
import { generateTextWithVertex, generateJsonWithVertex } from '../../../server/services/vertexAiService';
import { Logger } from '../observability/logger';

export interface ILlmProvider {
  generate(request: AiRequest): Promise<{
    success: boolean;
    narrative: string;
    citations: Array<{
      documentId: string;
      version: string;
      page: number;
      paragraph?: string;
      exactText?: string;
    }>;
    confidence: 'high' | 'medium' | 'low';
    structuredData?: Record<string, unknown>;
    warnings: string[];
    modelUsed: string;
    tokenUsage?: { promptTokens: number; completionTokens: number };
  }>;
}

export class MockLlmProvider implements ILlmProvider {
  async generate(request: AiRequest): Promise<any> {
    const isOcr = request.capability === 'OCR';
    const isSummarization = request.capability === 'Summarization';
    const isSpatial = request.capability === 'Spatial';

    let narrative = `Simulerat ${request.capability}-svar för prompt: "${request.prompt.substring(0, 40)}..."`;
    let structuredData: Record<string, any> = {};

    if (isOcr) {
      narrative = 'Detta är en skannad text med identifierade miljöuppgifter.';
      structuredData = { textLength: 120, language: 'sv' };
    } else if (isSummarization) {
      narrative = 'Sammanfattning av inkommet beslutsunderlag: Inga kritiska anmärkningar funna.';
    } else if (isSpatial) {
      narrative = 'Spatial analys visar att det sökta området ligger utanför skyddszoner.';
      structuredData = { distanceToWater: 45, withinRiskZone: false };
    }

    return {
      success: true,
      narrative,
      citations: [
        {
          documentId: 'doc-viss-gv-2026-v1.4',
          version: '1.4',
          page: 1,
          paragraph: 'Kapitel 3.2',
          exactText: 'Surt grundvatten bör undvikas.',
        },
      ],
      confidence: 'high',
      structuredData,
      warnings: [],
      modelUsed: 'mock-local-model',
      tokenUsage: { promptTokens: 50, completionTokens: 25 },
    };
  }
}

export class VertexLlmProvider implements ILlmProvider {
  private logger = new Logger('VertexLlmProvider');

  async generate(request: AiRequest): Promise<any> {
    const useJson = request.capability === 'Decision' || request.capability === 'Spatial' || request.capability === 'Knowledge';
    const modelProfile = request.capability === 'OCR' || request.capability === 'Summarization' ? 'fast' : 'text';

    try {
      if (useJson) {
        // We prompt the model to return structured JSON
        const responseSchema = {
          type: 'OBJECT',
          properties: {
            narrative: { type: 'STRING', description: 'Beskrivande text på svenska' },
            citations: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  documentId: { type: 'STRING' },
                  version: { type: 'STRING' },
                  page: { type: 'NUMBER' },
                  paragraph: { type: 'STRING' },
                  exactText: { type: 'STRING' },
                },
                required: ['documentId', 'version', 'page'],
              },
            },
            confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
            structuredData: { type: 'OBJECT' },
            warnings: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['narrative', 'citations', 'confidence', 'warnings'],
        };

        const result = await generateJsonWithVertex<any>(request.prompt, {
          profile: 'json',
          responseSchema,
        });

        if (!result) {
          throw new Error('generateJsonWithVertex returned null');
        }

        return {
          success: true,
          narrative: result.narrative,
          citations: result.citations || [],
          confidence: result.confidence || 'medium',
          structuredData: result.structuredData,
          warnings: result.warnings || [],
          modelUsed: process.env.VERTEX_JSON_MODEL || 'gemini-2.5-flash',
          tokenUsage: { promptTokens: 150, completionTokens: 100 }, // estimate since legacy doesn't return usage
        };
      } else {
        const resultText = await generateTextWithVertex(request.prompt, {
          profile: modelProfile,
        });

        return {
          success: true,
          narrative: resultText,
          citations: [],
          confidence: 'high',
          warnings: [],
          modelUsed: modelProfile === 'fast' ? (process.env.VERTEX_FAST_MODEL || 'gemini-2.5-flash') : (process.env.VERTEX_TEXT_MODEL || 'gemini-2.5-flash'),
          tokenUsage: { promptTokens: 100, completionTokens: 50 },
        };
      }
    } catch (err: any) {
      this.logger.error(`Generation failed: ${err.message}`, err);
      return {
        success: false,
        narrative: `Ett fel inträffade under genereringen: ${err.message}`,
        citations: [],
        confidence: 'low',
        warnings: [`Fel: ${err.message}`],
        modelUsed: 'unknown',
      };
    }
  }
}
