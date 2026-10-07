/**
 * W-NO-GOOGLE-02B. Provider-neutral LOCAL generation port.
 *
 * Zero-Google invariant: generation is local/on-prem only. This module defines the narrow seam
 * (text generation, optionally constrained by a JSON schema) that reachable callers need. It is NOT
 * an implementation: until a governed local runtime is registered by production composition, every
 * call fails closed with BLOCKED_BY_LOCAL_GENERATION_RUNTIME. There is no default endpoint, no
 * cloud fallback, no mock and no canned answer here.
 */

export const LOCAL_GENERATION_BLOCKER = "BLOCKED_BY_LOCAL_GENERATION_RUNTIME" as const;

export type GenerationProfile = "text" | "fast" | "json";

/** Plain JSON-schema-shaped object; the port does not depend on any vendor schema type. */
export type GenerationJsonSchema = Readonly<Record<string, unknown>>;

export interface GenerationOptions {
  readonly profile?: GenerationProfile;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly systemInstruction?: string;
  /** When set the runtime must return a single JSON document conforming to the schema. */
  readonly responseSchema?: GenerationJsonSchema;
}

export interface LocalGenerationPort {
  readonly runtime_id: string;
  readonly model_id: string;
  readonly model_version: string;
  generateText(prompt: string, options?: GenerationOptions): Promise<string>;
}

export class LocalGenerationUnavailableError extends Error {
  readonly code = LOCAL_GENERATION_BLOCKER;
  constructor(message = "no governed local generation runtime is registered -- failing closed") {
    super(message);
    this.name = "LocalGenerationUnavailableError";
  }
}

let registered: LocalGenerationPort | null = null;

/** Called only by production composition once a real governed local runtime exists. */
export function registerLocalGenerationRuntime(port: LocalGenerationPort | null): void {
  registered = port;
}

export function isLocalGenerationAvailable(): boolean {
  return registered !== null;
}

export function getLocalGenerationPort(): LocalGenerationPort {
  if (!registered) throw new LocalGenerationUnavailableError();
  return registered;
}

export function localGenerationStatus(): {
  available: boolean;
  runtime_id: string | null;
  model_id: string | null;
  blocker: typeof LOCAL_GENERATION_BLOCKER | null;
} {
  return registered
    ? { available: true, runtime_id: registered.runtime_id, model_id: registered.model_id, blocker: null }
    : { available: false, runtime_id: null, model_id: null, blocker: LOCAL_GENERATION_BLOCKER };
}

export async function generateText(prompt: string, options: GenerationOptions = {}): Promise<string> {
  const text = await getLocalGenerationPort().generateText(prompt, options);
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("local generation returned empty text");
  }
  return text;
}

/**
 * Structured generation. Strict JSON.parse only -- no fence stripping, no regex extraction.
 * Returns null for a malformed payload (callers fail closed on null); throws when unavailable.
 */
export async function generateJson<T = unknown>(
  prompt: string,
  options: GenerationOptions & { parse?: (payload: unknown) => T | null } = {},
): Promise<T | null> {
  const { parse, ...rest } = options;
  const text = await getLocalGenerationPort().generateText(prompt, { profile: "json", ...rest });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  return parse ? parse(payload) : (payload as T | null);
}
