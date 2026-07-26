# Observability — OTLP / Cloud Trace (framtida PR)

Status: **planerad** — `@opentelemetry/api` är installerad; export till Cloud Trace kräver ytterligare setup.

## Nuvarande läge

- Spans skapas via [`server/lib/tracing.ts`](../../server/lib/tracing.ts) (`withSpan`, `legal-search` tracer)
- `@opentelemetry/api` — aktiv
- Ingen OTLP-exporter konfigurerad → spans når inte Cloud Trace ännu

## Nästa steg (separat PR)

1. Installera exporter:
   ```bash
   npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @google-cloud/opentelemetry-cloud-trace-exporter
   ```

2. Skapa `server/observability/otel.ts`:
   - Initiera `NodeSDK` vid serverstart (`server/index.ts`)
   - Exportera till Cloud Trace (projekt `miljointelligens`)
   - Propagera `traceparent` / koppla `RequestContext.traceId` till `X-Trace-Id`

3. Cloud Run env:
   ```
   OTEL_SERVICE_NAME=miljobeslut
   OTEL_TRACES_EXPORTER=google_cloud_trace
   GOOGLE_CLOUD_PROJECT=miljointelligens
   ```

## Cloud Monitoring dashboards (log-based metrics)

Skapa metrics från strukturerade loggar (`search.completed`):

| Metric | Filter |
|--------|--------|
| `legal_search_total_latency_p95` | `jsonPayload.totalLatencyMs` |
| `legal_search_shadow_changed_top1_rate` | `jsonPayload.shadowChangedTop1=true` |
| `legal_search_reranker_errors` | `jsonPayload.event="reranker.error"` |

## Alerts (rekommenderat)

- `totalLatencyMs` p95 > 3000 ms i 15 min
- `reranker.error` rate > 5 % / 15 min
- `shadowChangedTop1` rate > 50 % (oväntat hög — manuell granskning)

Se även [`legal-reranker-rollout.md`](legal-reranker-rollout.md).
