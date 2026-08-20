"""Prove live Mimer read-model APIs materialize as real PyQGIS features.

Run with QGIS's bundled Python while a local Mimer API is running. This proof
uses the plugin's catalog-resolving client; it never addresses a layer endpoint
directly.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile

from qgis.core import QgsApplication, QgsProject, QgsVectorLayer


PLUGIN_PARENT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_PARENT))

from mimer_read_model.client import MimerApiClient, PILOT_LAYERS  # noqa: E402
from mimer_read_model.qgis_bridge import add_read_model_layer, export_layer  # noqa: E402


CASES = (
    ("property", "18,59,19,60"),
    ("building", "13.369842376739209,59.74828550571406,13.612650806760216,59.875458548482506"),
    ("protected_nature", "14.13,55.75,14.16,55.78"),
)
PROOF_ROOT = Path(os.environ.get("MIMER_QGIS_LIVE_PROOF_ROOT", Path(tempfile.gettempdir()) / "mimer-qgis-live-api-proof"))
STATE_PATH = PROOF_ROOT / "expected.json"


def assert_reopen() -> None:
    expected = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    for layer_id, values in expected.items():
        for suffix in ("geojson", "gpkg"):
            destination = PROOF_ROOT / "exports" / f"{layer_id}.{suffix}"
            assert destination.exists(), f"QGIS_LIVE_REOPEN:{layer_id}:{suffix}:missing_export"
            source = str(destination) if suffix == "geojson" else f"{destination}|layername={layer_id}"
            reopened = QgsVectorLayer(source, f"reopened-{layer_id}", "ogr")
            assert reopened.isValid(), f"QGIS_LIVE_REOPEN:{layer_id}:{suffix}:invalid"
            feature = next(reopened.getFeatures())
            assert feature["mimer_feature_ref"] == values["feature_ref"], (
                f"QGIS_LIVE_REOPEN:{layer_id}:{suffix}:feature_ref_lost"
            )
            assert feature["mimer_provenance_status"] == values["provenance_status"], (
                f"QGIS_LIVE_REOPEN:{layer_id}:{suffix}:provenance_lost"
            )
            assert feature["mimer_dataset_version"] in (None, ""), (
                f"QGIS_LIVE_REOPEN:{layer_id}:{suffix}:fabricated_dataset_version"
            )


def main() -> None:
    base_url = os.environ.get("MIMER_QGIS_API_BASE", "http://127.0.0.1:8788")
    reopen_only = "--reopen" in sys.argv
    app = QgsApplication([], True)
    app.initQgis()
    try:
        if reopen_only:
            assert_reopen()
            print(f"QGIS_LIVE_READ_MODEL_REOPEN_PROOF=PASS PROFILE={PROOF_ROOT}")
            return

        client = MimerApiClient(base_url)
        results: list[str] = []
        expected: dict[str, dict[str, str]] = {}
        export_root = PROOF_ROOT / "exports"
        export_root.mkdir(parents=True, exist_ok=True)
        for key, bbox in CASES:
            collection = client.fetch_layer(PILOT_LAYERS[key], bbox)
            assert collection.features, f"QGIS_LIVE_API:{key}:empty_collection"
            layer = add_read_model_layer(QgsProject.instance(), collection, collection.layer_id)
            assert isinstance(layer, QgsVectorLayer) and layer.isValid(), f"QGIS_LIVE_API:{key}:invalid_layer"
            feature = next(layer.getFeatures())
            feature_ref = str(feature["mimer_feature_ref"])
            if key == "building":
                assert feature_ref.startswith("topo10:byggnad:sha256:"), (
                    "QGIS_LIVE_API:building:source_version_scoped_identity_lost"
                )
            else:
                assert feature_ref.startswith("rmf:v1:"), f"QGIS_LIVE_API:{key}:feature_ref_lost"
            assert feature["mimer_provenance_status"] == collection.provenance_status, (
                f"QGIS_LIVE_API:{key}:provenance_lost"
            )
            for suffix in ("geojson", "gpkg"):
                error, message = export_layer(layer, str(export_root / f"{collection.layer_id}.{suffix}"))
                assert error == 0, f"QGIS_LIVE_API:{key}:{suffix}:export_failed:{message}"
            expected[collection.layer_id] = {
                "feature_ref": feature_ref,
                "provenance_status": collection.provenance_status,
            }
            results.append(f"{key}:{len(collection.features)}")
        STATE_PATH.write_text(json.dumps(expected, sort_keys=True), encoding="utf-8")
        print(f"QGIS_LIVE_READ_MODEL_PROOF=PASS API={base_url} FEATURES={','.join(results)}")
    finally:
        app.exitQgis()


if __name__ == "__main__":
    main()
