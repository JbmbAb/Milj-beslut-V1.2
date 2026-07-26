"""Smoke test for main.py CLI with mock rerank."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main as optimizer_main


class MainSmokeTest(unittest.TestCase):
    def test_main_mock_eval_writes_outputs(self) -> None:
        golden = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "benchmarks",
                "golden_v1_2000_records.jsonl",
            )
        )
        if not os.path.exists(golden):
            self.skipTest("golden dataset not available")

        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out")
            argv = [
                "main.py",
                "--input_data_path",
                golden,
                "--output_data_path",
                out,
                "--max_iterations",
                "1",
                "--max_records",
                "3",
                "--cache_path",
                os.path.join(tmp, "cache.sqlite"),
            ]
            with patch.object(sys, "argv", argv):
                os.environ["MOCK_RERANK"] = "1"
                os.environ["BOOTSTRAP_SAMPLES"] = "50"
                try:
                    code = optimizer_main.main()
                finally:
                    os.environ.pop("MOCK_RERANK", None)

            self.assertEqual(code, 0)
            summary_path = os.path.join(out, "results_summary.json")
            self.assertTrue(os.path.exists(summary_path))
            with open(summary_path, encoding="utf-8") as handle:
                summary = json.load(handle)
            self.assertIn("variants", summary)
            self.assertTrue(os.path.exists(os.path.join(out, "best_prompt.txt")))


if __name__ == "__main__":
    unittest.main()
