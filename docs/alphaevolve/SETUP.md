# AlphaEvolve setup (Miljöbeslut)

Google [AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) runs in your own GCP project via Gemini Enterprise. This repo vendors the upstream client at `alphaevolve-on-googlecloud/` and wires it into the Miljöbeslut workspace.

## Miljöbeslut GCP defaults

| Variable     | Miljöbeslut value         | Notes                                                               |
| ------------ | ------------------------- | ------------------------------------------------------------------- |
| `PROJECT_ID` | `miljointelligens`        | Same project as Vertex AI / Discovery Engine elsewhere in this repo |
| `LOCATION`   | `global`                  | Default from upstream `example.env`                                 |
| `GE_APP_ID`  | `miljobeslut-alphaevolve` | Engine in `default_collection` (provision via script below)         |

`GE_APP_ID` lives in `alphaevolve-on-googlecloud/.env` (gitignored). See [Install and configure AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/get-started) and [Gemini Enterprise access](../ops/gemini-enterprise-access.md).

Example `.env` fragment:

```env
PROJECT_ID=miljointelligens
LOCATION=global
COLLECTION=default_collection
GE_APP_ID=miljobeslut-alphaevolve
ASSISTANT=default_assistant
BASE_URL=discoveryengine.googleapis.com
MODEL=gemini-3.5-flash
```

## GCP provisioning

Verify current state:

```powershell
pwsh scripts/alphaevolve/verify-gcp.ps1
```

Create Engine + service account (Cloud Shell or Linux; requires Gemini Enterprise license):

```bash
export PROJECT_ID=miljointelligens
export SYSTEM_USER_EMAIL=you@domain.com
bash scripts/alphaevolve/provision-gcp.sh
```

The script enables Discovery Engine API, creates `alpha-evolve-client` SA, grants `roles/discoveryengine.admin`, optionally binds impersonation, and creates Engine + `default_assistant`.

## Prerequisites

- **Git** — clone upstream repo if missing
- **uv** — Python env and `ae` CLI ([installation](https://docs.astral.sh/uv/getting-started/installation/))
- **Google Cloud access** — authenticated `gcloud` user or ADC with permissions on `miljointelligens`
- **AlphaEvolve provisioned** — Gemini Enterprise Engine (`GE_APP_ID`)

## One-shot setup

From the Miljöbeslut repo root:

```powershell
.\scripts\alphaevolve\setup.ps1
```

The script is idempotent:

1. Checks `git` and `uv`
2. Clones `https://github.com/Google-Cloud-AI/alphaevolve-on-googlecloud.git` into `alphaevolve-on-googlecloud/` if missing
3. Creates `.venv` and runs `uv pip install -e ".[examples,dev]"` if the venv is missing
4. Ensures the `ae` CLI (`uv tool install ae`)
5. Installs Cursor + Antigravity skills
6. Copies `example.env` → `.env` with `PROJECT_ID=miljointelligens` if `.env` does not exist

**Recommended:** use the unified installer instead:

```powershell
.\scripts\google-ai\setup.ps1 -PersistPath -GeAppId miljobeslut-alphaevolve
```

See [Google AI dev stack](../google-ai/SETUP.md) for ADK + PATH layout.

After setup, confirm `GE_APP_ID` in `alphaevolve-on-googlecloud\.env`.

## Verify installation

```powershell
cd alphaevolve-on-googlecloud
.\.venv\Scripts\python.exe -m pytest tests
uv run pytest examples/list_deduplication/tests -v
pwsh ..\scripts\alphaevolve\verify-gcp.ps1
```

Quick CLI check:

```powershell
ae skills list
ae --json engine list
```

## Cursor skills

Six skills are installed for agent workflows:

| Skill                            | Role                       |
| -------------------------------- | -------------------------- |
| `alpha_evolve_orchestrator`      | End-to-end experiment flow |
| `alpha_evolve_experiment_design` | Design experiments         |
| `alpha_evolve_runner`            | Run experiments            |
| `alpha_evolve_monitor`           | Monitor progress           |
| `alpha_evolve_post_experiment`   | Post-run analysis          |
| `alpha_evolve_consultant`        | Guidance / troubleshooting |

Re-install after upstream skill updates:

```powershell
ae skills install --source "C:\miljöbeslut\alphaevolve-on-googlecloud\skills" --dest "$env:USERPROFILE\.cursor\skills" --force
```

Or re-run `setup.ps1`.

## Git ignore notes

Do **not** commit local AlphaEvolve secrets or the virtualenv. The Miljöbeslut root `.gitignore` includes:

```
alphaevolve-on-googlecloud/
```

Keep `.env` and `.venv` out of the main repo. Miljöbeslut-specific experiment **design** lives under `scripts/alphaevolve/experiments/` (tracked). See [EXPERIMENTS.md](./EXPERIMENTS.md).

## Run an example

After `GE_APP_ID` is set and `verify-gcp.ps1` passes:

```powershell
cd alphaevolve-on-googlecloud
$env:PROJECT_ID = "miljointelligens"
$env:GE_APP_ID = "miljobeslut-alphaevolve"

# Upstream circle packing
.\.venv\Scripts\python.exe -m examples.circle_packing.src.run_evolution

# Miljöbeslut list deduplication
.\.venv\Scripts\python.exe -m examples.list_deduplication.src.run_evolution
```

On Linux/macOS with `make` installed:

```bash
cd examples/circle_packing && make run
cd examples/list_deduplication && make run
```

Other upstream examples: TSP, signal processing, adaptive sort, LLM fine-tuning — see `examples/*/README.md`.

## Related docs

- [EXPERIMENTS.md](./EXPERIMENTS.md) — experiment catalog and smoke results
- Upstream README: `alphaevolve-on-googlecloud/README.md`
- Miljöbeslut Gemini Enterprise: `docs/ops/gemini-enterprise-access.md`
- GCP deploy defaults: `docs/deploy/DEPLOY_GCP.md`
