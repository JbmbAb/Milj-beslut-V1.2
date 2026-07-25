# Legal Reranker — rollout & review (vecka 3)

Status: **förberedelse** — staging/prod kräver human sign-off (AGENTS.md).

## Feature flags (staging → prod)

| Env | Staging (vecka 3) | Prod (efter review) |
|-----|-------------------|---------------------|
| `LEGAL_RERANKER` | `on` | `on` (begränsad rollout) |
| `LEGAL_RERANKER_RELATIVE_GAP` | `0.15` | `0.15` |
| `LEGAL_RERANKER_PROMPT_GCS` | `gs://miljobeslut-prompt-optimization-bucket/alphaevolve/list_deduplication/prompt_opt_results/best_prompt.txt` | samma |
| `LEGAL_RERANKER_PROMPT_VERSION` | `opt-prompt-d900aa00` (hash av prompt) | uppdateras vid ny prompt |
| `GEMINI_API_KEY` | Secret Manager | Secret Manager |

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

Logga i Cloud Logging:

- `LEGAL_RERANKER: kör Gemini rerank` — `promptVersion`, `candidatesCount`
- `searchLegalCorpus` meta: `rerankerEngine`, `rerankerStatus`, `promptVersion`

**Larm (rekommenderat):**

- Felrate Gemini rerank > 5 % / 15 min → auto `LEGAL_RERANKER=off` (manuellt tills Cloud Function finns)
- p95 latency searchLegalCorpus > 3 s

## PII-granskning av prompt

Innan prod: öppna `best_prompt.txt` i GCS och bekräfta:

- [ ] Ingen persondata (namn, personnummer, adresser)
- [ ] Ingen intern URL/credential
- [ ] Instruktionen är på svenska och domänkorrekt

## Relaterat

- [legal_rerank_prompt_review_TEMPLATE.md](../eval/legal_rerank_prompt_review_TEMPLATE.md)
- [EXPERIMENTS.md](../alphaevolve/EXPERIMENTS.md)
- `scripts/eval/run_legal_rerank_eval.ts`
