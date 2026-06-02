import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('../../../server/modules/ai/interactions/interactionsClient', () => ({
  getInteractionsClient: vi.fn(() => ({
    interactions: {
      create: createMock,
    },
  })),
  resetInteractionsClientForTests: vi.fn(),
}));

import { generateWithInteractions } from '../../../server/modules/ai/interactions/interactionsService';

describe('generateWithInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERACTIONS_PROTOTYPE_ENABLED = 'true';
    process.env.INTERACTIONS_GEMINI_API_KEY = 'test-key';
    process.env.INTERACTIONS_MODEL = 'gemini-3.5-flash';
  });

  afterEach(() => {
    delete process.env.INTERACTIONS_PROTOTYPE_ENABLED;
    delete process.env.INTERACTIONS_GEMINI_API_KEY;
    delete process.env.INTERACTIONS_MODEL;
  });

  it('passes previous_interaction_id to the SDK', async () => {
    createMock.mockResolvedValue({
      id: 'int-2',
      status: 'completed',
      output_text: 'Environment Investigator',
      steps: [{ type: 'model_output' }],
    });

    const result = await generateWithInteractions({
      prompt: 'What is my name?',
      previousInteractionId: 'int-1',
      systemInstruction: 'test instruction',
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'What is my name?',
        previous_interaction_id: 'int-1',
        system_instruction: 'test instruction',
        model: 'gemini-3.5-flash',
        store: true,
      }),
    );
    expect(result.interactionId).toBe('int-2');
    expect(result.outputText).toBe('Environment Investigator');
    expect(result.stepCount).toBe(1);
  });
});
