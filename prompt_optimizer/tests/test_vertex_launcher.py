"""Tests for Vertex SDK job launcher (scripts/vertex_prompt_optimize.py)."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Repo root on path for scripts import
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(REPO_ROOT, 'scripts'))


class VertexPromptOptimizeTest(unittest.TestCase):
    @patch('vertex_prompt_optimize.aiplatform')
    def test_launch_builds_gcs_paths(self, mock_aiplatform: MagicMock) -> None:
        import vertex_prompt_optimize as launcher

        mock_job = MagicMock()
        mock_aiplatform.CustomJob.return_value = mock_job

        launcher.launch_prompt_optimization_job(
            project_id='test-project',
            bucket_uri='gs://my-bucket/staging',
            container_image='gcr.io/test/prompt-optimizer:latest',
            location='europe-west1',
        )

        mock_aiplatform.init.assert_called_once_with(project='test-project', location='europe-west1')
        call_kwargs = mock_aiplatform.CustomJob.call_args.kwargs
        specs = call_kwargs['worker_pool_specs']
        args = specs[0]['container_spec']['args']
        self.assertTrue(any('golden_v1_2000_records.jsonl' in arg for arg in args))
        self.assertTrue(any('prompt_opt_results' in arg for arg in args))
        mock_job.run.assert_called_once_with(sync=True)

    @patch('vertex_prompt_optimize.aiplatform')
    def test_launch_strips_gs_prefix_from_bucket(self, mock_aiplatform: MagicMock) -> None:
        import vertex_prompt_optimize as launcher

        mock_job = MagicMock()
        mock_aiplatform.CustomJob.return_value = mock_job

        launcher.launch_prompt_optimization_job(
            project_id='p',
            bucket_uri='gs://only-bucket',
            container_image='gcr.io/x/y:1',
            location='us-central1',
        )

        staging = mock_aiplatform.CustomJob.call_args.kwargs['staging_bucket']
        self.assertEqual(staging, 'gs://only-bucket/staging')

    def test_main_requires_project_bucket_container(self) -> None:
        import vertex_prompt_optimize as launcher

        with patch.object(sys, 'argv', ['vertex_prompt_optimize.py']):
            with self.assertRaises(SystemExit):
                launcher.main()


if __name__ == '__main__':
    unittest.main()
