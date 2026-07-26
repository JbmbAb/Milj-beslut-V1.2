"""Rerank client — Vertex, HTTP, mock with retries, latency breakdown, persistent cache."""

from __future__ import annotations

import hashlib
import json
import os
import random
import time
import urllib.error
import urllib.request
from typing import Any

from cache import PersistentCache, build_cache_key, candidate_hash
from rerank_types import LatencyBreakdown, RerankResponse

DEFAULT_TEMPLATE = (
    'Du är en expert på svensk miljö- och fastighetsanalys. Gradera relevansen för '
    'följande textavsnitt i förhållande till sökfrågan: "{{QUERY}}".\n'
    'Returnera en JSON-array med relevanspoäng (mellan 0.0 och 1.0) för varje ID '
    'i exakt samma ordning.\n'
    'Exempelformat: [{"id": "chunk-1", "score": 0.95}]\n\n'
    'Dokumentavsnitt:\n{{DOCUMENTS}}'
)

DEFAULT_INPUT_USD_PER_TOKEN = 0.075 / 1_000_000
DEFAULT_OUTPUT_USD_PER_TOKEN = 0.30 / 1_000_000

RETRYABLE_HTTP_CODES = {500, 502, 503, 504}


def render_prompt(template: str, query: str, candidates: list[dict[str, Any]]) -> str:
    documents_text = '\n\n'.join(
        f"ID: {c['id']}\nText: {c.get('chunkText') or c.get('text', '')}" for c in candidates
    )
    formatted = template.replace('{{QUERY}}', query).replace('${query}', query)
    if '{{DOCUMENTS}}' in formatted:
        return formatted.replace('{{DOCUMENTS}}', documents_text)
    if '${documents}' in formatted:
        return formatted.replace('${documents}', documents_text)
    return formatted + '\n\n' + documents_text


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _parse_scores(payload: Any) -> list[dict[str, Any]] | None:
    if not isinstance(payload, list):
        return None
    rows: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            return None
        if not isinstance(item.get('id'), str) or not isinstance(item.get('score'), (int, float)):
            return None
        rows.append({'id': item['id'], 'score': float(item['score'])})
    return rows


def _is_retryable(err: Exception) -> bool:
    if isinstance(err, TimeoutError):
        return True
    if isinstance(err, urllib.error.URLError):
        return True
    if isinstance(err, urllib.error.HTTPError):
        return err.code in RETRYABLE_HTTP_CODES
    if isinstance(err, (ConnectionError, OSError)):
        return True
    return False


class RerankClient:
    """Calls Vertex, HTTP eval endpoint, or mock — retries and cache live here."""

    RERANKER_VERSION = os.environ.get('RERANKER_VERSION', '1.0.0')

    def __init__(
        self,
        *,
        mode: str | None = None,
        project_id: str | None = None,
        location: str | None = None,
        model: str | None = None,
        http_url: str | None = None,
        max_retries: int | None = None,
        base_delay_ms: int | None = None,
        persistent_cache: PersistentCache | None = None,
    ) -> None:
        self.mode = (mode or os.environ.get('RERANK_CLIENT_MODE', 'auto')).lower()
        self.project_id = project_id or os.environ.get('VERTEX_PROJECT_ID', '')
        self.location = location or os.environ.get('VERTEX_LOCATION', 'europe-west1')
        self.model_name = model or os.environ.get('VERTEX_FAST_MODEL', 'gemini-1.5-flash')
        self.http_url = (http_url or os.environ.get('LEGAL_RERANK_EVAL_URL', '')).strip()
        self.max_retries = max_retries if max_retries is not None else int(os.environ.get('RERANK_MAX_RETRIES', '3'))
        self.base_delay_ms = base_delay_ms if base_delay_ms is not None else int(os.environ.get('RERANK_BASE_DELAY_MS', '200'))
        self.input_usd = float(os.environ.get('VERTEX_INPUT_USD_PER_TOKEN', DEFAULT_INPUT_USD_PER_TOKEN))
        self.output_usd = float(os.environ.get('VERTEX_OUTPUT_USD_PER_TOKEN', DEFAULT_OUTPUT_USD_PER_TOKEN))
        self.persistent_cache = persistent_cache or PersistentCache()
        self._vertex_model = None
        self.reranker_version = f'{self.RERANKER_VERSION}:{self.mode}:{self.model_name}'

        if self.mode == 'auto':
            if os.environ.get('MOCK_RERANK', '').lower() in ('1', 'true', 'yes'):
                self.mode = 'mock'
            elif self.http_url:
                self.mode = 'http'
            elif self.project_id:
                self.mode = 'vertex'
            else:
                self.mode = 'mock'

    def _prompt_hash(self, prompt_template: str) -> str:
        return hashlib.sha256(prompt_template.encode('utf-8')).hexdigest()[:16]

    def _token_cost(self, input_tokens: int, output_tokens: int) -> float:
        return input_tokens * self.input_usd + output_tokens * self.output_usd

    def _init_vertex(self) -> None:
        if self._vertex_model is not None:
            return
        import vertexai
        from vertexai.generative_models import GenerativeModel

        vertexai.init(project=self.project_id, location=self.location)
        self._vertex_model = GenerativeModel(self.model_name)

    def _call_vertex(self, prompt: str, latency: LatencyBreakdown) -> tuple[list[dict[str, Any]], int, int]:
        from vertexai.generative_models import GenerationConfig

        t0 = time.perf_counter()
        self._init_vertex()
        latency.serialization_ms = (time.perf_counter() - t0) * 1000

        assert self._vertex_model is not None
        t_model = time.perf_counter()
        response = self._vertex_model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                temperature=0.1,
                max_output_tokens=4096,
                response_mime_type='application/json',
            ),
        )
        latency.model_ms = (time.perf_counter() - t_model) * 1000

        t_deser = time.perf_counter()
        text = response.text or '[]'
        scores = _parse_scores(json.loads(text))
        if scores is None:
            raise ValueError('Vertex returned invalid rerank JSON')
        input_tokens = _estimate_tokens(prompt)
        output_tokens = _estimate_tokens(text)
        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            input_tokens = int(getattr(response.usage_metadata, 'prompt_token_count', input_tokens) or input_tokens)
            output_tokens = int(
                getattr(response.usage_metadata, 'candidates_token_count', output_tokens) or output_tokens
            )
        latency.deserialization_ms = (time.perf_counter() - t_deser) * 1000
        return scores, input_tokens, output_tokens

    def _call_http(self, body_bytes: bytes, latency: LatencyBreakdown, timeout: float) -> tuple[list[dict[str, Any]], int, int]:
        req = urllib.request.Request(
            self.http_url,
            data=body_bytes,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        t_http = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw_bytes = resp.read()
        except urllib.error.HTTPError as err:
            if err.code in RETRYABLE_HTTP_CODES:
                raise
            raise ValueError(f'HTTP {err.code}: {err.reason}') from err
        latency.http_ms = (time.perf_counter() - t_http) * 1000

        t_deser = time.perf_counter()
        raw = json.loads(raw_bytes.decode('utf-8'))
        items = raw.get('items') or raw.get('results') or []
        scores = _parse_scores(items)
        if scores is None:
            raise ValueError('HTTP rerank returned invalid JSON')
        input_tokens = int(raw.get('input_tokens', _estimate_tokens(body_bytes.decode('utf-8'))))
        output_tokens = int(raw.get('output_tokens', _estimate_tokens(json.dumps(items))))
        latency.deserialization_ms = (time.perf_counter() - t_deser) * 1000
        return scores, input_tokens, output_tokens

    def _call_mock(self, query: str, candidates: list[dict[str, Any]], prompt_template: str, latency: LatencyBreakdown) -> tuple[list[dict[str, Any]], int, int]:
        t0 = time.perf_counter()
        prompt = render_prompt(prompt_template, query, candidates)
        latency.serialization_ms = (time.perf_counter() - t0) * 1000

        t_model = time.perf_counter()
        query_terms = [t for t in query.lower().split() if len(t) > 2]
        scored = []
        for c in candidates:
            text = (c.get('chunkText') or c.get('text', '')).lower()
            matches = sum(1 for t in query_terms if t in text)
            template_bias = (sum(ord(ch) for ch in prompt_template[:80]) % 13) / 1000.0
            scored.append({'id': c['id'], 'score': float(c.get('score', 0.5)) + matches * 0.08 + template_bias})
        scored.sort(key=lambda row: row['score'], reverse=True)
        latency.model_ms = (time.perf_counter() - t_model) * 1000

        t_deser = time.perf_counter()
        out = json.dumps(scored)
        latency.deserialization_ms = (time.perf_counter() - t_deser) * 1000
        return scored, _estimate_tokens(prompt), _estimate_tokens(out)

    def rerank(
        self,
        *,
        query: str,
        candidates: list[dict[str, Any]],
        prompt_template: str,
        query_id: str = '',
        variant_id: str = '',
        timeout: float = 6.0,
        queue_ms: float = 0.0,
    ) -> RerankResponse:
        prompt_hash = self._prompt_hash(prompt_template)
        cand_hash = candidate_hash(candidates)
        cache_key = build_cache_key(
            prompt_hash=prompt_hash,
            query_id=query_id or hashlib.sha256(query.encode()).hexdigest()[:12],
            candidate_hash=cand_hash,
            reranker_version=self.reranker_version,
        )

        cached = self.persistent_cache.get(cache_key)
        if cached is not None:
            return RerankResponse(
                items=cached['ranking'],
                token_cost=cached['cost_usd'],
                input_tokens=cached['tokens_in'],
                output_tokens=cached['tokens_out'],
                engine=cached.get('engine', self.mode),
                latency=LatencyBreakdown(**{k: v for k, v in cached['latency'].items() if k.endswith('_ms')}),
                cached=True,
            )

        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            latency = LatencyBreakdown(queue_ms=queue_ms)
            t_total = time.perf_counter()
            try:
                if self.mode == 'vertex':
                    prompt = render_prompt(prompt_template, query, candidates)
                    scores, in_tok, out_tok = self._call_vertex(prompt, latency)
                    engine = 'vertex'
                elif self.mode == 'http':
                    t_ser = time.perf_counter()
                    body = json.dumps({'query': query, 'candidates': candidates, 'promptTemplate': prompt_template}).encode('utf-8')
                    latency.serialization_ms = (time.perf_counter() - t_ser) * 1000
                    scores, in_tok, out_tok = self._call_http(body, latency, timeout)
                    engine = 'http'
                else:
                    scores, in_tok, out_tok = self._call_mock(query, candidates, prompt_template, latency)
                    engine = 'mock'

                latency.total_ms = (time.perf_counter() - t_total) * 1000
                result = RerankResponse(
                    items=scores,
                    token_cost=self._token_cost(in_tok, out_tok),
                    input_tokens=in_tok,
                    output_tokens=out_tok,
                    engine=engine,
                    latency=latency,
                    cached=False,
                )

                self.persistent_cache.put(
                    cache_key,
                    prompt_hash=prompt_hash,
                    query_id=query_id,
                    candidate_hash=cand_hash,
                    reranker_version=self.reranker_version,
                    variant_id=variant_id,
                    ranking=scores,
                    latency=latency.to_dict(),
                    tokens_in=in_tok,
                    tokens_out=out_tok,
                    cost_usd=result.token_cost,
                    engine=engine,
                )
                return result
            except Exception as err:
                last_error = err
                if not _is_retryable(err) or attempt >= self.max_retries:
                    break
                delay = (self.base_delay_ms / 1000.0) * (2**attempt) + random.uniform(0, 0.05)
                time.sleep(min(delay, timeout))

        raise RuntimeError(f'Rerank failed after {self.max_retries + 1} attempts: {last_error}')
