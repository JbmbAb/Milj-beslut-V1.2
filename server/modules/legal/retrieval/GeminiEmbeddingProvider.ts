/**
 * LEGAL-RETRIEVAL-BOUNDED-PILOT-01.
 *
 * Real, production-wired embedding provider for the pilot. NOT Vertex AI: verified live before
 * this unit started that Vertex's ADC path (server/services/vertexEmbeddingService.ts) is
 * genuinely broken in this environment -- `gcloud auth application-default print-access-token`
 * itself fails with "Reauthentication failed. cannot prompt during non-interactive execution",
 * independent of any app code, meaning the cached credential requires interactive human reauth
 * that cannot happen here. See LEGAL-RETRIEVAL-BOUNDED-PILOT-01-PROVEN.md for the full finding.
 *
 * This uses the Gemini API-key path (`GEMINI_API_KEY`, `@google/genai`'s `embedContent`) instead
 * -- verified live, working, and versionable (exact model id pinned, batch embedding confirmed).
 * `scripts/import/generate-embeddings.ts` uses the SAME underlying call mechanism but is flagged
 * LEGACY for its governance-bypass persistence (writes straight into DocumentChunk.embedding via
 * $executeRawUnsafe with a silent mock fallback baked in). This module reuses only the verified
 * call mechanism, not that script's persistence or its silent-mock-on-failure behavior: a failed
 * call here throws, it never substitutes a fake vector.
 */

import { GoogleGenAI } from "@google/genai";

export const EMBEDDING_MODEL_ID = "gemini-embedding-001" as const;
export const EMBEDDING_MODEL_VERSION = "001" as const;
export const EMBEDDING_PIPELINE_VERSION = "embed-pipeline-gemini-v1" as const;
export const EMBEDDING_DIMENSIONS = 3072 as const;

export class EmbeddingProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}

export interface EmbeddingProvider {
  readonly model_id: string;
  readonly model_version: string;
  readonly pipeline_version: string;
  embedBatch(texts: readonly string[]): Promise<readonly number[][]>;
}

/** Real provider. Fails closed: never returns a mock/synthetic vector on error. */
export function createGeminiEmbeddingProvider(
  modelId: string = EMBEDDING_MODEL_ID,
): EmbeddingProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      "GEMINI_API_KEY is not set -- refusing to fabricate embeddings",
    );
  }
  const ai = new GoogleGenAI({ apiKey });

  return {
    model_id: modelId,
    model_version: EMBEDDING_MODEL_VERSION,
    pipeline_version: EMBEDDING_PIPELINE_VERSION,
    async embedBatch(texts: readonly string[]): Promise<readonly number[][]> {
      if (texts.length === 0) return [];
      const response = await ai.models.embedContent({
        model: modelId,
        contents: [...texts],
      });
      const embeddings = response.embeddings;
      if (!embeddings || embeddings.length !== texts.length) {
        throw new EmbeddingProviderError(
          "EMBEDDING_BATCH_SIZE_MISMATCH",
          `requested ${texts.length} embeddings, provider returned ${embeddings?.length ?? 0} -- failing closed, not padding with mock vectors`,
        );
      }
      return embeddings.map((e, i) => {
        const values = e.values;
        if (!values || values.length === 0) {
          throw new EmbeddingProviderError(
            "EMBEDDING_MISSING_VALUES",
            `embedding ${i} of batch has no values -- failing closed`,
          );
        }
        return values;
      });
    },
  };
}
