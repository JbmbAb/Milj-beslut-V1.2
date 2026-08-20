"""Self-describing export attributes; never sidecar-only provenance."""

import json
from typing import Any, Mapping

from .contracts import ReadModelFeature, ReadModelFeatureCollection


EXPORT_CONTRACT_VERSION = "mimer-qgis-export-v1"


def export_attributes(collection: ReadModelFeatureCollection, feature: ReadModelFeature, export_id: str) -> Mapping[str, str]:
    source = feature.identity.get("source_namespace") or "DERIVED"
    dataset_version = feature.properties.get("dataset_version")
    observed_at = feature.properties.get("source_updated_at")
    provenance = {
        "export_contract_version": EXPORT_CONTRACT_VERSION,
        "export_id": export_id,
        "layer_id": collection.layer_id,
        "feature_ref": feature.feature_ref,
        "source_namespace": source,
        "dataset_version": dataset_version,
        "observed_at": observed_at,
        "provenance_status": collection.provenance_status,
        "identity": feature.identity,
    }
    return {
        "mimer_export_id": export_id,
        "mimer_layer_id": collection.layer_id,
        "mimer_feature_ref": feature.feature_ref,
        "mimer_dataset_version": "" if dataset_version is None else str(dataset_version),
        "mimer_provenance_status": collection.provenance_status,
        "mimer_provenance_json": json.dumps(provenance, sort_keys=True, separators=(",", ":")),
    }
