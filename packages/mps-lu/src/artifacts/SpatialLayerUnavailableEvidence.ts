import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { SpatialLayerUnavailable, SpatialQueryContractV3 } from "../services/SpatialQueryContract";

/**
 * U30-R (LU 72h): the pinned cause of a NOT_CHECKED finding.
 *
 * When the spatial provider cannot technically query a governed layer, it mints one of these per
 * layer instead of reporting a bare `{ dataset, reason }`. The NOT_CHECKED finding cites it in
 * `evidence_refs`, the assessment's `evidence_refs` carries it, and deterministic re-execution
 * resolves it from CAS, re-verifies its hash and feeds it back to the rule engine as
 * `unavailable_layers`. Re-execution therefore reproduces an honest NOT_CHECKED from pinned
 * evidence, never from the stored findings it is checking.
 *
 * It is NOT a spatial result: no `result_semantics`, no `exists`, no geometry. It records only
 * which governed query could not run (layer + registry version hash + the full query contract)
 * and why. No wall-clock value is part of it.
 *
 * New contract for NEW assessments. Historical assessments keep `evidence_refs: []` on their
 * NOT_CHECKED findings and are classified NOT_CHECKED_CAUSE_NOT_PINNED by re-execution.
 *
 * PRES-24: new machine-readable tokens introduced here -- the artifact type
 * `SPATIAL_LAYER_UNAVAILABLE`, the contract version `spatial-layer-unavailable-v1` and the cause
 * kind `QUERY_EXECUTION_FAILED`. They add to the existing NOT_CHECKED vocabulary and replace none
 * of it. Owner decision 5 (U20-U30 spec section 4) is open on adopting them.
 */
export const SPATIAL_LAYER_UNAVAILABLE = "SPATIAL_LAYER_UNAVAILABLE" as const;
export const SPATIAL_LAYER_UNAVAILABLE_CONTRACT_VERSION_V1 = "spatial-layer-unavailable-v1" as const;
/** The only cause the provider records: the layer's own governed query failed to execute (SEM-1/OD-03). */
export const SPATIAL_LAYER_UNAVAILABLE_CAUSE_QUERY_EXECUTION_FAILED = "QUERY_EXECUTION_FAILED" as const;

export interface SpatialLayerUnavailablePayloadV1 {
  readonly contract_version: typeof SPATIAL_LAYER_UNAVAILABLE_CONTRACT_VERSION_V1;
  readonly layer_ref: {
    readonly layer_id: string;
    /** Registry (governed dataset) content hash of the layer the query targeted. */
    readonly version_hash: string;
    /** Human-readable label as requested; not an identity input of its own. */
    readonly layer_version: string;
  };
  readonly provider: string;
  /** The exact governed query that could not run, subject included. */
  readonly query_contract: SpatialQueryContractV3;
  readonly cause: {
    readonly kind: typeof SPATIAL_LAYER_UNAVAILABLE_CAUSE_QUERY_EXECUTION_FAILED;
    /** Short error class + message, never a stack trace (the provider's `describeQueryFailure`). */
    readonly reason: string;
  };
}

export interface SpatialLayerUnavailableArtifact extends ArtifactContract {
  readonly artifact_type: typeof SPATIAL_LAYER_UNAVAILABLE;
  readonly payload: SpatialLayerUnavailablePayloadV1;
}

function subjectReferences(queryContract: SpatialQueryContractV3): ArtifactReference[] {
  const subject = queryContract.subject;
  return subject.kind === "LOCALIZATION_GEOMETRY"
    ? [subject.property_context_ref, subject.location_ref]
    : [subject.property_context_ref];
}

function identityOf(payload: SpatialLayerUnavailablePayloadV1, references: readonly ArtifactReference[]) {
  const content_hash = sha256ContentHash({ artifact_type: SPATIAL_LAYER_UNAVAILABLE, references, payload });
  return {
    content_hash,
    artifact_id: `layer-unavailable-${payload.layer_ref.layer_id}-${content_hash.value.slice(0, 24)}`,
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Pure and deterministic: same layer, registry hash, query contract and reason -> same artifact. */
export function createSpatialLayerUnavailableEvidence(input: {
  readonly layer_id: string;
  readonly version_hash: string;
  readonly layer_version: string;
  readonly provider: string;
  readonly query_contract: SpatialQueryContractV3;
  readonly reason: string;
}): SpatialLayerUnavailableArtifact {
  for (const [name, value] of [
    ["layer_id", input.layer_id],
    ["version_hash", input.version_hash],
    ["provider", input.provider],
    ["reason", input.reason],
  ] as const) {
    if (!nonEmpty(value)) {
      throw new Error(`REJECT_SPATIAL_LAYER_UNAVAILABLE: ${name} is required`);
    }
  }
  const payload: SpatialLayerUnavailablePayloadV1 = {
    contract_version: SPATIAL_LAYER_UNAVAILABLE_CONTRACT_VERSION_V1,
    layer_ref: {
      layer_id: input.layer_id,
      version_hash: input.version_hash,
      layer_version: input.layer_version,
    },
    provider: input.provider,
    query_contract: input.query_contract,
    cause: { kind: SPATIAL_LAYER_UNAVAILABLE_CAUSE_QUERY_EXECUTION_FAILED, reason: input.reason },
  };
  const references = subjectReferences(input.query_contract);
  const { content_hash, artifact_id } = identityOf(payload, references);
  return { artifact_id, artifact_type: SPATIAL_LAYER_UNAVAILABLE, content_hash, references, payload };
}

/**
 * Independent self-consistency check: the stored hash and id must be re-derivable from the
 * artifact's own payload and references, and the payload must be the v1 shape. A stored hash is
 * never trusted merely because it is present.
 */
export function isSpatialLayerUnavailableEvidenceValid(artifact: unknown): artifact is SpatialLayerUnavailableArtifact {
  const candidate = artifact as Partial<SpatialLayerUnavailableArtifact> | null | undefined;
  if (!candidate || candidate.artifact_type !== SPATIAL_LAYER_UNAVAILABLE) return false;
  const payload = candidate.payload as SpatialLayerUnavailablePayloadV1 | undefined;
  if (
    !payload ||
    payload.contract_version !== SPATIAL_LAYER_UNAVAILABLE_CONTRACT_VERSION_V1 ||
    !nonEmpty(payload.layer_ref?.layer_id) ||
    !nonEmpty(payload.layer_ref?.version_hash) ||
    !nonEmpty(payload.provider) ||
    payload.cause?.kind !== SPATIAL_LAYER_UNAVAILABLE_CAUSE_QUERY_EXECUTION_FAILED ||
    !nonEmpty(payload.cause?.reason) ||
    !payload.query_contract?.subject ||
    !Array.isArray(candidate.references)
  ) {
    return false;
  }
  const { content_hash, artifact_id } = identityOf(payload, candidate.references);
  return (
    candidate.content_hash?.algorithm === content_hash.algorithm &&
    candidate.content_hash?.value === content_hash.value &&
    candidate.artifact_id === artifact_id
  );
}

/** The rule-engine input a pinned cause stands for, with the reference the NOT_CHECKED finding cites. */
export function toSpatialLayerUnavailable(artifact: SpatialLayerUnavailableArtifact): SpatialLayerUnavailable {
  return {
    dataset: artifact.payload.layer_ref.layer_id,
    reason: artifact.payload.cause.reason,
    evidence_ref: { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type },
  };
}
