import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateJsonWithVertex: vi.fn(),
  vertexConfigStatus: vi.fn(),
}));

vi.mock('../../server/services/vertexAiService', () => ({
  generateJsonWithVertex: mocks.generateJsonWithVertex,
  vertexConfigStatus: mocks.vertexConfigStatus,
}));

vi.mock('../../server/services/rerankPromptService', () => ({
  RerankPromptService: {
    getFormattedPrompt: vi.fn().mockResolvedValue({
      prompt: 'rank these',
      version: 'test-prompt-v1',
    }),
    clearCache: vi.fn(),
  },
}));

import { localLexicalRerank, rerankWithGeminiOrLexical } from '../../server/services/legalRerankService';

describe('legalRerankService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.vertexConfigStatus.mockReturnValue({
      configured: true,
      missing: [],
      projectId: 'miljointelligens',
      location: 'europe-west1',
      hasExplicitServiceAccountFile: false,
    });
    mocks.generateJsonWithVertex.mockResolvedValue([
      { id: 'a', score: 0.95 },
      { id: 'b', score: 0.4 },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('localLexicalRerank prioriterar query-termer', () => {
    const ranked = localLexicalRerank('fosfor avlopp', [
      { chunkText: 'fosfor i avlopp', score: 0.1 },
      { chunkText: 'vägbyggnad', score: 0.2 },
    ]);
    expect(ranked[0].chunkText).toBe('fosfor i avlopp');
  });

  it('rerankWithGeminiOrLexical använder Vertex när konfigurerad', async () => {
    const result = await rerankWithGeminiOrLexical(
      'fosfor',
      [
        { id: 'a', chunkText: 'a', score: 0.1 },
        { id: 'b', chunkText: 'b', score: 0.2 },
      ],
      8,
    );

    expect(result.engine).toBe('gemini');
    expect(result.promptVersion).toBe('test-prompt-v1');
    expect(mocks.generateJsonWithVertex).toHaveBeenCalledOnce();
    expect(result.items[0].id).toBe('a');
    expect(result.items[0].finalScore).toBe(0.95);
  });

  it('rerankWithGeminiOrLexical faller tillbaka till lexical utan Vertex-konfig', async () => {
    mocks.vertexConfigStatus.mockReturnValue({
      configured: false,
      missing: ['VERTEX_PROJECT_ID'],
      projectId: null,
      location: 'europe-west1',
      hasExplicitServiceAccountFile: false,
    });

    const result = await rerankWithGeminiOrLexical(
      'fosfor avlopp',
      [{ id: 'a', chunkText: 'fosfor avlopp', score: 0.1 }],
      8,
    );

    expect(result.engine).toBe('lexical');
    expect(result.promptVersion).toBe('offline-fallback');
    expect(result.skipReason).toBe('MISSING_VERTEX_CONFIG');
    expect(mocks.generateJsonWithVertex).not.toHaveBeenCalled();
  });

  it('rerankWithGeminiOrLexical faller tillbaka vid Vertex-fel', async () => {
    mocks.generateJsonWithVertex.mockRejectedValue(new Error('Vertex timeout'));

    const result = await rerankWithGeminiOrLexical(
      'fosfor',
      [{ id: 'a', chunkText: 'fosfor avlopp', score: 0.1 }],
      8,
    );

    expect(result.engine).toBe('lexical');
    expect(result.promptVersion).toBe('error-fallback');
    expect(result.skipReason).toContain('Vertex timeout');
  });
});
