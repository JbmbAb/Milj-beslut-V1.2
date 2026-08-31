# Operativa scripts — lokal prod (Windows)

Dual-track A: primär prod på egen server. Se [docs/ops/local-prod-fas1.md](../../docs/ops/local-prod-fas1.md).

## Körordning (Fas 1)

```powershell
# 1. Rotera hemligheter (JWT m.m.) — ogiltigför befintliga sessioner
pwsh scripts/ops/rotate-prod-secrets.ps1

# 2. Starta om stack
docker compose -f docker-compose.prod.yml up -d

# 3. Backup
pwsh scripts/ops/backup-prod-db.ps1

# 4. Verifiera
pwsh scripts/ops/verify-prod.ps1
```

## Scripts

| Script | Syfte |
|--------|--------|
| [rotate-prod-secrets.ps1](rotate-prod-secrets.ps1) | Rotera JWT, hash-salt, encryption key, admin-lösen i `.env.production` |
| [backup-prod-db.ps1](backup-prod-db.ps1) | `pg_dump` → `backups/prod/*.sql.gz` + SHA256-manifest |
| [restore-prod-db.ps1](restore-prod-db.ps1) | Återställ från backup (**kräver `-Confirm`**) |
| [verify-prod.ps1](verify-prod.ps1) | Health, ready, DB, archive mount (+ worker when staging compose) |
| [verify-runtime-imports-in-image.mjs](verify-runtime-imports-in-image.mjs) | PNRC I2: all `server/`/`services/` `packages/` imports exist on disk or in image |
| [prod-daily.ps1](prod-daily.ps1) | Backup + verify (daglig rutin) |
| [register-prod-backup-task.ps1](register-prod-backup-task.ps1) | Windows Task Scheduler 03:00 |
| [sync-prod-secrets-gcp.ps1](sync-prod-secrets-gcp.ps1) | Synka `.env.production` → GCP (skip DATABASE_URL) |
| [archive-audit.ps1](archive-audit.ps1) | Mimers Brunn manifest-audit |

Fas 2: [docs/ops/local-prod-fas2.md](../../docs/ops/local-prod-fas2.md)

```powershell
pwsh scripts/ops/restore-prod-db.ps1 -BackupFile backups/prod/miljobeslut_prod_YYYYMMDD-HHMMSS.sql.gz -Confirm
```

## TLS (valfritt)

Se [deploy/local/README.md](../../deploy/local/README.md) för Caddy på Windows.
