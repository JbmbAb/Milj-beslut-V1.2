"""Central configuration for prompt optimizer (Pydantic Settings)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    """Validated configuration with env/.env overrides."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    # Schema versions
    results_schema_version: int = Field(default=1, alias="RESULTS_SCHEMA_VERSION", ge=1)
    cache_schema_version: int = Field(default=1, alias="CACHE_SCHEMA_VERSION", ge=1)

    # Golden dataset metadata (optional override)
    golden_version: str | None = Field(default=None, alias="GOLDEN_DATASET_VERSION")
    golden_path: str | None = Field(default=None, alias="GOLDEN_PATH")
    golden_split: str = Field(default="validation", alias="GOLDEN_DATASET_SPLIT")
    golden_created: str | None = Field(default=None, alias="GOLDEN_DATASET_CREATED")

    # Concurrency and rate limits
    max_workers: int = Field(default=8, alias="MAX_CONCURRENT_QUERIES", ge=1)
    requests_per_min: int = Field(default=120, alias="MAX_REQUESTS_PER_MINUTE", ge=1)
    tokens_per_min: int = Field(default=400_000, alias="MAX_TOKENS_PER_MINUTE", ge=1)

    # Retry and timeouts
    rerank_timeout_s: float = Field(default=6.0, alias="RERANK_TIMEOUT", gt=0)
    retry_attempts: int = Field(default=4, alias="RERANK_MAX_RETRIES", ge=0)
    retry_backoff_multiplier: float = Field(
        default=0.5, alias="RERANK_BACKOFF_MULTIPLIER", gt=0
    )

    # Bootstrap / determinism
    bootstrap_samples: int = Field(default=1000, alias="BOOTSTRAP_SAMPLES", ge=1)
    seed: int = Field(default=42, alias="EVAL_SEED")

    # Failure budgets
    warning_failure_rate: float = Field(
        default=0.02, alias="WARNING_FAILURE_RATE", ge=0, le=1
    )
    hard_failure_rate: float = Field(
        default=0.05, alias="HARD_FAILURE_RATE", ge=0, le=1
    )

    # Paths and outputs
    cache_dir: str = Field(default=".", alias="CACHE_DIR")
    cache_path: str = Field(
        default="./rerank_eval_cache.sqlite", alias="RERANK_CACHE_PATH"
    )
    out_dir: str = Field(default="./out", alias="OUT_DIR")
    status_file: str = Field(default="./out/status.json", alias="STATUS_FILE")
    checkpoint_interval: int = Field(default=50, alias="CHECKPOINT_INTERVAL", ge=1)
    per_query_log_path: str | None = Field(default=None, alias="PER_QUERY_LOG_PATH")
    checkpoint_path: str | None = Field(default=None, alias="EVAL_CHECKPOINT_PATH")

    # Eval mode
    eval_mode: Literal["sync", "async"] = Field(default="sync", alias="EVAL_MODE")
    eval_ndcg_k: int = Field(default=10, alias="EVAL_NDCG_K", ge=1)

    # Budgets
    max_est_cost_usd: float | None = Field(default=None, alias="MAX_EST_COST_USD")
    latency_budget_p95_s: float | None = Field(
        default=None, alias="LATENCY_BUDGET_P95_S"
    )
    max_cost_per_query_usd: float | None = Field(
        default=None, alias="MAX_COST_PER_QUERY_USD"
    )

    # Misc
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    prompt_version: str = Field(default="1", alias="PROMPT_VERSION")
    git_commit: str | None = Field(default=None, alias="GIT_COMMIT")
    container_digest: str | None = Field(default=None, alias="CONTAINER_DIGEST")
    image_uri: str | None = Field(default=None, alias="IMAGE_URI")
    reranker_version: str = Field(default="1.0.0", alias="RERANKER_VERSION")

    @field_validator(
        "max_est_cost_usd",
        "latency_budget_p95_s",
        "max_cost_per_query_usd",
        mode="before",
    )
    @classmethod
    def empty_float_to_none(cls, value: object) -> object:
        if value in ("", "0", 0, 0.0):
            return None
        return value

    @model_validator(mode="after")
    def hard_failure_gte_warning(self) -> Config:
        if self.hard_failure_rate < self.warning_failure_rate:
            raise ValueError("HARD_FAILURE_RATE must be >= WARNING_FAILURE_RATE")
        return self

    def apply_to_environ(self) -> None:
        """Push config values into os.environ for legacy module reads."""
        import os

        mapping = {
            "CACHE_SCHEMA_VERSION": str(self.cache_schema_version),
            "RESULTS_SCHEMA_VERSION": str(self.results_schema_version),
            "MAX_CONCURRENT_QUERIES": str(self.max_workers),
            "MAX_REQUESTS_PER_MINUTE": str(self.requests_per_min),
            "MAX_TOKENS_PER_MINUTE": str(self.tokens_per_min),
            "RERANK_TIMEOUT": str(self.rerank_timeout_s),
            "RERANK_MAX_RETRIES": str(self.retry_attempts),
            "BOOTSTRAP_SAMPLES": str(self.bootstrap_samples),
            "EVAL_SEED": str(self.seed),
            "WARNING_FAILURE_RATE": str(self.warning_failure_rate),
            "HARD_FAILURE_RATE": str(self.hard_failure_rate),
            "CHECKPOINT_INTERVAL": str(self.checkpoint_interval),
            "EVAL_MODE": self.eval_mode,
            "EVAL_NDCG_K": str(self.eval_ndcg_k),
            "RERANK_CACHE_PATH": self.cache_path,
            "CACHE_DIR": self.cache_dir,
            "STATUS_FILE": self.status_file,
            "PROMPT_VERSION": self.prompt_version,
        }
        if self.golden_version:
            mapping["GOLDEN_DATASET_VERSION"] = self.golden_version
        if self.per_query_log_path:
            mapping["PER_QUERY_LOG_PATH"] = self.per_query_log_path
        if self.checkpoint_path:
            mapping["EVAL_CHECKPOINT_PATH"] = self.checkpoint_path
        if self.git_commit:
            mapping["GIT_COMMIT"] = self.git_commit
        if self.container_digest:
            mapping["CONTAINER_DIGEST"] = self.container_digest
        if self.image_uri:
            mapping["IMAGE_URI"] = self.image_uri
        for key, val in mapping.items():
            os.environ.setdefault(key, val)


@lru_cache(maxsize=1)
def get_config() -> Config:
    return Config()


def reset_config_cache() -> None:
    get_config.cache_clear()
