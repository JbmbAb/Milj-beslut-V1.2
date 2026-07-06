/**
 * metrics.ts
 *
 * Prometheus-kompatibel mätningstjänst för Clean Architecture-lagret i src/.
 * Inkluderar realtidsberäkning av LLM-kostnad (Token Cost Tracking) för Gemini-anrop
 * samt svarstidsmätning för API:er och databasanrop.
 */

// ─── Token Pricing Structure (USD / 1M tokens) ──────────────────────────────────
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-2.0-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.075, output: 0.30 },
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
};

const DEFAULT_PRICING = { input: 0.075, output: 0.30 }; // Standard (Flash-nivå)

export interface LLMCallData {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  success: boolean;
}

interface Counter {
  value: number;
  labels: Record<string, string>;
}

// In-memory lagring för metrics (trådsäker inom processen)
const _counters = new Map<string, Counter>();
const _histograms = new Map<string, number[]>();
const _startTime = Date.now();

// Hjälpmetoder för mätvärden
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
  if (!_histograms.has(name)) {
    _histograms.set(name, []);
  }
  const arr = _histograms.get(name)!;
  arr.push(value);
  // Håll historiken till max 10 000 mätpunkter för att undvika minnesläckor
  if (arr.length > 10000) {
    arr.splice(0, arr.length - 10000);
  }
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, idx)] * 10) / 10;
}

// Realprisberäkning (USD) baserat på antal tokens
export function calculateLLMCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// ─── Offentligt API för registrering av mätvärden ──────────────────────────────────

/**
 * Registrera ett HTTP-anrop i applikationslagret.
 */
export function recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
  incCounter('http_requests_total', { method, route, status: String(statusCode) });
  observeHistogram('http_request_duration_ms', durationMs);
}

/**
 * Registrera ett databasanrop (PostGIS eller Prisma).
 */
export function recordDbQuery(operation: string, durationMs: number, failed = false): void {
  incCounter('db_queries_total', { operation, failed: String(failed) });
  observeHistogram('db_query_duration_ms', durationMs);
}

/**
 * Registrera ett internt fel.
 */
export function recordError(type: string): void {
  incCounter('app_errors_total', { type });
}

/**
 * Registrera ett generativt AI-anrop till Gemini via Vertex AI.
 * Beräknar automatiskt token-kostnad i realtid och sparar till Prometheus-mätvärden.
 */
export function recordLLMCall(data: LLMCallData): number {
  const cost = calculateLLMCost(data.model, data.inputTokens, data.outputTokens);
  
  // Registrera anrop och status
  incCounter('llm_calls_total', { model: data.model, success: String(data.success) });
  
  // Registrera token-förbrukning (fördelat på input/output)
  incCounter('llm_tokens_total', { model: data.model, type: 'input' }, data.inputTokens);
  incCounter('llm_tokens_total', { model: data.model, type: 'output' }, data.outputTokens);
  
  // Registrera ackumulerad kostnad i USD (vi multiplicerar med en faktor om Prometheus kräver heltal, men standard Prometheus stöder flyttal)
  incCounter('llm_cost_usd_total', { model: data.model }, cost);
  
  // Svarstidsmätning
  observeHistogram('llm_call_duration_ms', data.durationMs);

  return cost;
}

/**
 * Generera exporterbar text i Prometheus exposition format.
 */
export function getMetricsText(): string {
  const lines: string[] = [];

  // Drifttid (Uptime)
  const uptimeS = Math.round((Date.now() - _startTime) / 1000);
  lines.push('# HELP process_uptime_seconds Process uptime in seconds');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${uptimeS}`);

  // Minnesanvändning
  const mem = process.memoryUsage();
  lines.push('# HELP nodejs_heap_used_bytes V8 heap used');
  lines.push('# TYPE nodejs_heap_used_bytes gauge');
  lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);

  // HTTP-begäransräknare
  lines.push('# HELP http_requests_total Total HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('http_requests_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  // Svarstider för HTTP
  const reqDurations = _histograms.get('http_request_duration_ms') ?? [];
  lines.push('# HELP http_request_duration_ms HTTP request duration');
  lines.push('# TYPE http_request_duration_ms summary');
  lines.push(`http_request_duration_ms{quantile="0.5"} ${percentile(reqDurations, 50)}`);
  lines.push(`http_request_duration_ms{quantile="0.9"} ${percentile(reqDurations, 90)}`);
  lines.push(`http_request_duration_ms{quantile="0.99"} ${percentile(reqDurations, 99)}`);
  lines.push(`http_request_duration_ms_count ${reqDurations.length}`);

  // Databasfrågor
  lines.push('# HELP db_queries_total Total DB queries');
  lines.push('# TYPE db_queries_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('db_queries_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  // Applikationsfel
  lines.push('# HELP app_errors_total Total application errors');
  lines.push('# TYPE app_errors_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('app_errors_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  // ─── LLM Observability Metrics ──────────────────────────────────────────────────
  lines.push('# HELP llm_calls_total Total generative AI calls');
  lines.push('# TYPE llm_calls_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('llm_calls_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  lines.push('# HELP llm_tokens_total Total generative AI tokens consumed');
  lines.push('# TYPE llm_tokens_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('llm_tokens_total')) {
      lines.push(`${key} ${c.value}`);
    }
  }

  lines.push('# HELP llm_cost_usd_total Estimated LLM cost in USD');
  lines.push('# TYPE llm_cost_usd_total counter');
  for (const [key, c] of _counters) {
    if (key.startsWith('llm_cost_usd_total')) {
      // Formatera flyttal till en stabil precision (t.ex. 6 decimaler)
      lines.push(`${key} ${c.value.toFixed(6)}`);
    }
  }

  const llmDurations = _histograms.get('llm_call_duration_ms') ?? [];
  lines.push('# HELP llm_call_duration_ms Generative AI request duration');
  lines.push('# TYPE llm_call_duration_ms summary');
  lines.push(`llm_call_duration_ms{quantile="0.5"} ${percentile(llmDurations, 50)}`);
  lines.push(`llm_call_duration_ms{quantile="0.9"} ${percentile(llmDurations, 90)}`);
  lines.push(`llm_call_duration_ms{quantile="0.99"} ${percentile(llmDurations, 99)}`);
  lines.push(`llm_call_duration_ms_count ${llmDurations.length}`);

  return lines.join('\n') + '\n';
}

/**
 * Nollställer alla ackumulerade mätvärden (används primärt i tester).
 */
export function __resetMetrics(): void {
  _counters.clear();
  _histograms.clear();
}
