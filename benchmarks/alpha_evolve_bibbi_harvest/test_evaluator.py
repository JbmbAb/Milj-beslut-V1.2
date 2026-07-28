"""Tests for the Bibbi harvest orchestrator evaluator."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

import pytest

from evaluator import evaluate_program

INITIAL_CODE = open("initial_program.py", encoding="utf-8").read()
METRIC = "score"


def test_evaluate_program_returns_score_and_insights():
    result = evaluate_program(INITIAL_CODE)
    assert isinstance(result["score"], float)
    assert result["score"] > -1_000_000
    assert isinstance(result["insights"], list)


def test_evaluate_program_returns_error_insights_on_failure():
    result = evaluate_program("def !!!")
    assert result["score"] is None
    labels = {i["label"] for i in result["insights"]}
    assert "error" in labels


def test_evaluate_program_captures_stdout():
    code = f'print("hello")\n{INITIAL_CODE}'
    result = evaluate_program(code)
    stdout = [i for i in result["insights"] if i["label"] == "stdout"]
    assert len(stdout) >= 0


def test_cli_main_writes_output_file():
    tmpdir = tempfile.mkdtemp()
    try:
        for name in ("initial_program.py", "simulation.py", "evaluator.py"):
            shutil.copy(name, os.path.join(tmpdir, name))
        output_file = os.path.join(tmpdir, "scores.json")
        cmd = [
            sys.executable,
            "evaluator.py",
            "--output-file",
            output_file,
            "--program-dir",
            tmpdir,
        ]
        result = subprocess.run(cmd, cwd=tmpdir, capture_output=True, text=True, timeout=60, check=False)
        assert result.returncode == 0, f"stderr: {result.stderr}"
        with open(output_file, encoding="utf-8") as f:
            data = json.load(f)
        assert isinstance(data["score"], (int, float))
        assert "insights" in data
    finally:
        shutil.rmtree(tmpdir)
