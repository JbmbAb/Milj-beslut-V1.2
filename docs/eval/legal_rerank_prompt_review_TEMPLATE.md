# Legal Rerank Prompt — Review (mall)

**Datum:** _YYYY-MM-DD_  
**Reviewer:** _namn_  
**Experiment / GCS:** `gs://miljobeslut-prompt-optimization-bucket/.../best_prompt.txt`  
**Prompt-version:** _opt-prompt-xxxxxxxx_

---

## 1. Resultat (ifylls efter staging)

| Metric | Baseline | Optimerad | Δ |
|--------|----------|-----------|---|
| mean_recall (@8) | | | |
| p95_latency_ms | | | |
| rerankerEngine (staging) | — | gemini / lexical | |

**Källa:** `results.json` i GCS + `npx tsx scripts/eval/run_legal_rerank_eval.ts`

---

## 2. Prompt-diff

**Före (default):**

```
Du är en expert på svensk miljö- och fastighetsanalys...
```

**Efter (optimerad):**

```
(klistra in best_prompt.txt)
```

---

## 3. Spot checks (10 queries)

| # | Query | Top-1 relevant? | Kommentar |
|---|-------|-----------------|-----------|
| 1 | fosforrening enskilt avlopp | ☐ Ja ☐ Nej | |
| 2 | miljöbalken tillståndsprövning | ☐ Ja ☐ Nej | |
| 3 | recipient vattendrag förorening | ☐ Ja ☐ Nej | |
| 4 | detaljplan bestämmelse buller | ☐ Ja ☐ Nej | |
| 5 | laga kraft dom miljö | ☐ Ja ☐ Nej | |
| 6 | strandskydd dispens | ☐ Ja ☐ Nej | |
| 7 | schaktmassor klassificering | ☐ Ja ☐ Nej | |
| 8 | miljöfarlig verksamhet | ☐ Ja ☐ Nej | |
| 9 | vattenskyddsområde | ☐ Ja ☐ Nej | |
| 10 | _egen query_ | ☐ Ja ☐ Nej | |

**Godkänt:** ≥ 8/10 top-1 bedöms relevanta.

---

## 4. PII & säkerhet

- [ ] Ingen PII i prompt
- [ ] Ingen prompt injection / test fixture leakage
- [ ] Reward hacking-granskning (hårdkodade svar?) — N/A för prompt-only

---

## 5. Beslut

- [ ] **Godkänn** staging → prod (begränsad rollout)
- [ ] **Avslå** — behåll baseline, dokumentera skäl
- [ ] **Kräver mer eval** — utöka golden set

**Signatur:** __________________ **Datum:** __________

---

## 6. Rollback-plan (om prod)

- Env: `LEGAL_RERANKER=off`
- Prompt: återställ `LEGAL_RERANKER_PROMPT_VERSION=default`
- Se [legal-reranker-rollout.md](../ops/legal-reranker-rollout.md)
