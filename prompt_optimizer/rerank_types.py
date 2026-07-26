"""Shared latency and response types for sync/async rerank clients."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class LatencyBreakdown:
    serialization_ms: float = 0.0
    queue_ms: float = 0.0
    http_ms: float = 0.0
    model_ms: float = 0.0
    deserialization_ms: float = 0.0
    total_ms: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "serialization_ms": round(self.serialization_ms, 3),
            "queue_ms": round(self.queue_ms, 3),
            "http_ms": round(self.http_ms, 3),
            "model_ms": round(self.model_ms, 3),
            "deserialization_ms": round(self.deserialization_ms, 3),
            "total_ms": round(self.total_ms, 3),
        }


@dataclass
class RerankResponse:
    items: list[dict[str, Any]]
    token_cost: float
    input_tokens: int
    output_tokens: int
    engine: str
    latency: LatencyBreakdown = field(default_factory=LatencyBreakdown)
    cached: bool = False
