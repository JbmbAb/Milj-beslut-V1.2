import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from mimer_read_model.contracts import ReadModelFeature, ReadModelFeatureCollection
from mimer_read_model.export_metadata import export_attributes


class ExportMetadataTests(unittest.TestCase):
    def test_export_is_self_describing_when_dataset_version_is_unavailable(self):
        feature = ReadModelFeature(
            feature_ref="rmf:v1:source:topo10-building:topo10.byggnad:1",
            identity={"source_namespace": "topo10.byggnad"},
            geometry={"type": "Polygon", "coordinates": []},
            properties={},
        )
        collection = ReadModelFeatureCollection("topo10-building", "PARTIAL", [feature], {})
        metadata = export_attributes(collection, feature, "export-1")

        self.assertEqual(metadata["mimer_dataset_version"], "")
        payload = json.loads(metadata["mimer_provenance_json"])
        self.assertIsNone(payload["dataset_version"])
        self.assertEqual(payload["provenance_status"], "PARTIAL")
