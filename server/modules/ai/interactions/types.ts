export interface InteractionInput {
  prompt: string;
  previousInteractionId?: string;
  systemInstruction?: string;
  model?: string;
  store?: boolean;
}

export interface InteractionResult {
  interactionId: string;
  outputText: string;
  status: string;
  stepCount: number;
  usage?: any;
}

export interface PrototypeSessionResponse {
  ok: boolean;
  sessionId: string;
  interactionId: string;
  outputText: string;
  status: string;
  meta: {
    model: string;
    stepCount: number;
  };
}
