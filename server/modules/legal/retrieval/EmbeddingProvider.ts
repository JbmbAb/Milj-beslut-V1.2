/**
 * Embedding provider contract of the legal retrieval path (W-NO-GOOGLE-02A).
 *
 * Provider-neutral on purpose: the contract names no vendor and no model. The only production
 * implementation is LocalEmbeddingProvider; there is no second implementation, no mock, and no
 * fallback chain -- a failing provider throws and the caller fails closed.
 *
 * Query and passage embedding are separate calls because the pinned local pipelines treat them
 * differently (e.g. the e5 prefix convention). A single "embed this text" call would let a caller
 * embed a query as a passage without noticing.
 */

export class EmbeddingProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "EmbeddingProviderError";
  }
}

export interface EmbeddingProvider {
  /** embedding_model_id of every vector this provider returns. */
  readonly model_id: string;
  /** embedding_model_version: the exact pinned model revision. */
  readonly model_version: string;
  /** embedding_pipeline_version: fixes the input convention, dimension and normalisation. */
  readonly pipeline_version: string;
  /** Dimension of every vector this provider returns. Never adapted, padded or truncated. */
  readonly dimension: number;
  embedQueries(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  embedPassages(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
