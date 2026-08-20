import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


FORBIDDEN = (
    "/api/spatial/evidence",
    "SpatialEvidenceArtifact",
    "LocalizationAssessmentArtifact",
    "cas.put(",
    "ST_DWithin",
)


class BoundaryTests(unittest.TestCase):
    def test_plugin_source_contains_no_authority_or_raw_evidence_surface(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        sources = [path for path in root.glob("*.py") if path.name != "__init__.py"]
        violations = []
        for source in sources:
            text = source.read_text(encoding="utf-8")
            for token in FORBIDDEN:
                if token in text:
                    violations.append(f"{source.name}:{token}")
        self.assertEqual(violations, [])
