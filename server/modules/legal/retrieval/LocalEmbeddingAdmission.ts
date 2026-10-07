/**
 * W-NO-GOOGLE-02A production admission of the local embedding model.
 *
 * Production admits EXACTLY ONE pipeline: BAAI/bge-m3 at the exact evaluated Hugging Face revision
 * (5617a9f61b028005a4858fdac845db406aefb181), 1024 dimensions, fp32, L2, no prefixes
 * (pipeline local-st-bge-m3-dense-v1).
 *
 * Basis (owner decision, 2026-10-07): the frozen W-EMBED-MODEL-SELECTION-04 evaluation (87 product-
 * representative questions, four candidates, all four meeting the frozen viability floor, decision
 * MULTIPLE_DENSE_MODELS_VIABLE_NO_CLEAR_WINNER) did not name a quality winner; bge-m3 was selected on
 * operational grounds (no trust_remote_code, no truncation of the evaluated corpus, lowest latency/VRAM of
 * the quality-equivalent candidates). The other frozen candidates stay EVALUATION candidates: they remain
 * in the pipeline registry but are neither creatable, writable nor queryable through production code.
 *
 * Changing the admitted pipeline (another model, another revision, another precision) is a new owner
 * decision, a new registry entry and a new migration -- never an edit of this list alone (the database
 * pins the same triple).
 */
import {
  getLocalEmbeddingPipelineByKey,
  type LocalEmbeddingKey,
  type LocalEmbeddingPipelineSpec,
} from "@miljobeslut/mps-embedding-identity";

const PRODUCTION_ADMITTED_KEYS: readonly LocalEmbeddingKey[] = Object.freeze(["bge-m3"] as LocalEmbeddingKey[]);

const ADMITTED_SPEC: LocalEmbeddingPipelineSpec = (() => {
  if (PRODUCTION_ADMITTED_KEYS.length !== 1) {
    throw new Error("production admits exactly one local embedding pipeline");
  }
  const spec = getLocalEmbeddingPipelineByKey(PRODUCTION_ADMITTED_KEYS[0]!);
  if (!spec) throw new Error(`admitted key '${PRODUCTION_ADMITTED_KEYS[0]}' is not a registered local pipeline`);
  return spec;
})();

export function productionAdmittedLocalEmbeddingKeys(): readonly LocalEmbeddingKey[] {
  return PRODUCTION_ADMITTED_KEYS;
}

export function isProductionAdmittedLocalEmbeddingKey(key: string): key is LocalEmbeddingKey {
  return (PRODUCTION_ADMITTED_KEYS as readonly string[]).includes(key);
}

/** The one production pipeline (exact registry entry). */
export function getProductionAdmittedLocalEmbeddingPipeline(): LocalEmbeddingPipelineSpec {
  return ADMITTED_SPEC;
}

/** Read/write guards identify the pipeline by its version string. */
export function isProductionAdmittedLocalEmbeddingPipelineVersion(pipelineVersion: string): boolean {
  return pipelineVersion === ADMITTED_SPEC.pipeline_version;
}
