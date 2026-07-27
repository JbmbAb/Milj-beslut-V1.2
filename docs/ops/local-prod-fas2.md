# Fas 2 — Data, arkiv och drift (lokal prod)

Fortsättning efter [local-prod-fas1.md](local-prod-fas1.md). Dual-track A oförändrad — **ingen datamigrering till molnet**.

---

## Mål

1. Master Archive korrekt monterat och auditerat (0 % `checksum_missing`)
2. Daglig backup schemalagd på Windows
3. GCP pilot-secrets synkade efter lokal JWT-rotering
4. Förberedelse för geo-import till PostGIS (efter audit grön)

---

## Checklista

### Drift

- [x] `.env` från `.env.compose.example` (archive mount)
- [x] GCP secrets synkade efter JWT-rotering (`sync-prod-secrets-gcp.ps1`)
- [x] Schemalagd backup (`Miljobeslut-Prod-Daily` kl 03:00)

### Mimers Brunn audit

- [ ] `pwsh scripts/ops/archive-audit.ps1` — snabb status
- [ ] `pwsh scripts/ops/archive-audit.ps1 -Hash` — full SHA-256 (långsammare)
- [ ] Vid `checksum_missing`: `node scripts/db/archive-repair-files-detail.mjs` (se data-coverage-gaps)

**Definition of Done:** `checksum_missing = 0` och `legacy_path_mismatch = 0` i `storage/manifests/archive-local-verify-registry.json`

### Senaste audit (2026-07-27)

| Status | Antal | Dataset |
|--------|-------|---------|
| checksum_missing | 4 | LM: fastighetsytor, linjer, byggnad, marktäcke |
| missing_manifest | 2 | SGU: Brunnar, Grundvatten |
| verified | 8 | SGU övriga Tier 1/2 |

Åtgärd: re-harvest LM eller `archive-repair-files-detail.mjs` + `-Hash`-audit. SGU: kör harvesting enligt `sguHarvestSources.ts`.

### Efter audit grön

- [ ] Importera vektor till PostGIS från arkiv (inte `_review`)
- [ ] `npm run smoke:postgis` eller motsvarande mot lokal prod DB
- [ ] Uppdatera [data-coverage-gaps.md](../architecture/data-coverage-gaps.md)

---

## Kommandon

```powershell
# Compose archive mount
Copy-Item .env.compose.example .env
docker compose -f docker-compose.prod.yml up -d

# Daglig rutin (manuell eller schemalagd)
pwsh scripts/ops/prod-daily.ps1

# GCP sync efter rotate-prod-secrets
pwsh scripts/ops/sync-prod-secrets-gcp.ps1

# Archive audit
pwsh scripts/ops/archive-audit.ps1
pwsh scripts/ops/archive-audit.ps1 -Hash
```

---

## Medvetet senare (Fas 3+)

- Linux-server + systemd
- BankID / Trafikverket-token
- Caddy + riktig domän
- GCP auto-deploy (`staging`-branch)

Relaterat: [dual-track-a.md](dual-track-a.md), [data-coverage-gaps.md](../architecture/data-coverage-gaps.md)
