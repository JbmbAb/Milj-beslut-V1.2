import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from mimer_read_model.client import MimerApiClient, PILOT_LAYERS


class RecordingClient(MimerApiClient):
    def __init__(self, responses):
        super().__init__("https://mimer.example")
        self.responses = responses
        self.calls = []

    def _get_json(self, path, query=None):
        self.calls.append((path, query))
        return self.responses[path]


def collection(layer_id):
    feature_ref = f"rmf:v1:source:{layer_id}:source:1"
    return {
        "type": "FeatureCollection",
        "meta": {
            "presentation_kind": "read_model",
            "read_model_contract_version": "read-model-feature-collection-v1",
            "layer_id": layer_id,
            "provenance_status": "PARTIAL",
        },
        "features": [{
            "type": "Feature",
            "id": feature_ref,
            "geometry": {"type": "Polygon", "coordinates": []},
            "properties": {"feature_ref": feature_ref, "feature_identity": {"feature_ref": feature_ref}},
        }],
    }


class ClientTests(unittest.TestCase):
    def test_resolves_the_bbox_endpoint_from_the_published_catalog(self):
        client = RecordingClient({
            "/api/reference/map-layers": {"ok": True, "layers": [{
                "key": "postgis_property", "endpoint": "/api/layers/property", "bboxRequired": True,
            }]},
            "/api/layers/property": collection("property"),
        })

        loaded = client.fetch_layer(PILOT_LAYERS["property"], "10,20,11,21")

        self.assertEqual(loaded.layer_id, "property")
        self.assertEqual(client.calls, [
            ("/api/reference/map-layers", None),
            ("/api/layers/property", {"bbox": "10,20,11,21"}),
        ])

    def test_refuses_a_catalog_entry_without_a_bbox_contract(self):
        client = RecordingClient({
            "/api/reference/map-layers": {"ok": True, "layers": [{
                "key": "postgis_property", "endpoint": "/api/layers/property", "bboxRequired": "unknown",
            }]},
        })

        with self.assertRaisesRegex(ValueError, "invalid_catalog_bbox_contract"):
            client.fetch_layer(PILOT_LAYERS["property"], "10,20,11,21")
        self.assertEqual(client.calls, [("/api/reference/map-layers", None)])

    def test_every_plugin_layer_has_a_catalog_key_and_read_model_identity(self):
        expected = {
            "property": ("postgis_property", "property"),
            "building": ("topo10_buildings", "topo10-building"),
            "protected_nature": ("postgis_nvr", "protected-area"),
            "natura2000": ("natura2000_area", "natura2000-area"),
            "international_protection": ("international_protection", "international-protection"),
            "water_protection": ("water_protection", "water-protection"),
            "sgu_wells": ("sgu_brunnar_postgis", "sgu-well"),
            "sgu_permeability": ("sgu_genomslapplighet", "sgu-permeability"),
            "sgu_groundwater_magazines": ("sgu_groundwater_magazine", "sgu-groundwater-magazine"),
            "sgu_groundwater_bodies": ("sgu_groundwater_body", "sgu-groundwater-body"),
            "topo10_streams": ("postgis_streams", "topo10-stream"),
        }
        self.assertEqual(
            {name: (spec.catalog_key, spec.layer_id) for name, spec in PILOT_LAYERS.items()},
            expected,
        )
