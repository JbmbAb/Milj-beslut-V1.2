# Google AI dev stack (Miljöbeslut)

Optimal local layout: **isolated venvs**, **uv tools on PATH**, **no global `pip install`**.

## Architecture

| Tool | Venv / install | CLI | Used by |
|------|----------------|-----|---------|
| **AlphaEvolve** | `alphaevolve-on-googlecloud/.venv` | `ae` (uv tool → `~/.local/bin`) | Cursor, Antigravity skills, offline evolution |
| **Google ADK** | `.venv-adk/` (repo root) | `adk` (inside venv) | Agent prototypes, A2UI |
| **Miljöbeslut app** | Node `node_modules` | `npm run dev:server` | Production search / Vertex |

These do **not** share Python dependencies. Never install `google-adk` or `alpha_evolve` with global `pip` (Windows Store Python).

## One-shot setup

From repo root:

```powershell
.\scripts\google-ai\setup.ps1 -PersistPath
```

`-PersistPath` adds `%USERPROFILE%\.local\bin` to your **user PATH** (so `ae` works in new terminals).

Optional engine ID (only if `.env` still has placeholder):

```powershell
.\scripts\google-ai\setup.ps1 -GeAppId gemini-enterprise-agent-ap_1783287062429 -PersistPath
```

## After setup

**AlphaEvolve**

```powershell
ae version
cd alphaevolve-on-googlecloud
.\.venv\Scripts\Activate.ps1
# .env: PROJECT_ID + GE_APP_ID (local file, gitignored)
```

**Google ADK**

```powershell
.\.venv-adk\Scripts\Activate.ps1
adk --help
```

**Auth (both)** — ADC, not Secret Manager for engine ID:

```powershell
gcloud auth application-default login
gcloud config set project miljointelligens
```

## Skills (Cursor + Antigravity)

Installed to:

- `%USERPROFILE%\.cursor\skills\alpha_evolve_*`
- `%USERPROFILE%\.gemini\config\skills\alpha_evolve_*`

Re-run `.\scripts\google-ai\setup.ps1` to refresh.

## Secrets vs config

| Variable | Secret Manager? | Where |
|----------|-----------------|-------|
| `GE_APP_ID` | No (resource ID) | `alphaevolve-on-googlecloud/.env` |
| `VERTEX_PROJECT_ID` | No | env var / `.env` |
| JWT, API keys, SA JSON | Yes | Secret Manager in prod |

## Troubleshooting

**`ae` not found** — run setup with `-PersistPath` or:

```powershell
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
```

**`adk` not found** — activate `.venv-adk` first; do not use Store Python Scripts path.

**Global pip pollution** — uninstall optional:

```powershell
pip uninstall google-adk a2ui-agent-sdk -y
```

Then use `.venv-adk` only.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/google-ai/setup.ps1` | Master setup (AlphaEvolve + ADK) |
| `scripts/alphaevolve/setup.ps1` | AlphaEvolve only |
| `scripts/google-adk/setup.ps1` | ADK venv only |

See also: [AlphaEvolve details](../alphaevolve/SETUP.md)
