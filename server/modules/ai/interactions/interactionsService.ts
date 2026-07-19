import { getInteractionsClient } from './interactionsClient';
import { InteractionInput, InteractionResult } from './types';

/**
 * Isolated service for the Interactions API prototype.
 * Targets gemini-3.5-flash by default.
 */
export async function generateWithInteractions(input: InteractionInput): Promise<InteractionResult> {
  const client = getInteractionsClient();
  const modelName = input.model || process.env.INTERACTIONS_MODEL || 'gemini-3.5-flash';
  const store = input.store !== undefined ? input.store : (process.env.INTERACTIONS_STORE === 'true');

  console.log(`[Interactions API] Calling interactions.create with model ${modelName}, store=${store}`);

  // @ts-ignore - The interactions API might be marked as experimental or missing from types in older versions of the SDK,
  // but we verified it exists at runtime in v2.7.0.
  const interaction = await client.interactions.create({
    model: modelName,
    input: input.prompt,
    store: store,
    previous_interaction_id: input.previousInteractionId,
    system_instruction: input.systemInstruction,
  });

  return {
    interactionId: interaction.id,
    outputText: interaction.output_text,
    status: interaction.status,
    stepCount: interaction.steps?.length || 0,
    usage: interaction.usage,
  };
}
