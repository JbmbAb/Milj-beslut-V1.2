/**
 * Runtime provenance carrier for locally generated embeddings.
 *
 * Persistence accepts an issued object rather than a naked vector + claimed identity. The WeakSet
 * prevents ordinary object-shape forgery inside the running process. The issuer function is kept
 * out of public package exports and is imported only by LocalEmbeddingProvider.
 */
import type { EmbeddingIdentityFields, LocalEmbeddingKey } from "@miljobeslut/mps-embedding-identity";

export interface IssuedLocalEmbedding {
  readonly identity: EmbeddingIdentityFields;
  readonly vector: readonly number[];
  readonly model_key: LocalEmbeddingKey;
  readonly snapshot_manifest_sha256: string;
}

const issued = new WeakSet<object>();

export function issueLocalEmbeddingForProvider(value: IssuedLocalEmbedding): IssuedLocalEmbedding {
  const frozen = Object.freeze({
    ...value,
    identity: Object.freeze({ ...value.identity }),
    vector: Object.freeze([...value.vector]),
  });
  issued.add(frozen);
  return frozen;
}

export function isIssuedLocalEmbedding(value: unknown): value is IssuedLocalEmbedding {
  return typeof value === "object" && value !== null && issued.has(value as object);
}
