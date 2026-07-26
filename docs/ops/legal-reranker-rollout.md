# Legal Reranker — rollout & review (vecka 3)

Status: **förberedelse** — staging/prod kräver human sign-off (AGENTS.md).

## Feature flags (staging → prod)

| Env | Staging (vecka 3) | Prod (efter review) |
|-----|-------------------|---------------------|
| `LEGAL_RERANKER` | `on` | `on` (begränsad rollout) |
| `LEGAL_RERANKER_RELATIVE_GAP` | `0.15` | `0.15` |
| `LEGAL_RERANKER_PROMPT_GCS` | `gs://miljobeslut-prompt-optimization-bucket/alphaevolve/list_deduplication/prompt_opt_results/best_prompt.txt` | samma |
| `LEGAL_RERANKER_PROMPT_VERSION` | `opt-prompt-d900aa00` (hash av prompt) | uppdateras vid ny prompt |
| `VERTEX_PROJECT_ID` | `miljointelligens` | samma |
| `VERTEX_LOCATION` | `europe-west1` | samma |

## Rollout-steg

1. **Staging deploy** med flaggor ovan (Cloud Run env).
2. Kör `tests/smoke/legal_rerank_staging.test.ts` mot staging-URL.
3. Fyll i [legal_rerank_prompt_review_TEMPLATE.md](../eval/legal_rerank_prompt_review_TEMPLATE.md).
4. Human sign-off (namn + datum i review-doc).
5. Prod: `LEGAL_RERANKER=on` för intern trafik / 10 % — övervaka 48 h.
6. Full prod efter grön telemetry.

## Rollback (< 5 min)

```powershell
# Cloud Run — stäng av reranker omedelbart
gcloud run services update SERVICE_NAME --region=REGION `
  --update-env-vars=LEGAL_RERANKER=off

# Eller återställ föregående prompt-version
# LEGAL_RERANKER_PROMPT_VERSION=<previous>
# LEGAL_RERANKER_PROMPT_GCS=gs://.../previous/best_prompt.txt
```

**Git-rollback** (om prompt committats i config):

```powershell
git revert <commit_hash>
git push
```

## Observability

Logga i Cloud Logging (platta fält i root):

| Fält | Beskrivning |
|------|-------------|
| `requestId` | Korrelations-ID (`X-Request-Id` header) |
| `queryHash` | Salted SHA-256 av normaliserad query (GDPR) |
| `queryHashSaltVersion` | Salt-rotation (`QUERY_HASH_SALT_VERSION`, default `v1`) |
| `exactLatencyMs` / `ftsLatencyMs` / `vectorLatencyMs` | Per-arm retrieval |
| `rrfLatencyMs` / `rerankLatencyMs` / `totalLatencyMs` | Fusion + rerank + totalt |
| `shadowChangedTop1` / `kendallTau` / `ndcg5` | Shadow validation |

Env:

| Env | Beskrivning |
|-----|-------------|
| `QUERY_HASH_SALT` | Secret Manager — rotera utan att logga värdet |
| `QUERY_HASH_SALT_VERSION` | Versionstagg i loggar vid rotation |

**Larm (rekommenderat):**

- Felrate Gemini rerank > 5 % / 15 min → auto `LEGAL_RERANKER=off` (manuellt tills Cloud Function finns)
- p95 latency searchLegalCorpus > 3 s

## PII-granskning av prompt

Innan prod: öppna `best_prompt.txt` i GCS och bekräfta:

- [ ] Ingen persondata (namn, personnummer, adresser)
- [ ] Ingen intern URL/credential
- [ ] Instruktionen är på svenska och domänkorrekt

## Relaterat

- [staging-observability-secrets.md](staging-observability-secrets.md) — `gcloud`-kommandon för QUERY_HASH_SALT + LEGAL_RERANKER=on
- [observability-otlp.md](observability-otlp.md) — framtida Cloud Trace / dashboards
- [legal_rerank_prompt_review_TEMPLATE.md](../eval/legal_rerank_prompt_review_TEMPLATE.md)
- [EXPERIMENTS.md](../alphaevolve/EXPERIMENTS.md)
- `scripts/eval/run_legal_rerank_eval.ts`
