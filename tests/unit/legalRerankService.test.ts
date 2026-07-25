import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    getGenerativeModel() {
      return { generateContent };
    }
  },
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
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    generateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify([
            { id: 'a', score: 0.95 },
            { id: 'b', score: 0.4 },
          ]),
      },
    });
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it('localLexicalRerank prioriterar query-termer', () => {
    const ranked = localLexicalRerank('fosfor avlopp', [
      { chunkText: 'fosfor i avlopp', score: 0.1 },
      { chunkText: 'vägbyggnad', score: 0.2 },
    ]);
    expect(ranked[0].chunkText).toBe('fosfor i avlopp');
  });

  it('rerankWithGeminiOrLexical använder Gemini när nyckel finns', async () => {
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
    expect(generateContent).toHaveBeenCalledOnce();
    expect(result.items[0].id).toBe('a');
    expect(result.items[0].finalScore).toBe(0.95);
  });

  it('rerankWithGeminiOrLexical faller tillbaka till lexical utan API-nyckel', async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await rerankWithGeminiOrLexical(
      'fosfor avlopp',
      [{ id: 'a', chunkText: 'fosfor avlopp', score: 0.1 }],
      8,
    );

    expect(result.engine).toBe('lexical');
    expect(result.promptVersion).toBe('offline-fallback');
    expect(generateContent).not.toHaveBeenCalled();
  });
});
