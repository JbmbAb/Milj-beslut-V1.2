# Fas 1 — Hårdning lokal prod (Windows)

**Mål:** Driftsäker primär prod på egen Windows-maskin enligt [dual-track-a.md](dual-track-a.md).

GCP förblir pilot; denna fas rör **inte** molndrift eller datamigrering.

---

## Checklista

### Klart i repo

- [x] `docker-compose.prod.yml` — PostGIS + pgvector, port 8080/5434
- [x] `scripts/ops/` — backup, restore, rotate, verify
- [x] `deploy/local/Caddyfile.example` — TLS-mall

### Kör på prod-värd (du)

- [x] `.env.production` + JWT-rotering (`rotate-prod-secrets.ps1`)
- [x] `verify-prod.ps1` + minst en backup
- [ ] `.env` från `.env.compose.example` (archive mount i compose)
- [ ] Schemalagd backup (`register-prod-backup-task.ps1`)
- [ ] (Valfritt) Caddy TLS — [deploy/local/README.md](../../deploy/local/README.md)

---

## Snabbkommandon

```powershell
# Rotera secrets + starta
pwsh scripts/ops/rotate-prod-secrets.ps1
docker compose -f docker-compose.prod.yml up -d --build

# Schema (första gången)
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec app npx tsx scripts/db/spatial-bootstrap.ts

# Backup + verify
pwsh scripts/ops/backup-prod-db.ps1
pwsh scripts/ops/verify-prod.ps1
```

---

## Definition of Done (Fas 1)

| Kriterium | Verifiering |
|-----------|-------------|
| `/ready` grön | `verify-prod.ps1` OK |
| JWT ≥ 64 hex | `rotate-prod-secrets.ps1` körd |
| Minst en backup | `backups/prod/*.sql.gz` + manifest med SHA256 |
| Archive mount | verify steg "Archive mount" OK |
| GCP audit (pilot) | `pwsh scripts/gcp/audit-secrets.ps1` — krävda 11/11 |

---

## Backup/restore

**Daglig backup:**

```powershell
pwsh scripts/ops/backup-prod-db.ps1
```

Filer landar i `backups/prod/` (gitignored).

**Restore (månadsövning, kräver `-Confirm`):**

```powershell
pwsh scripts/ops/restore-prod-db.ps1 -BackupFile backups/prod/<fil>.sql.gz -Confirm
```

RPO ≤ 24h, RTO ≤ 8h enligt [operations-readiness-pack.md](../qa/operations-readiness-pack.md).

---

## Nästa fas

→ [local-prod-fas2.md](local-prod-fas2.md) — archive audit, schemalagd backup, GCP-sync
