import { AiOptions, AiProvider, AiResponse } from './aiProvider';
import { generateJsonWithVertex, generateTextWithVertex } from './vertexAiService';

export class GeminiAiProvider implements AiProvider {
  async generateText(prompt: string, options?: AiOptions): Promise<AiResponse> {
    const text = await generateTextWithVertex(prompt, {
      profile: options?.profile,
      temperature: options?.temperature,
      maxOutputTokens: options?.maxOutputTokens,
      systemInstruction: options?.systemInstruction,
    });
    return { text };
  }

  async generateJson<T>(prompt: string, options?: AiOptions): Promise<T> {
    const result = await generateJsonWithVertex<T>(prompt, {
      profile: options?.profile,
      temperature: options?.temperature,
      maxOutputTokens: options?.maxOutputTokens,
      systemInstruction: options?.systemInstruction,
    });
    if (result === null) {
      throw new Error('AI failed to return valid JSON');
    }
    return result;
  }
}

export class MockAiProvider implements AiProvider {
  async generateText(prompt: string, _options?: AiOptions): Promise<AiResponse> {
    return { text: `Mock response for: ${prompt.slice(0, 50)}...` };
  }

  async generateJson<T>(_prompt: string, _options?: AiOptions): Promise<T> {
    return { mock: true } as any as T;
  }
}

let currentProvider: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (currentProvider) return currentProvider;

  if (process.env.USE_MOCK_AI === 'true' || process.env.NODE_ENV === 'test') {
    currentProvider = new MockAiProvider();
  } else {
    currentProvider = new GeminiAiProvider();
  }
  return currentProvider;
}

/** Manual override for tests */
export function setAiProvider(provider: AiProvider) {
  currentProvider = provider;
}
