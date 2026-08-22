import { createHash } from "node:crypto";
import { canonicalizeStrict } from "../../../mimers-brunn-core/src/serialization/canonicalize";
import {
  isSpatialEvidencePayloadV2,
  type AnySpatialEvidencePayload,
} from "./SpatialEvidenceArtifact";
import { assertGeometryMatchesSemantics } from "./SpatialResultSemantics";
import {
  assertExactEngineFingerprint,
  SPATIAL_STACK_COMPONENTS,
} from "./SpatialEngineFingerprint";

/**
 * Spatial evidence identity (TV-S1, SV-I02 / SV-I06).
 *
 * The canonical version is part of the hash domain, not metadata beside it, so two
 * canonicalization rules can never collapse into one identity. This is C-02 applied to
 * the spatial domain. The `sv-` namespace belongs to the Spatial Governance Domain.
 *
 * @see docs/architecture/TV-S1-Spatial-Verification-Layer.md
 */
export const SPATIAL_CANONICAL_VERSION = "sv-canonical-1" as const;
export const SPATIAL_CANONICAL_VERSION_V2 = "sv-canonical-2" as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function assertLayerVersionHash(versionHash: unknown): asserts versionHash is string {
  if (typeof versionHash !== "string" || !SHA256_HEX.test(versionHash)) {
    throw new Error(
      "REJECT_LAYER_VERSION_HASH: layer_ref.version_hash must be the 64-character lowercase " +
        "SHA-256 hash of the governed source/dataset artifact",
    );
  }
}

/**
 * Identity inputs only. Wall-clock time, host, and operator are provenance: including
 * them would mean an identical re-execution produces a different hash, i.e. replay could
 * never succeed (SV-I06).
 *
 * `query_id` is a correlation handle for one request, not semantic content, so it is
 * excluded as well — otherwise the same analysis run twice would not be recognisable as
 * the same evidence.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertSpatialQueryContractV2(payload: Extract<AnySpatialEvidencePayload, { readonly query_contract: unknown }>): void {
  const contract = payload.query_contract as unknown;
  if (!isRecord(contract) || !isRecord(contract.selection) || !isRecord(contract.subject) || !isRecord(contract.parameters)) {
    throw new Error("REJECT_SPATIAL_QUERY_CONTRACT_V2");
  }

  const subject = contract.subject;
  const parameters = contract.parameters;
  if (
    contract.query_contract_version !== "spatial-query-contract-v2" ||
    contract.relation !== "DWITHIN" ||
    contract.selection.predicate_semantics !== "EXISTS" ||
    subject.crs !== "EPSG:3006" ||
    !Number.isFinite(parameters.distance_meters) ||
    (parameters.distance_meters as number) < 0 ||
    !Number.isSafeInteger(parameters.max_features_per_layer) ||
    (parameters.max_features_per_layer as number) < 1 ||
    parameters.distance_meters !== payload.result_semantics.query.distance_meters ||
    parameters.max_features_per_layer !== payload.result_semantics.result.max_features_per_layer ||
    payload.result_semantics.query.srid !== 3006 ||
    payload.srid !== 3006 ||
    !isRecord(subject.property_context_ref) ||
    subject.property_context_ref.artifact_id !== payload.property_ref.artifact_id ||
    subject.property_context_ref.artifact_type !== payload.property_ref.artifact_type ||
    (subject.kind !== "LOCALIZATION_GEOMETRY" && subject.kind !== "PROPERTY_CONTEXT_CENTROID") ||
    (subject.kind === "LOCALIZATION_GEOMETRY" &&
      (!isRecord(subject.location_ref) ||
        subject.location_ref.artifact_type !== "LOCALIZATION_GEOMETRY" ||
        typeof subject.location_ref.artifact_id !== "string" ||
        subject.location_ref.artifact_id.length === 0))
  ) {
    throw new Error("REJECT_SPATIAL_QUERY_CONTRACT_V2");
  }
}

export function buildSpatialEvidenceIdentityPayload(
  payload: AnySpatialEvidencePayload,
): Record<string, unknown> {
  if (isSpatialEvidencePayloadV2(payload)) {
    assertSpatialQueryContractV2(payload);
    return {
      query_contract: payload.query_contract,
      result_semantics: {
        kind: payload.result_semantics.kind,
        query: {
          subject_ref: payload.result_semantics.query.subject_ref,
          srid: payload.result_semantics.query.srid,
          distance_meters: payload.result_semantics.query.distance_meters,
        },
        result: payload.result_semantics.result,
        ...(payload.result_semantics.witness ? { witness: payload.result_semantics.witness } : {}),
      },
      property_ref: payload.property_ref,
      layer_ref: { layer_id: payload.layer_ref.layer_id, version_hash: payload.layer_ref.version_hash },
      srid: payload.srid,
      operation: {
        algorithm: payload.operation.algorithm,
        engine: payload.operation.engine,
        engine_fingerprint: Object.fromEntries(
          SPATIAL_STACK_COMPONENTS.map((c) => [c, payload.operation.engine_fingerprint[c]]),
        ),
      },
      geometry: payload.geometry,
      source: {
        provider: payload.source_metadata.provider,
        dataset: payload.source_metadata.dataset,
        dataset_version: payload.source_metadata.dataset_version,
      },
    };
  }
  return {
    /**
     * P4A-LU-S6 — FROZEN PRINCIPLE: identity SHALL bind the declared result semantics.
     *
     * Without this, EXISTENCE_WITHIN_DISTANCE and SEARCH_BUFFER collapse into one identity when
     * their other inputs coincide, and introducing a new semantics later would silently
     * reinterpret evidence already produced instead of creating new evidence.
     *
     * Binding the semantics also binds `max_features_per_layer` (B1b): it is executed as a
     * SQL LIMIT and shapes the observable result, so it belongs inside the result, not in an
     * external budget block outside the identity domain.
     *
     * `witness` is included only when present — it is a computed part of the answer, but
     * canonical serialization forbids `undefined`.
     */
    result_semantics: {
      kind: payload.result_semantics.kind,
      query: {
        subject_ref: {
          artifact_id: payload.result_semantics.query.subject_ref.artifact_id,
          artifact_type: payload.result_semantics.query.subject_ref.artifact_type,
        },
        srid: payload.result_semantics.query.srid,
        distance_meters: payload.result_semantics.query.distance_meters,
      },
      result: {
        exists: payload.result_semantics.result.exists,
        match_count_observed: payload.result_semantics.result.match_count_observed,
        max_features_per_layer: payload.result_semantics.result.max_features_per_layer,
      },
      ...(payload.result_semantics.witness
        ? { witness: payload.result_semantics.witness }
        : {}),
    },
    property_ref: {
      artifact_id: payload.property_ref.artifact_id,
      artifact_type: payload.property_ref.artifact_type,
    },
    layer_ref: {
      layer_id: payload.layer_ref.layer_id,
      /**
       * P4A-LU-S4 — bind the authoritative dataset/layer content identity.
       *
       * `layer_version` remains available on the artifact as a readable label, but labels like
       * "v1" are not evidence identity. The hash is the registry/admission-controlled identity
       * of the materialized dataset version.
       */
      version_hash: payload.layer_ref.version_hash,
    },
    srid: payload.srid,
    operation: {
      algorithm: payload.operation.algorithm,
      engine: payload.operation.engine,
      /**
       * P4A-LU-S2 — the architecturally worst of the three fingerprint defects.
       *
       * The artifact carried `engine_fingerprint` while the identity bound only
       * `algorithm` + `engine`, so two artifacts computed on different execution stacks could
       * share an identity whenever their other inputs coincided. TV-S1 §5.2: substituting an
       * engine produces a NEW evidence identity, not an equal one.
       *
       * Component order is fixed rather than taken from object key order, so a producer that
       * happens to spell the fingerprint in a different order cannot mint a second identity
       * for the same stack.
       */
      engine_fingerprint: Object.fromEntries(
        SPATIAL_STACK_COMPONENTS.map((c) => [c, payload.operation.engine_fingerprint[c]]),
      ),
    },
    parameters: payload.query_context.parameters,
    query_type: payload.query_context.query_type,
    geometry: payload.geometry ? {
      type: payload.geometry.type,
      coordinates: payload.geometry.coordinates,
    } : null,
    source: {
      provider: payload.source_metadata.provider,
      dataset: payload.source_metadata.dataset,
      dataset_version: payload.source_metadata.dataset_version,
    },
  };
}

/**
 * artifact_hash = SHA256( spatial_canonical_version || "\n" || canonical_payload )
 */
export function computeSpatialEvidenceHash(payload: AnySpatialEvidencePayload): string {
  // S6 truthfulness, enforced at identity time so that a fabricated geometry cannot obtain an
  // identity at all. A later check somewhere downstream would arrive after the artifact is
  // already hashable, i.e. too late to be a barrier.
  assertGeometryMatchesSemantics(payload.result_semantics, payload.geometry);

  // S1/S3, enforced at the same barrier and for the same reason: a wildcard or partial
  // fingerprint must not be able to obtain an identity at all. "3.x" does not identify an
  // execution, so evidence pinned to it cannot be replayed against a known stack.
  assertExactEngineFingerprint(payload.operation.engine_fingerprint);

  // S4: labels, table names and import dates are not dataset identity. This must run before
  // hash construction so a label-only layer reference cannot obtain a spatial evidence identity.
  assertLayerVersionHash(payload.layer_ref.version_hash);

  const canonical = canonicalizeStrict(buildSpatialEvidenceIdentityPayload(payload));
  const canonicalVersion = isSpatialEvidencePayloadV2(payload)
    ? SPATIAL_CANONICAL_VERSION_V2
    : SPATIAL_CANONICAL_VERSION;
  return createHash("sha256")
    .update(`${canonicalVersion}\n${canonical}`, "utf8")
    .digest("hex");
}

export function buildSpatialEvidenceContentHash(payload: AnySpatialEvidencePayload): {
  readonly algorithm: "sha256";
  readonly value: string;
} {
  return { algorithm: "sha256", value: computeSpatialEvidenceHash(payload) };
}
