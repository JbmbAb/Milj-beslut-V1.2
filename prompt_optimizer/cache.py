"""Persistent SQLite cache for rerank evaluation — enables resume after interruption."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from typing import Any


CACHE_SCHEMA_VERSION = int(os.environ.get('CACHE_SCHEMA_VERSION', '1'))


def build_cache_key(
    *,
    prompt_hash: str,
    query_id: str,
    candidate_hash: str,
    reranker_version: str,
    schema_version: int | None = None,
) -> str:
    sv = schema_version if schema_version is not None else CACHE_SCHEMA_VERSION
    payload = f'{sv}|{prompt_hash}|{query_id}|{candidate_hash}|{reranker_version}'
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def candidate_hash(candidates: list[dict[str, Any]]) -> str:
    ids = sorted(str(c.get('id', '')) for c in candidates)
    return hashlib.sha256(json.dumps(ids, sort_keys=True).encode('utf-8')).hexdigest()[:16]


class PersistentCache:
    """Thread-safe SQLite cache for rerank results."""

    SCHEMA = """
    CREATE TABLE IF NOT EXISTS rerank_cache (
        cache_key TEXT PRIMARY KEY,
        prompt_hash TEXT NOT NULL,
        query_id TEXT NOT NULL,
        candidate_hash TEXT NOT NULL,
        reranker_version TEXT NOT NULL,
        variant_id TEXT,
        ranking_json TEXT NOT NULL,
        latency_json TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        engine TEXT,
        cached_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_variant_query ON rerank_cache(variant_id, query_id);
    """

    def __init__(self, db_path: str | None = None) -> None:
        default = os.path.join(os.environ.get('CACHE_DIR', '.'), 'rerank_eval_cache.sqlite')
        self.db_path = db_path or os.environ.get('RERANK_CACHE_PATH', default)
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(self.SCHEMA)
                conn.commit()
            finally:
                conn.close()

    def get(self, cache_key: str) -> dict[str, Any] | None:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    'SELECT * FROM rerank_cache WHERE cache_key = ?',
                    (cache_key,),
                ).fetchone()
                if row is None:
                    return None
                return {
                    'ranking': json.loads(row['ranking_json']),
                    'latency': json.loads(row['latency_json']),
                    'tokens_in': row['tokens_in'],
                    'tokens_out': row['tokens_out'],
                    'cost_usd': row['cost_usd'],
                    'engine': row['engine'],
                    'cached_at': row['cached_at'],
                }
            finally:
                conn.close()

    def put(
        self,
        cache_key: str,
        *,
        prompt_hash: str,
        query_id: str,
        candidate_hash: str,
        reranker_version: str,
        variant_id: str,
        ranking: list[dict[str, Any]],
        latency: dict[str, float],
        tokens_in: int,
        tokens_out: int,
        cost_usd: float,
        engine: str,
    ) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO rerank_cache
                    (cache_key, prompt_hash, query_id, candidate_hash, reranker_version,
                     variant_id, ranking_json, latency_json, tokens_in, tokens_out,
                     cost_usd, engine, cached_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        cache_key,
                        prompt_hash,
                        query_id,
                        candidate_hash,
                        reranker_version,
                        variant_id,
                        json.dumps(ranking),
                        json.dumps(latency),
                        tokens_in,
                        tokens_out,
                        cost_usd,
                        engine,
                        time.time(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def count_variant(self, variant_id: str) -> int:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    'SELECT COUNT(*) AS n FROM rerank_cache WHERE variant_id = ?',
                    (variant_id,),
                ).fetchone()
                return int(row['n']) if row else 0
            finally:
                conn.close()

    def list_cached_query_ids(self, variant_id: str, prompt_hash: str) -> set[str]:
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    'SELECT query_id FROM rerank_cache WHERE variant_id = ? AND prompt_hash = ?',
                    (variant_id, prompt_hash),
                ).fetchall()
                return {str(r['query_id']) for r in rows}
            finally:
                conn.close()
