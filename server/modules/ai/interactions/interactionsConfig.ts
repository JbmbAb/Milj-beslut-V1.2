import { SecureError } from '../../../security/secureErrors';

export function isInteractionsPrototypeEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return String(process.env.INTERACTIONS_PROTOTYPE_ENABLED || '').toLowerCase() === 'true';
}

export function getInteractionsModel(): string {
  return process.env.INTERACTIONS_MODEL?.trim() || 'gemini-3.5-flash';
}

export function getInteractionsStoreDefault(): boolean {
  return String(process.env.INTERACTIONS_STORE || 'true').toLowerCase() !== 'false';
}

export function assertInteractionsPrototypeConfigured(): {
  apiKey: string;
  model: string;
  store: boolean;
} {
  if (!isInteractionsPrototypeEnabled()) {
    throw new SecureError(
      'interactions_prototype_disabled',
      'Interactions prototype is not enabled',
      404,
    );
  }

  const apiKey = process.env.INTERACTIONS_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new SecureError(
      'interactions_api_key_missing',
      'Interactions API key is not configured',
      503,
    );
  }

  return {
    apiKey,
    model: getInteractionsModel(),
    store: getInteractionsStoreDefault(),
  };
}

export function interactionsPrototypeSystemInstruction(): string {
  return [
    'You are a helpful assistant for an isolated Interactions API prototype.',
    'Do not request or store real personal data, property designations, or case identifiers.',
    'Keep answers concise unless the user asks for detail.',
  ].join('\n');
}
