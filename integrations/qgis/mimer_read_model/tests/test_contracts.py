import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from mimer_read_model.contracts import ContractError, parse_feature_collection


def payload():
    ref = "rmf:v1:source:property:lm:123"
    return {
        "type": "FeatureCollection",
        "meta": {
            "presentation_kind": "read_model",
            "read_model_contract_version": "read-model-feature-collection-v1",
            "layer_id": "property",
            "provenance_status": "PARTIAL",
        },
        "features": [{
            "type": "Feature",
            "id": ref,
            "geometry": {"type": "Polygon", "coordinates": []},
            "properties": {"feature_ref": ref, "feature_identity": {"feature_ref": ref}},
        }],
    }


class ContractTests(unittest.TestCase):
    def test_accepts_matching_read_model_identity(self):
        collection = parse_feature_collection(payload(), "property")
        self.assertEqual(collection.features[0].feature_ref, "rmf:v1:source:property:lm:123")

    def test_rejects_a_non_read_model_response(self):
        invalid = payload()
        invalid["meta"]["presentation_kind"] = "assessment"
        with self.assertRaisesRegex(ContractError, "not_read_model"):
            parse_feature_collection(invalid, "property")

    def test_rejects_feature_identity_mismatch(self):
        invalid = payload()
        invalid["features"][0]["properties"]["feature_ref"] = "another-ref"
        with self.assertRaisesRegex(ContractError, "feature_ref_mismatch"):
            parse_feature_collection(invalid, "property")
