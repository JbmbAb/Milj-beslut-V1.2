# Staging secrets (provider-neutral Docker secrets)

Copy this directory to `deploy/staging/secrets/` and fill each file locally.
**Never commit** the populated `secrets/` directory.

```powershell
New-Item -ItemType Directory -Force deploy/staging/secrets
Copy-Item deploy/staging/secrets.example/* deploy/staging/secrets/
# Edit each file with real values (openssl rand -hex 64 for JWT secrets)
```

| File | Maps to env |
|------|-------------|
| `jwt_access_secret` | `JWT_ACCESS_SECRET` |
| `jwt_refresh_secret` | `JWT_REFRESH_SECRET` |
| `admin_console_password` | `ADMIN_CONSOLE_PASSWORD` |
| `lu_signer_key` | `LU_SIGNER_PRIVATE_KEY_PEM` (worker container only) |

Mounted via `docker-compose.staging.yml` and exported by `entrypoint-with-secrets.sh`.

Bootstrap alternative: set the same variables in `.env.staging` for simple local prep (PNRC §8.1).
