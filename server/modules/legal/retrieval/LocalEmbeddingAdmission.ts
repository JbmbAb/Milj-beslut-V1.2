/**
 * W-NO-GOOGLE-02A production admission.
 *
 * Frozen A7 candidates are evaluation candidates, not production defaults. Until a governed
 * evaluation selects exactly one winner, production admission is deliberately EMPTY.
 */
import type { LocalEmbeddingKey } from "@miljobeslut/mps-embedding-identity";

const PRODUCTION_ADMITTED_KEYS: readonly LocalEmbeddingKey[] = Object.freeze([] as LocalEmbeddingKey[]);

export function productionAdmittedLocalEmbeddingKeys(): readonly LocalEmbeddingKey[] {
  return PRODUCTION_ADMITTED_KEYS;
}

export function isProductionAdmittedLocalEmbeddingKey(key: string): key is LocalEmbeddingKey {
  return (PRODUCTION_ADMITTED_KEYS as readonly string[]).includes(key);
}
