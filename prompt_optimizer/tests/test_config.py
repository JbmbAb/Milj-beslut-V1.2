"""Unit tests for Config and manifest."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pydantic import ValidationError

from config import Config, reset_config_cache
from constants import CACHE_SCHEMA_VERSION, RESULTS_SCHEMA_VERSION
from manifest import build_manifest
from status import load_status, save_status


class ConfigTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_config_cache()

    def test_defaults(self) -> None:
        cfg = Config(
            max_workers=8,
            results_schema_version=1,
            cache_schema_version=1,
            _env_file=None,
        )
        self.assertEqual(cfg.max_workers, 8)
        self.assertEqual(cfg.results_schema_version, RESULTS_SCHEMA_VERSION)
        self.assertEqual(cfg.cache_schema_version, CACHE_SCHEMA_VERSION)
        self.assertEqual(cfg.seed, 42)
        self.assertEqual(cfg.requests_per_min, 120)

    def test_hard_failure_rate_validation(self) -> None:
        with self.assertRaises(ValidationError):
            Config(
                warning_failure_rate=0.05,
                hard_failure_rate=0.03,
                _env_file=None,
            )

    def test_hard_failure_rate_ok(self) -> None:
        cfg = Config(warning_failure_rate=0.02, hard_failure_rate=0.05, _env_file=None)
        self.assertEqual(cfg.hard_failure_rate, 0.05)


class ManifestTest(unittest.TestCase):
    def test_build_manifest_fields(self) -> None:
        cfg = Config(_env_file=None)
        manifest = build_manifest(
            cfg=cfg,
            golden_meta={
                "version": "v4",
                "sha256": "abc123",
                "n_queries": 100,
                "candidate_fingerprint": "cand_hash",
                "created": "2026-07-26T12:00:00Z",
                "split": "validation",
            },
            best={"variant_id": "v2", "prompt_hash": "phash"},
            reranker_version="1.0.0:http-async",
            engine="http-async",
        )
        self.assertEqual(manifest["results_schema_version"], 1)
        self.assertEqual(manifest["cache_schema_version"], 1)
        self.assertEqual(manifest["golden_dataset"]["version"], "v4")
        self.assertEqual(manifest["golden_dataset"]["candidate_set_hash"], "cand_hash")
        self.assertIn("python_version", manifest)
        self.assertIn("httpx_version", manifest)
        self.assertEqual(manifest["winner_variant_id"], "v2")


class StatusTest(unittest.TestCase):
    def test_save_and_load_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "status.json")
            os.environ["STATUS_FILE"] = path
            reset_config_cache()
            save_status({"status": "running", "processed_queries": 10})
            loaded = load_status()
            assert loaded is not None
            self.assertEqual(loaded["status"], "running")
            self.assertEqual(loaded["processed_queries"], 10)
            self.assertIn("updated", loaded)


if __name__ == "__main__":
    unittest.main()
