import { logger } from '../../../logger';
import { SecureError } from '../../../security/secureErrors';
import { CircuitBreaker } from '../../../utils/circuitBreaker';
import { getInteractionsClient } from './interactionsClient';
import { assertInteractionsPrototypeConfigured } from './interactionsConfig';
import type { GenerateWithInteractionsInput, GenerateWithInteractionsResult } from './types';

const interactionsBreaker = new CircuitBreaker({
  name: 'InteractionsAPI',
  failureThreshold: 3,
  recoveryTimeoutMs: 30_000,
});

type CompletedInteraction = {
  id: string;
  status: string;
  output_text?: string;
  steps?: unknown[];
  usage?: unknown;
};

function isCompletedInteraction(value: unknown): value is CompletedInteraction {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof (value as CompletedInteraction).id === 'string' &&
      'status' in value,
  );
}

export async function generateWithInteractions(
  input: GenerateWithInteractionsInput,
): Promise<GenerateWithInteractionsResult> {
  return interactionsBreaker.execute(async () => {
    const config = assertInteractionsPrototypeConfigured();
    const client = getInteractionsClient();

    const interaction = await client.interactions.create({
      model: input.model ?? config.model,
      input: input.prompt,
      store: input.store ?? config.store,
      previous_interaction_id: input.previousInteractionId,
      system_instruction: input.systemInstruction,
    });

    if (!isCompletedInteraction(interaction)) {
      throw new SecureError(
        'interactions_stream_unexpected',
        'Unexpected streaming response from Interactions API',
        502,
      );
    }

    if (interaction.status === 'failed' || interaction.status === 'cancelled') {
      logger.warn('Interactions API returned non-success status', {
        interactionId: interaction.id,
        status: interaction.status,
      });
      throw new SecureError(
        `interactions_status_${interaction.status}`,
        'Interactions API request failed',
        502,
      );
    }

    const outputText = String(interaction.output_text ?? '').trim();
    if (!outputText) {
      throw new SecureError(
        'interactions_empty_output',
        'Interactions API returned no text output',
        502,
      );
    }

    return {
      interactionId: interaction.id,
      outputText,
      status: interaction.status,
      stepCount: Array.isArray(interaction.steps) ? interaction.steps.length : 0,
      usage: interaction.usage,
    };
  });
}
