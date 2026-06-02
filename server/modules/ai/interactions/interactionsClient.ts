import { GoogleGenAI } from '@google/genai';
import { assertInteractionsPrototypeConfigured } from './interactionsConfig';

let interactionsClient: GoogleGenAI | null = null;

export function getInteractionsClient(): GoogleGenAI {
  const { apiKey } = assertInteractionsPrototypeConfigured();
  if (!interactionsClient) {
    interactionsClient = new GoogleGenAI({ apiKey });
  }
  return interactionsClient;
}

/** Test helper */
export function resetInteractionsClientForTests(): void {
  interactionsClient = null;
}
