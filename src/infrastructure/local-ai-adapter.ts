import type { AIAnalysisResult, IAIService } from '../domain/ai.interface';
import {
  generateJson,
  LocalGenerationUnavailableError,
  type GenerationJsonSchema,
} from '../../server/modules/ai/generation/LocalGenerationPort';

const ANALYSIS_SCHEMA: GenerationJsonSchema = {
  type: 'object',
  properties: {
    confidenceScore: { type: 'number' },
    extractedText: { type: 'string' },
    suggestedCategory: { type: 'string' },
    metadata: { type: 'object' },
  },
  required: ['confidenceScore', 'extractedText', 'suggestedCategory', 'metadata'],
};

const REQUIREMENTS_SCHEMA: GenerationJsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      code: { type: 'string' },
      text: { type: 'string' },
      level: { type: 'string' },
    },
    required: ['code', 'text', 'level'],
  },
};

function parseAnalysis(payload: unknown): AIAnalysisResult | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (
    typeof row.confidenceScore !== 'number' ||
    !Number.isFinite(row.confidenceScore) ||
    row.confidenceScore < 0 ||
    row.confidenceScore > 1 ||
    typeof row.extractedText !== 'string' ||
    !row.extractedText.trim() ||
    typeof row.suggestedCategory !== 'string' ||
    !row.suggestedCategory.trim() ||
    !row.metadata ||
    typeof row.metadata !== 'object' ||
    Array.isArray(row.metadata)
  ) {
    return null;
  }
  return {
    confidenceScore: row.confidenceScore,
    extractedText: row.extractedText,
    suggestedCategory: row.suggestedCategory,
    metadata: row.metadata as Record<string, unknown>,
  };
}

function parseRequirements(payload: unknown): any[] | null {
  if (!Array.isArray(payload)) return null;
  const rows: any[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.code !== 'string' ||
      !row.code.trim() ||
      typeof row.text !== 'string' ||
      !row.text.trim() ||
      typeof row.level !== 'string' ||
      !row.level.trim()
    ) {
      return null;
    }
    rows.push({ code: row.code, text: row.text, level: row.level });
  }
  return rows;
}

function invalidResponse(kind: string): never {
  const error = new Error(`local generation returned invalid ${kind} JSON -- failing closed`);
  error.name = 'LocalGenerationInvalidResponseError';
  throw error;
}

/**
 * Provider-neutral local/on-prem AI adapter.
 *
 * It never fabricates data, never selects a mock and never has a cloud fallback. With no governed
 * local runtime registered, calls throw LocalGenerationUnavailableError. Structured outputs are
 * accepted only after strict JSON.parse in LocalGenerationPort plus deterministic shape validation.
 */
export class LocalAIAdapter implements IAIService {
  async analyzeDocumentText(text: string, contextPrompt: string): Promise<AIAnalysisResult> {
    const result = await generateJson<AIAnalysisResult>(
      [
        'Analyze the following document text under the supplied context.',
        'Return JSON only with confidenceScore (0..1), extractedText, suggestedCategory and metadata.',
        `CONTEXT: ${contextPrompt}`,
        `DOCUMENT:\n${text}`,
      ].join('\n\n'),
      {
        profile: 'json',
        temperature: 0,
        responseSchema: ANALYSIS_SCHEMA,
        parse: parseAnalysis,
      },
    );
    return result ?? invalidResponse('document-analysis');
  }

  async extractRequirements(text: string): Promise<any[]> {
    const result = await generateJson<any[]>(
      [
        'Extract explicit requirements from the document text.',
        'Return JSON only: an array of {code,text,level}. Do not invent requirements.',
        `DOCUMENT:\n${text}`,
      ].join('\n\n'),
      {
        profile: 'json',
        temperature: 0,
        responseSchema: REQUIREMENTS_SCHEMA,
        parse: parseRequirements,
      },
    );
    return result ?? invalidResponse('requirements');
  }
}

export { LocalGenerationUnavailableError };
