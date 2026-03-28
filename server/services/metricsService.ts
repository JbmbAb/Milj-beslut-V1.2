/**
 * metricsService.ts
 *
 * Prometheus-kompatibel metrics-tjänst för produktionsövervakning.
 *
 * Exponerar GET /metrics i Prometheus text-format (exposition format 0.0.4).
 * Mätvärden inkluderar:
 *   - HTTP request counters och latency histograms
 *   - Databas-pool utilization
 *   - Applikationshälsa
 *   - Affärsmätvärden (projekt, dokument, sökjobb)
 *
 * Användning:
 *   import { recordRequest, recordDbQuery, getMetricsText } from './metricsService';
 */

import { prisma } from '../db/prisma';

// ─── In-process counters ──────────────────────────────────────────────────────

interface Counter {
  value: number;
  labels: Record<string, string>;
}

const _counters = new Map<string, Counter>();
const _histograms = new Map<string, number[]>();
const _startTime = Date.now();

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

/**
 * Registrera ett inkommande HTTP-anrop.
 * Anropas automatiskt av requestLogger-middleware.
 */
export function recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
  incCounter('http_requests_total', { method, route, status: String(statusCode) });
  observeHistogram('http_request_duration_ms', durationMs);
}

/**
 * Registrera ett DB-anrop.
 */
export function recordDbQuery(operation: string, durationMs: number, failed = false): void {
  incCounter('db_queries_total', { operation, failed: String(failed) });
  observeHistogram('db_query_duration_ms', durationMs);
}

/**
 * Registrera ett applikationsfel.
 */
export function recordError(type: string): void {
  incCounter('app_errors_total', { type });
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
  lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);

  // HTTP counters
  lines.push('# HELP http_requests_total Total HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('http_requests_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  // HTTP latency
  const reqDurations = _histograms.get('http_request_duration_ms') ?? [];
  lines.push('# HELP http_request_duration_ms HTTP request duration');
  lines.push('# TYPE http_request_duration_ms summary');
  lines.push(`http_request_duration_ms{quantile="0.5"} ${percentile(reqDurations, 50)}`);
  lines.push(`http_request_duration_ms{quantile="0.9"} ${percentile(reqDurations, 90)}`);
  lines.push(`http_request_duration_ms{quantile="0.99"} ${percentile(reqDurations, 99)}`);
  lines.push(`http_request_duration_ms_count ${reqDurations.length}`);

  // DB counters
  lines.push('# HELP db_queries_total Total DB queries');
  lines.push('# TYPE db_queries_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('db_queries_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  // App errors
  lines.push('# HELP app_errors_total Total application errors');
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
