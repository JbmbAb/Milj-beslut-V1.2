# AlphaEvolve setup (Miljöbeslut)

Google [AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) runs in your own GCP project via Gemini Enterprise. This repo vendors the upstream client at `alphaevolve-on-googlecloud/` and wires it into the Miljöbeslut workspace.

## Miljöbeslut GCP defaults

| Variable | Miljöbeslut value | Notes |
| -------- | ----------------- | ----- |
| `PROJECT_ID` | `miljointelligens` | Same project as Vertex AI / Discovery Engine elsewhere in this repo |
| `LOCATION` | `global` | Default from upstream `example.env` |
| `GE_APP_ID` | **You must set this** | Gemini Enterprise App / Engine ID after AlphaEvolve provisioning |

`GE_APP_ID` is **not** auto-filled. It comes from the Gemini Enterprise app created when AlphaEvolve is provisioned in `miljointelligens`. See [Install and configure AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/get-started) and [Gemini Enterprise access](../ops/gemini-enterprise-access.md).

Example `.env` fragment after setup:

```env
PROJECT_ID=miljointelligens
LOCATION=global
COLLECTION=default_collection
GE_APP_ID=your-engine-id
ASSISTANT=default_assistant
BASE_URL=discoveryengine.googleapis.com
MODEL=gemini-3.5-flash
```

Replace `your-engine-id` with the Engine ID shown in Google Cloud Console under your Gemini Enterprise app.

## Prerequisites

- **Git** — clone upstream repo if missing
- **uv** — Python env and `ae` CLI ([installation](https://docs.astral.sh/uv/getting-started/installation/))
- **Google Cloud access** — authenticated `gcloud` user or ADC with permissions on `miljointelligens`
- **AlphaEvolve provisioned** — Gemini Enterprise app with Engine ID (`GE_APP_ID`)

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
.\scripts\google-ai\setup.ps1 -PersistPath
```

See [Google AI dev stack](../google-ai/SETUP.md) for ADK + PATH layout.

After setup, edit `alphaevolve-on-googlecloud\.env` and set `GE_APP_ID`.

## Verify installation

```powershell
cd alphaevolve-on-googlecloud
.\.venv\Scripts\python.exe -m pytest tests
```

Expect the client/library tests to pass. Some upstream evaluator tests may fail on Windows if optional native deps differ; check the summary line for pass/fail counts.

Quick CLI check:

```powershell
ae skills list
```

## Cursor skills

Six skills are installed for agent workflows:

| Skill | Role |
| ----- | ---- |
| `alpha_evolve_orchestrator` | End-to-end experiment flow |
| `alpha_evolve_experiment_design` | Design experiments |
| `alpha_evolve_runner` | Run experiments |
| `alpha_evolve_monitor` | Monitor progress |
| `alpha_evolve_post_experiment` | Post-run analysis |
| `alpha_evolve_consultant` | Guidance / troubleshooting |

Re-install after upstream skill updates:

```powershell
ae skills install --source "C:\miljöbeslut\alphaevolve-on-googlecloud\skills" --dest "$env:USERPROFILE\.cursor\skills" --force
```

Or re-run `setup.ps1`.

## Git ignore notes

Do **not** commit local AlphaEvolve secrets or the virtualenv. The Miljöbeslut root `.gitignore` includes:

```
alphaevolve-on-googlecloud/.venv
alphaevolve-on-googlecloud/.env
```

The upstream clone under `alphaevolve-on-googlecloud/` may be tracked as a nested checkout or submodule depending on how you added it; either way, keep `.env` and `.venv` out of git.

## Run an example

After `GE_APP_ID` is set:

```powershell
cd alphaevolve-on-googlecloud\examples\circle_packing
..\..\..\.venv\Scripts\python.exe run.py
```

See upstream `examples/*/README.md` for other workloads (TSP, signal processing, adaptive sort, LLM fine-tuning).

## Related docs

- Upstream README: `alphaevolve-on-googlecloud/README.md`
- Miljöbeslut Gemini Enterprise: `docs/ops/gemini-enterprise-access.md`
- GCP deploy defaults: `docs/deploy/DEPLOY_GCP.md`
