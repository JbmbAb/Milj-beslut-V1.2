"""Client-neutral validation for the Mimer read-model feature contract."""

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


READ_MODEL_FEATURE_COLLECTION_VERSION = "read-model-feature-collection-v1"


class ContractError(ValueError):
    pass


@dataclass(frozen=True)
class ReadModelFeature:
    feature_ref: str
    identity: Mapping[str, Any]
    geometry: Mapping[str, Any]
    properties: Mapping[str, Any]


@dataclass(frozen=True)
class ReadModelFeatureCollection:
    layer_id: str
    provenance_status: str
    features: Sequence[ReadModelFeature]
    meta: Mapping[str, Any]


def parse_feature_collection(payload: Mapping[str, Any], expected_layer_id: str) -> ReadModelFeatureCollection:
    meta = payload.get("meta")
    if not isinstance(meta, Mapping):
        raise ContractError("READ_MODEL_CONTRACT:missing_meta")
    if meta.get("presentation_kind") != "read_model":
        raise ContractError("READ_MODEL_CONTRACT:not_read_model")
    if meta.get("read_model_contract_version") != READ_MODEL_FEATURE_COLLECTION_VERSION:
        raise ContractError("READ_MODEL_CONTRACT:unsupported_version")
    if meta.get("layer_id") != expected_layer_id:
        raise ContractError("READ_MODEL_CONTRACT:unexpected_layer")

    raw_features = payload.get("features")
    if payload.get("type") != "FeatureCollection" or not isinstance(raw_features, list):
        raise ContractError("READ_MODEL_CONTRACT:not_feature_collection")

    features = tuple(_parse_feature(feature) for feature in raw_features)
    return ReadModelFeatureCollection(
        layer_id=expected_layer_id,
        provenance_status=str(meta.get("provenance_status", "UNAVAILABLE")),
        features=features,
        meta=meta,
    )


def _parse_feature(feature: Any) -> ReadModelFeature:
    if not isinstance(feature, Mapping) or feature.get("type") != "Feature":
        raise ContractError("READ_MODEL_CONTRACT:invalid_feature")
    feature_ref = feature.get("id")
    geometry = feature.get("geometry")
    properties = feature.get("properties")
    if not isinstance(feature_ref, str) or not feature_ref:
        raise ContractError("READ_MODEL_CONTRACT:missing_feature_ref")
    if not isinstance(geometry, Mapping):
        raise ContractError("READ_MODEL_CONTRACT:missing_geometry")
    if not isinstance(properties, Mapping):
        raise ContractError("READ_MODEL_CONTRACT:missing_properties")
    if properties.get("feature_ref") != feature_ref:
        raise ContractError("READ_MODEL_CONTRACT:feature_ref_mismatch")
    identity = properties.get("feature_identity")
    if not isinstance(identity, Mapping):
        raise ContractError("READ_MODEL_CONTRACT:missing_identity")
    if identity.get("feature_ref") != feature_ref:
        raise ContractError("READ_MODEL_CONTRACT:identity_ref_mismatch")
    return ReadModelFeature(
        feature_ref=feature_ref,
        identity=identity,
        geometry=geometry,
        properties=properties,
    )
