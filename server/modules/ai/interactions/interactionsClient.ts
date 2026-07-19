import { GoogleGenAI } from '@google/genai';

/**
 * PURELY FOR PROTOTYPE / PILOT.
 * Uses Gemini API (AI Studio) key, NOT Vertex AI ADC.
 */
export function getInteractionsClient() {
  const apiKey = process.env.INTERACTIONS_GEMINI_API_KEY;
  
  if (!apiKey && process.env.NODE_ENV !== 'production') {
    console.warn('INTERACTIONS_GEMINI_API_KEY is not set. Interactions prototype will fail.');
  }

  if (!apiKey) {
    throw new Error('INTERACTIONS_GEMINI_API_KEY is required for the Interactions prototype.');
  }

  return new GoogleGenAI({ apiKey });
}
