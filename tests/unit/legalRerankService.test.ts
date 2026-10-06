import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateJson: vi.fn(),
  localGenerationStatus: vi.fn(),
}));

vi.mock('../../server/modules/ai/generation/LocalGenerationPort', () => ({
  generateJson: mocks.generateJson,
  localGenerationStatus: mocks.localGenerationStatus,
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
    mocks.localGenerationStatus.mockReturnValue({ available: true, runtime_id: 'test', model_id: 'test', blocker: null });
    mocks.generateJson.mockResolvedValue([
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
    expect(mocks.generateJson).toHaveBeenCalledOnce();
    expect(result.items[0].id).toBe('a');
    expect(result.items[0].finalScore).toBe(0.95);
  });

  it('rerankWithGeminiOrLexical faller tillbaka till lexical utan lokal generation-runtime', async () => {
    mocks.localGenerationStatus.mockReturnValue({ available: false, runtime_id: null, model_id: null, blocker: 'BLOCKED_BY_LOCAL_GENERATION_RUNTIME' });

    const result = await rerankWithGeminiOrLexical(
      'fosfor avlopp',
      [{ id: 'a', chunkText: 'fosfor avlopp', score: 0.1 }],
      8,
    );

    expect(result.engine).toBe('lexical');
    expect(result.promptVersion).toBe('offline-fallback');
    expect(result.skipReason).toBe('MISSING_LOCAL_GENERATION_RUNTIME');
    expect(mocks.generateJson).not.toHaveBeenCalled();
  });

  it('rerankWithGeminiOrLexical faller tillbaka vid Vertex-fel', async () => {
    mocks.generateJson.mockRejectedValue(new Error('Vertex timeout'));

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
