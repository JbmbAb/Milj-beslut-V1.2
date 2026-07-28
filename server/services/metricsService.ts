/**
 * metricsService.ts
 *
 * Prometheus-kompatibel metrics-tjänst för produktionsövervakning.
 * Exponerar GET /metrics i Prometheus text-format (exposition format 0.0.4).
 */

import { prisma } from '../db/prisma';

// ─── In-process counters & histograms ─────────────────────────────────────────

interface Counter {
  value: number;
  labels: Record<string, string>;
}

const _counters = new Map<string, Counter>();
const _histograms = new Map<string, number[]>();
const _startTime = Date.now();
let _activeRequests = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function counterKey(name: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `${name}{${labelStr}}`;
}

function incCounter(name: string, labels: Record<string, string> = {}, delta = 1): void {
  const key = counterKey(name, labels);
  const existing = _counters.get(key);
  if (existing) {
    existing.value += delta;
  } else {
    _counters.set(key, { value: delta, labels });
  }
}

function observeHistogram(name: string, value: number): void {
  if (!_histograms.has(name)) _histograms.set(name, []);
  const arr = _histograms.get(name)!;
  arr.push(value);
  if (arr.length > 10_000) arr.splice(0, arr.length - 10_000);
}

// ─── Public recording API ─────────────────────────────────────────────────────

// Gauge: active_requests
export function incrementActiveRequests(): void {
  _activeRequests++;
}

export function decrementActiveRequests(): void {
  _activeRequests--;
}

// Counters: request_total, error_total, db_query_total, cache_hits_total, cache_misses_total
export function recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
  // Legacy counter
  incCounter('http_requests_total', { method, route, status: String(statusCode) });
  observeHistogram('http_request_duration_ms', durationMs);

  // MVP counter
  incCounter('request_total', { method, route, status: String(statusCode) });
}

export function recordError(type: string): void {
  // Legacy counter
  incCounter('app_errors_total', { type });

  // MVP counter
  incCounter('error_total', { type });
}

export function recordDbQuery(operation: string, durationMs: number, failed = false): void {
  // Legacy counter
  incCounter('db_queries_total', { operation, failed: String(failed) });
  observeHistogram('db_query_duration_ms', durationMs);

  // MVP counter
  incCounter('db_query_total', { operation, failed: String(failed) });
}

export function recordCacheHit(cache: string = 'default'): void {
  incCounter('cache_hits_total', { cache });
}

export function recordCacheMiss(cache: string = 'default'): void {
  incCounter('cache_misses_total', { cache });
}

// Histograms: retrieval_duration_ms, rerank_duration_ms, llm_duration_ms, total_duration_ms
export function recordRetrievalDuration(durationMs: number): void {
  observeHistogram('retrieval_duration_ms', durationMs);
}

export function recordRerankDuration(durationMs: number): void {
  observeHistogram('rerank_duration_ms', durationMs);
}

export function recordLlmDuration(durationMs: number): void {
  observeHistogram('llm_duration_ms', durationMs);
}

export function recordTotalDuration(durationMs: number): void {
  observeHistogram('total_duration_ms', durationMs);
}

// Document metrics: retrieved_documents, reranked_documents
export function recordRetrievedDocuments(count: number): void {
  incCounter('retrieved_documents', {}, count);
}

export function recordRerankedDocuments(count: number): void {
  incCounter('reranked_documents', {}, count);
}

// LLM metrics: input_tokens, output_tokens, cost_usd
export function recordLlmTokens(inputTokens: number, outputTokens: number, costUsd: number): void {
  incCounter('input_tokens', {}, inputTokens);
  incCounter('output_tokens', {}, outputTokens);
  incCounter('cost_usd', {}, costUsd);
}

// ─── Prometheus text generation ───────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, idx)] * 10) / 10;
}

async function collectBusinessMetrics(): Promise<string> {
  const lines: string[] = [];

  try {
    const [projectCount, docCount, userCount, orgCount] = await Promise.all([
      prisma.project.count(),
      prisma.documentRecord.count(),
      prisma.user.count(),
      prisma.organisation.count(),
    ]);

    lines.push('# HELP miljobeslut_projects_total Total number of projects');
    lines.push('# TYPE miljobeslut_projects_total gauge');
    lines.push(`miljobeslut_projects_total ${projectCount}`);

    lines.push('# HELP miljobeslut_documents_total Total number of documents');
    lines.push('# TYPE miljobeslut_documents_total gauge');
    lines.push(`miljobeslut_documents_total ${docCount}`);

    lines.push('# HELP miljobeslut_users_total Total registered users');
    lines.push('# TYPE miljobeslut_users_total gauge');
    lines.push(`miljobeslut_users_total ${userCount}`);

    lines.push('# HELP miljobeslut_organisations_total Total organisations');
    lines.push('# TYPE miljobeslut_organisations_total gauge');
    lines.push(`miljobeslut_organisations_total ${orgCount}`);
  } catch {
    lines.push('# ERROR could not collect business metrics from DB');
  }

  return lines.join('\n');
}

/**
 * Exportera alla mätvärden i Prometheus text format.
 */
export async function getMetricsText(): Promise<string> {
  const lines: string[] = [];

  // Process uptime
  const uptimeS = Math.round((Date.now() - _startTime) / 1000);
  lines.push('# HELP process_uptime_seconds Process uptime in seconds');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${uptimeS}`);

  // Node.js memory
  const mem = process.memoryUsage();
  lines.push('# HELP nodejs_heap_used_bytes V8 heap used');
  lines.push('# TYPE nodejs_heap_used_bytes gauge');
  lines.push(`node_heap_used_bytes ${mem.heapUsed}`);

  // Counter: request_total
  lines.push('# HELP request_total Total requests processed');
  lines.push('# TYPE request_total counter');
  let hasRequestTotal = false;
  for (const [key, c] of _counters) {
    if (key.startsWith('request_total')) {
      lines.push(`${key} ${c.value}`);
      hasRequestTotal = true;
    }
  }
  if (!hasRequestTotal) {
    lines.push('request_total 0');
  }

  // Counter: error_total
  lines.push('# HELP error_total Total application errors');
  lines.push('# TYPE error_total counter');
  let hasErrorTotal = false;
  for (const [key, c] of _counters) {
    if (key.startsWith('error_total')) {
      lines.push(`${key} ${c.value}`);
      hasErrorTotal = true;
    }
  }
  if (!hasErrorTotal) {
    lines.push('error_total 0');
  }

  // Counter: db_query_total
  lines.push('# HELP db_query_total Total DB queries executed');
  lines.push('# TYPE db_query_total counter');
  let hasDbQueryTotal = false;
  for (const [key, c] of _counters) {
    if (key.startsWith('db_query_total')) {
      lines.push(`${key} ${c.value}`);
      hasDbQueryTotal = true;
    }
  }
  if (!hasDbQueryTotal) {
    lines.push('db_query_total 0');
  }

  // Counter: cache_hits_total
  lines.push('# HELP cache_hits_total Total cache hits');
  lines.push('# TYPE cache_hits_total counter');
  let hasCacheHits = false;
  for (const [key, c] of _counters) {
    if (key.startsWith('cache_hits_total')) {
      lines.push(`${key} ${c.value}`);
      hasCacheHits = true;
    }
  }
  if (!hasCacheHits) {
    lines.push('cache_hits_total 0');
  }

  // Counter: cache_misses_total
  lines.push('# HELP cache_misses_total Total cache misses');
  lines.push('# TYPE cache_misses_total counter');
  let hasCacheMisses = false;
  for (const [key, c] of _counters) {
    if (key.startsWith('cache_misses_total')) {
      lines.push(`${key} ${c.value}`);
      hasCacheMisses = true;
    }
  }
  if (!hasCacheMisses) {
    lines.push('cache_misses_total 0');
  }

  // Histograms / Summaries: retrieval_duration_ms, rerank_duration_ms, llm_duration_ms, total_duration_ms
  const summaries = [
    { name: 'retrieval_duration_ms', help: 'Retrieval duration in milliseconds' },
    { name: 'rerank_duration_ms', help: 'Rerank duration in milliseconds' },
    { name: 'llm_duration_ms', help: 'LLM call duration in milliseconds' },
    { name: 'total_duration_ms', help: 'Total processing duration in milliseconds' },
  ];

  for (const s of summaries) {
    const arr = _histograms.get(s.name) ?? [];
    lines.push(`# HELP ${s.name} ${s.help}`);
    lines.push(`# TYPE ${s.name} summary`);
    lines.push(`${s.name}{quantile="0.5"} ${percentile(arr, 50)}`);
    lines.push(`${s.name}{quantile="0.9"} ${percentile(arr, 90)}`);
    lines.push(`${s.name}{quantile="0.99"} ${percentile(arr, 99)}`);
    lines.push(`${s.name}_count ${arr.length}`);
  }

  // Document metrics: retrieved_documents, reranked_documents
  lines.push('# HELP retrieved_documents Total number of retrieved documents');
  lines.push('# TYPE retrieved_documents counter');
  const retDocs = _counters.get('retrieved_documents{}')?.value ?? 0;
  lines.push(`retrieved_documents ${retDocs}`);

  lines.push('# HELP reranked_documents Total number of reranked documents');
  lines.push('# TYPE reranked_documents counter');
  const rerankDocs = _counters.get('reranked_documents{}')?.value ?? 0;
  lines.push(`reranked_documents ${rerankDocs}`);

  // LLM metrics: input_tokens, output_tokens, cost_usd
  lines.push('# HELP input_tokens Total LLM input tokens consumed');
  lines.push('# TYPE input_tokens counter');
  const inTokens = _counters.get('input_tokens{}')?.value ?? 0;
  lines.push(`input_tokens ${inTokens}`);

  lines.push('# HELP output_tokens Total LLM output tokens consumed');
  lines.push('# TYPE output_tokens counter');
  const outTokens = _counters.get('output_tokens{}')?.value ?? 0;
  lines.push(`output_tokens ${outTokens}`);

  lines.push('# HELP cost_usd Total estimated LLM cost in USD');
  lines.push('# TYPE cost_usd counter');
  const cost = _counters.get('cost_usd{}')?.value ?? 0;
  lines.push(`cost_usd ${cost}`);

  // Gauge: active_requests
  lines.push('# HELP active_requests Number of active concurrent requests');
  lines.push('# TYPE active_requests gauge');
  lines.push(`active_requests ${_activeRequests}`);

  // ──── Legacy HTTP/DB compatibility metrics ────
  lines.push('# HELP http_requests_total Total HTTP requests (legacy)');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('http_requests_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  const legacyReqDurations = _histograms.get('http_request_duration_ms') ?? [];
  lines.push('# HELP http_request_duration_ms HTTP request duration (legacy)');
  lines.push('# TYPE http_request_duration_ms summary');
  lines.push(`http_request_duration_ms{quantile="0.5"} ${percentile(legacyReqDurations, 50)}`);
  lines.push(`http_request_duration_ms{quantile="0.9"} ${percentile(legacyReqDurations, 90)}`);
  lines.push(`http_request_duration_ms{quantile="0.99"} ${percentile(legacyReqDurations, 99)}`);
  lines.push(`http_request_duration_ms_count ${legacyReqDurations.length}`);

  lines.push('# HELP db_queries_total Total DB queries (legacy)');
  lines.push('# TYPE db_queries_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('db_queries_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  lines.push('# HELP app_errors_total Total application errors (legacy)');
  lines.push('# TYPE app_errors_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('app_errors_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  // Business metrics from DB
  lines.push(await collectBusinessMetrics());

  return lines.join('\n') + '\n';
}
