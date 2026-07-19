export interface AiResponse {
  text: string;
  usage?: {
    promptTokens: number;
    candidatesTokens: number;
  };
}

export interface AiOptions {
  profile?: 'text' | 'fast' | 'json';
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

export interface AiProvider {
  generateText(prompt: string, options?: AiOptions): Promise<AiResponse>;
  generateJson<T>(prompt: string, options?: AiOptions): Promise<T>;
}
