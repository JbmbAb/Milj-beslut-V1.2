export type InteractionPrototypeTurnResult =
  | {
      ok: true;
      sessionId: string;
      interactionId: string;
      outputText: string;
      status: string;
      meta: {
        model: string;
        stepCount: number;
        usage?: unknown;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type GenerateWithInteractionsInput = {
  prompt: string;
  previousInteractionId?: string;
  systemInstruction?: string;
  model?: string;
  store?: boolean;
};

export type GenerateWithInteractionsResult = {
  interactionId: string;
  outputText: string;
  status: string;
  stepCount: number;
  usage?: unknown;
};
