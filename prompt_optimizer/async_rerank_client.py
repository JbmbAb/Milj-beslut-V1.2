"""Async HTTP rerank client — httpx + tenacity retries + detailed timing."""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)

from cache import PersistentCache, build_cache_key, candidate_hash
from rerank_client import (
    DEFAULT_INPUT_USD_PER_TOKEN,
    DEFAULT_OUTPUT_USD_PER_TOKEN,
    _estimate_tokens,
    _parse_scores,
    render_prompt,
)
from rerank_types import LatencyBreakdown, RerankResponse

RETRYABLE_STATUS = {500, 502, 503, 504}


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TimeoutException):
        return True
    if isinstance(exc, httpx.TransportError):
        return True
    if (
        isinstance(exc, httpx.HTTPStatusError)
        and exc.response.status_code in RETRYABLE_STATUS
    ):
        return True
    return False


class AsyncRerankClient:
    """HTTP/2 async rerank client with retries, cache, and latency breakdown."""

    RERANKER_VERSION = os.environ.get("RERANKER_VERSION", "1.0.0")

    def __init__(
        self,
        *,
        http_url: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
        persistent_cache: PersistentCache | None = None,
        input_usd: float | None = None,
        output_usd: float | None = None,
    ) -> None:
        self.http_url = (
            http_url or os.environ.get("LEGAL_RERANK_EVAL_URL", "")
        ).strip()
        if not self.http_url:
            raise ValueError("AsyncRerankClient requires LEGAL_RERANK_EVAL_URL")
        self.timeout = timeout or float(os.environ.get("RERANK_TIMEOUT", "6"))
        self.max_retries = (
            max_retries
            if max_retries is not None
            else int(os.environ.get("RERANK_MAX_RETRIES", "4"))
        )
        self.persistent_cache = persistent_cache or PersistentCache()
        self.input_usd = input_usd or float(
            os.environ.get("VERTEX_INPUT_USD_PER_TOKEN", DEFAULT_INPUT_USD_PER_TOKEN)
        )
        self.output_usd = output_usd or float(
            os.environ.get("VERTEX_OUTPUT_USD_PER_TOKEN", DEFAULT_OUTPUT_USD_PER_TOKEN)
        )
        self.mode = "http-async"
        self.reranker_version = f"{self.RERANKER_VERSION}:{self.mode}"
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            try:
                self._client = httpx.AsyncClient(timeout=self.timeout, http2=True)
            except ImportError:
                self._client = httpx.AsyncClient(timeout=self.timeout, http2=False)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _prompt_hash(self, prompt_template: str) -> str:
        return hashlib.sha256(prompt_template.encode("utf-8")).hexdigest()[:16]

    def _token_cost(self, input_tokens: int, output_tokens: int) -> float:
        return input_tokens * self.input_usd + output_tokens * self.output_usd

    async def rerank(
        self,
        *,
        query: str,
        candidates: list[dict[str, Any]],
        prompt_template: str,
        query_id: str = "",
        variant_id: str = "",
        queue_ms: float = 0.0,
    ) -> RerankResponse:
        prompt_hash = self._prompt_hash(prompt_template)
        cand_hash = candidate_hash(candidates)
        qid = query_id or hashlib.sha256(query.encode()).hexdigest()[:12]
        cache_key = build_cache_key(
            prompt_hash=prompt_hash,
            query_id=qid,
            candidate_hash=cand_hash,
            reranker_version=self.reranker_version,
        )

        cached = self.persistent_cache.get(cache_key)
        if cached is not None:
            lat = LatencyBreakdown(
                **{k: v for k, v in cached["latency"].items() if k.endswith("_ms")}
            )
            return RerankResponse(
                items=cached["ranking"],
                token_cost=cached["cost_usd"],
                input_tokens=cached["tokens_in"],
                output_tokens=cached["tokens_out"],
                engine=cached.get("engine", self.mode),
                latency=lat,
                cached=True,
            )

        latency = LatencyBreakdown(queue_ms=queue_ms)
        t_total = time.perf_counter()

        t0 = time.perf_counter()
        payload = {
            "query": query,
            "candidates": candidates,
            "promptTemplate": prompt_template,
        }
        body = json.dumps(payload).encode("utf-8")
        latency.serialization_ms = (time.perf_counter() - t0) * 1000

        client = await self._get_client()
        data: dict[str, Any] = {}
        in_tok = _estimate_tokens(body.decode("utf-8"))
        out_tok = 0

        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(self.max_retries),
            wait=wait_exponential_jitter(multiplier=0.5, max=10),
            retry=retry_if_exception(_retryable),
            reraise=True,
        ):
            with attempt:
                t_http = time.perf_counter()
                resp = await client.post(
                    self.http_url,
                    content=body,
                    headers={"Content-Type": "application/json"},
                )
                latency.http_ms = (time.perf_counter() - t_http) * 1000
                resp.raise_for_status()

                t_deser = time.perf_counter()
                data = resp.json()
                items = data.get("items") or data.get("results") or []
                scores = _parse_scores(items)
                if scores is None:
                    raise ValueError("HTTP rerank returned invalid JSON")
                in_tok = int(data.get("input_tokens", in_tok))
                out_tok = int(
                    data.get("output_tokens", _estimate_tokens(json.dumps(items)))
                )
                latency.model_ms = float(data.get("model_ms", 0))
                latency.deserialization_ms = (time.perf_counter() - t_deser) * 1000

        latency.total_ms = (time.perf_counter() - t_total) * 1000
        result = RerankResponse(
            items=scores,
            token_cost=self._token_cost(in_tok, out_tok),
            input_tokens=in_tok,
            output_tokens=out_tok,
            engine=self.mode,
            latency=latency,
            cached=False,
        )

        self.persistent_cache.put(
            cache_key,
            prompt_hash=prompt_hash,
            query_id=qid,
            candidate_hash=cand_hash,
            reranker_version=self.reranker_version,
            variant_id=variant_id,
            ranking=scores,
            latency=latency.to_dict(),
            tokens_in=in_tok,
            tokens_out=out_tok,
            cost_usd=result.token_cost,
            engine=self.mode,
            prompt_version=os.environ.get("PROMPT_VERSION", "1"),
        )
        return result
