# GCP scripts (pilot / dual-track)

| Script | Syfte |
|--------|--------|
| [audit-secrets.ps1](audit-secrets.ps1) | Kontrollera vilka Secret Manager-hemligheter som fortfarande är placeholders |
| [sync-secrets-from-env.ps1](sync-secrets-from-env.ps1) | Uppdatera Secret Manager från lokal `.env.production` |

**Dual-track:** Primär prod använder `.env.production` på egen server. GCP pilot synkas vid behov — inte automatiskt vid varje deploy.

```powershell
gcloud config set project miljointelligens
pwsh scripts/gcp/audit-secrets.ps1
# Efter .env.production är ifylld:
pwsh scripts/gcp/sync-secrets-from-env.ps1
```
