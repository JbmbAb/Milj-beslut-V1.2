import { afterEach, describe, expect, it } from 'vitest';
import { LocalAIAdapter } from '../../../src/infrastructure/local-ai-adapter';
import {
  LOCAL_GENERATION_BLOCKER,
  registerLocalGenerationRuntime,
} from '../../../server/modules/ai/generation/LocalGenerationPort';

describe('LocalAIAdapter', () => {
  afterEach(() => {
    registerLocalGenerationRuntime(null);
  });

  it('fails closed when no governed local generation runtime is registered', async () => {
    const adapter = new LocalAIAdapter();
    await expect(adapter.analyzeDocumentText('text', 'context')).rejects.toMatchObject({
      code: LOCAL_GENERATION_BLOCKER,
    });
    await expect(adapter.extractRequirements('text')).rejects.toMatchObject({
      code: LOCAL_GENERATION_BLOCKER,
    });
  });

  it('accepts a strictly valid document-analysis JSON payload from an injected local runtime', async () => {
    registerLocalGenerationRuntime({
      runtime_id: 'test-local',
      model_id: 'test-model',
      model_version: '1',
      async generateText() {
        return JSON.stringify({
          confidenceScore: 0.8,
          extractedText: 'Sammanfattning',
          suggestedCategory: 'MILJÖRAPPORT',
          metadata: { source: 'local-test-runtime' },
        });
      },
    });
    const adapter = new LocalAIAdapter();
    await expect(adapter.analyzeDocumentText('text', 'context')).resolves.toEqual({
      confidenceScore: 0.8,
      extractedText: 'Sammanfattning',
      suggestedCategory: 'MILJÖRAPPORT',
      metadata: { source: 'local-test-runtime' },
    });
  });

  it('accepts a strictly valid requirements array from an injected local runtime', async () => {
    registerLocalGenerationRuntime({
      runtime_id: 'test-local',
      model_id: 'test-model',
      model_version: '1',
      async generateText() {
        return JSON.stringify([{ code: 'KRAV-1', text: 'Explicit krav', level: 'MANDATORY' }]);
      },
    });
    const adapter = new LocalAIAdapter();
    await expect(adapter.extractRequirements('text')).resolves.toEqual([
      { code: 'KRAV-1', text: 'Explicit krav', level: 'MANDATORY' },
    ]);
  });

  it('rejects prose-wrapped JSON instead of repairing it', async () => {
    registerLocalGenerationRuntime({
      runtime_id: 'test-local',
      model_id: 'test-model',
      model_version: '1',
      async generateText() {
        return 'Svar: {"confidenceScore":0.8,"extractedText":"x","suggestedCategory":"ANNAT","metadata":{}}';
      },
    });
    const adapter = new LocalAIAdapter();
    await expect(adapter.analyzeDocumentText('text', 'context')).rejects.toThrow();
  });

  it('rejects malformed structured output instead of fabricating defaults', async () => {
    registerLocalGenerationRuntime({
      runtime_id: 'test-local',
      model_id: 'test-model',
      model_version: '1',
      async generateText() {
        return JSON.stringify({ confidenceScore: 7, extractedText: '', suggestedCategory: '', metadata: [] });
      },
    });
    const adapter = new LocalAIAdapter();
    await expect(adapter.analyzeDocumentText('text', 'context')).rejects.toThrow(/invalid document-analysis JSON/i);
  });
});
