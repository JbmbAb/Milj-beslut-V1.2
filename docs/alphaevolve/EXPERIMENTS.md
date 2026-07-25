# AlphaEvolve experiments (Miljöbeslut)

Status: operativ guide. Senast uppdaterad: **2026-07-25**.

AlphaEvolve körs via den **gitignorerade** klonen [`alphaevolve-on-googlecloud/`](../../alphaevolve-on-googlecloud/) (upstream client). Miljöbeslut-specifika experiment dokumenteras här; framtida domänexperiment placeras under [`scripts/alphaevolve/experiments/`](../../scripts/alphaevolve/experiments/).

## Tre spår — håll isär

| Spår | Plats | Syfte |
|------|-------|-------|
| **Produktionssök** | `server/services/searchService.ts` | Hybrid FTS + pgvector + RRF (v2.3 på `main`) |
| **AlphaEvolve-labb** | `alphaevolve-on-googlecloud/examples/` | Evolvera algoritmer/parametrar via GCP |
| **Gemini POC** | Ej i repo | `plugin.yaml` / Monte Carlo — **implementera inte** |

## GCP-krav

| Variabel | Miljöbeslut-värde |
|----------|-------------------|
| `PROJECT_ID` | `miljointelligens` |
| `GE_APP_ID` | `miljobeslut-alphaevolve` (Engine i `default_collection`) |
| `ASSISTANT` | `default_assistant` |

Verifiera:

```powershell
pwsh scripts/alphaevolve/verify-gcp.ps1
```

Provisionera (Cloud Shell / admin):

```bash
export PROJECT_ID=miljointelligens SYSTEM_USER_EMAIL=you@domain.com
bash scripts/alphaevolve/provision-gcp.sh
```

## Tillgängliga exempel (klonen)

| Exempel | Sökväg | Status |
|---------|--------|--------|
| Circle packing | `examples/circle_packing/` | Upstream smoke OK |
| List deduplication | `examples/list_deduplication/` | Miljöbeslut-exempel; pytest 6/6; GCP smoke OK |
| TSP | `examples/tsp/` | Upstream |
| Legal search params | `scripts/alphaevolve/experiments/legal_search_params/` | Phase 2 — fixture eval via `run_eval.ts` |

## Köra exempel

Från repo-root (Windows):

```powershell
cd alphaevolve-on-googlecloud
# .env ska innehålla GE_APP_ID=miljobeslut-alphaevolve
$env:PROJECT_ID = "miljointelligens"
$env:GE_APP_ID = "miljobeslut-alphaevolve"
$env:MAX_PROGRAMS_EVALUATED = "5"

# Upstream
.\.venv\Scripts\python.exe -m examples.circle_packing.src.run_evolution

# Miljöbeslut
.\.venv\Scripts\python.exe -m examples.list_deduplication.src.run_evolution
```

Lokal test utan GCP:

```powershell
cd alphaevolve-on-googlecloud
uv run pytest examples/list_deduplication/tests -v
```

## Smoke-resultat (2026-07-25)

- **circle_packing:** Experiment skapat; 1 kandidat evaluerad (`sum_of_radii=1.9708`)
- **list_deduplication:** Seed `-0.35s` median → bästa kandidat `-0.0007s` (O(N)-liknande)

Resultat-JSON sparas lokalt under `examples/list_deduplication/results/` (gitignored i klonen).

## Miljöbeslut-specifika experiment

Placering: [`scripts/alphaevolve/experiments/`](../../scripts/alphaevolve/experiments/) — spåras i huvudrepo.

| Experiment | Mål | Prod-merge |
|------------|-----|------------|
| `legal_search_params` | Evolvera RRF/rerank-parametrar mot fast eval-set | Feature flag + human review |

**Regel:** Evolved kod/parametrar mergas **aldrig** direkt till prod utan godkännande (AGENTS.md).

## Relaterat

- [SETUP.md](./SETUP.md) — lokal installation
- [gemini-enterprise-access.md](../ops/gemini-enterprise-access.md) — datakällor till Gemini Enterprise
- Upstream README: `alphaevolve-on-googlecloud/README.md`
