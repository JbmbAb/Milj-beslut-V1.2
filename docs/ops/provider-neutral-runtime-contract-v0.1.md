# Provider-Neutral Runtime Contract v0.1 (PNRC-0.1)

**Status:** Accepted design (owner amendments integrated)  
**Product proof SHA:** `86d41d280e2a20a85572f9a01fb4f86f9876d12f` (immutable reference)  
**Supersedes:** GCP-specific boot-checklist ingress model (Cloud Run IAM)  
**Blocks:** I2 Dedicated-Server Staging until owner accepts this document  
**I1 scope:** Design artifact only — no Dockerfile, compose, harness, verification scripts, deployment, or GCP mutation in this unit

---

## Roadmap context

```text
I0  GCP EXIT INVENTORY              PASS / CLOSED
I1  PROVIDER-NEUTRAL RUNTIME CONTRACT   THIS DOCUMENT
I2  DEDICATED-SERVER STAGING          BLOCKED ON I1 ACCEPTANCE + I2 GATE
I3  AUTHENTICATED PRODUCT PROOF       BLOCKED ON I2
I4  INDEPENDENT PROOF AUDIT           BLOCKED ON I3
I5  OWNER PRODUCT-PROVEN RULING       OWNER ONLY
```

---

## 1. Purpose

PNRC-0.1 defines what the Mimer platform **requires to run** on a dedicated server, independent of Google Cloud Platform. Items that existed only for Cloud Run, WIF, or GCP-managed services are marked **`LEGACY_GCP`** and must **not** be inherited into the target architecture.

This document transforms the I0 GCP Exit Inventory into an operator-neutral contract covering: container/build, storage authorities, PostgreSQL 15 + PostGIS/pgvector, migrations/bootstrap, secrets, workers, health/readiness, ingress/TLS, backup/restore, observability, and deployment/rollback.

---

## 2. Architecture decision: ingress and authentication

### 2.1 Must not inherit from GCP

| Tag | Item |
|-----|------|
| `LEGACY_GCP` | Cloud Run IAM (`--no-allow-unauthenticated`) |
| `LEGACY_GCP` | WIF + GitHub OIDC → GCP `id_token` |
| `LEGACY_GCP` | `X-Serverless-Authorization: Bearer <google_id_token>` |
| `LEGACY_GCP` | "Public vs IAM-protected" as the infrastructure access model |

Boot-checklist point 10 (public vs IAM-protected) applied to **Cloud Run infrastructure**, not application security. On a dedicated server, ingress/auth is defined provider-neutrally below.

### 2.2 Provider-neutral ingress/auth boundary (three layers)

```
┌─────────────────────────────────────────────────────────────┐
│ L0  Network edge — TLS mandatory on staging/production      │
│     Optional: IP allowlist, VPN, mTLS where practical       │
│     Edge restriction NEVER substitutes application auth     │
├─────────────────────────────────────────────────────────────┤
│ L1  Application — route classification                      │
│     Public: /health, /ready, static assets, /api/csrf-token │
│     Authenticated: JWT Bearer + CSRF on protected API       │
│     Admin: ADMIN_CONSOLE_* → login → JWT                    │
│     BankID: RP mTLS when enabled                            │
├─────────────────────────────────────────────────────────────┤
│ L2  Data plane — DB credentials, vault secrets, signer keys │
│     LU issuer private keys: worker processes ONLY           │
└─────────────────────────────────────────────────────────────┘
```

| Layer | Responsibility | Examples in repo |
|-------|----------------|------------------|
| **L0 Network edge** | TLS termination, routing, rate limits, optional network restriction | `deploy/local/Caddyfile.example` |
| **L1 HTTP application** | CSRF, JWT, admin login, BankID, route guards | `server/createApp.ts`, `server/routes/auth.routes.ts` |
| **L2 Data plane** | Secrets injection, DB auth, isolated signer material | Worker registry, vault/files |

### 2.3 Staging edge policy (owner amendment)

- **TLS is mandatory** on dedicated-server staging.
- **IP allowlist and/or VPN** where practical — reduces attack surface but does not replace L1.
- **Edge restriction never substitutes application auth.** A request that passes L0 must still satisfy L1 when accessing protected resources.
- **I3 authenticated product proof** uses real **CSRF token acquisition** and **application login → JWT** (`POST /api/admin/auth/login`). It does **not** use Cloud Run IAM headers or WIF tokens.

Harness helpers that inject `X-Serverless-Authorization` (product @ `86d41d28`, `tests/e2e/support.ts`) are **`LEGACY_GCP`** and must be removed or replaced in I2/I3 — not in I1.

---

## 3. Canonical production build contract

### 3.1 Owner decision: single source of truth

| Artifact | Role |
|----------|------|
| **`Dockerfile`** | **Canonical** single production build source of truth |
| **`Dockerfile.gcp`** | **`LEGACY_GCP`** — do not patch on Cloud Run; deprecate in I2 |

Two competing deployment paths existed at I0:

| Track | Files | Status |
|-------|-------|--------|
| A | `Dockerfile.gcp` + `.github/workflows/deploy-gcp.yml` | `LEGACY_GCP` |
| B | `Dockerfile` + `cloudbuild.yaml` | Canonical base; production stage still missing `packages/` at I0 |

Both tracks shared the same **container defect** at product SHA `86d41d28`: runtime code imports `packages/` via relative paths (e.g. `server/routes/gis.routes.ts` → `packages/spatial-provider-postgis/src/SpatialLayerRegistry`), but neither production stage copied `packages/` into the image. Revisions `00022`/`00023` failed startup with `ERR_MODULE_NOT_FOUND`. **Do not fix via Cloud Run patch** — resolve in I2 canonical build.

`docker-compose.prod.yml` currently references `Dockerfile.gcp` with inconsistent port mapping (`8080:3000` vs image `PORT=8080`). That inconsistency is noted for I2; **not changed in I1**.

### 3.2 Required Dockerfile targets (I2 implementation)

| Target | Command | Role |
|--------|---------|------|
| `web` | `npm start` → `node --import tsx server/index.ts` | HTTP + WebSocket API |
| `worker-all` | `npm run worker:all` | LU provisioning + signer-isolated jobs |
| `gdpr-worker` | `npx tsx server/workers/gdpr-maintenance-worker.ts` | Optional dedicated GDPR worker |
| `search-indexer-worker` | `npx tsx server/workers/search-indexer-worker.ts` | Optional dedicated search worker |
| `domstol-rss-worker` | `npx tsx server/workers/domstol-rss-worker.ts` | Optional dedicated RSS worker |

### 3.3 Production stage copy invariant (I2)

The canonical production stage **must** include at minimum:

```dockerfile
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/server ./server
COPY --from=builder /app/services ./services
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
# plus existing: src, app, config, types, stubs, root *.ts as needed
```

**Safest COPY until import graph is locked:** entire `packages/` tree.

**Server runtime packages (minimum, from import analysis @ `86d41d28`):**

- `packages/spatial-provider-postgis`
- `packages/mps-runtime`
- `packages/mps-compliance`
- `packages/mps-data-governance`
- `packages/mps-lu`
- `packages/mps-governance-runtime`
- `packages/mps-canonical`
- (transitive: `mimers-brunn-core`, `mps-governance`, and others via the above)

### 3.4 Build-time verification (I2, not I1)

Before I2 deploy, a verification step must confirm **every runtime import resolves inside the built image**. Codex or CI runs this against the canonical image — not against Cloud Run.

---

## 4. Storage authorities (four distinct planes)

Storage is **not** a single bucket or mount. Each authority has a distinct role, lifecycle, and backup policy. Conflating them caused operational confusion in the GCP pilot (GCS treated as "the storage").

| Authority | Purpose | Durability | Backup |
|-----------|---------|------------|--------|
| **A. Document/object storage** | Uploaded files, generated exports, operational blobs served or processed by the app | Durable filesystem or S3-compatible object store | File/object backup; independent of DB |
| **B. Mimers canonical CAS** | Content-addressed artifact store + ledger (`MIMERS_ROOT`) | Must support hard links on same FS; NFS/shared FS for HA (`docs/ops/mimers-brunn-v9-nfs-validation.md`) | Filesystem snapshot; integrity via CAS hashes |
| **C. Master/source archive** | Read-only geodata and source corpus (Mimers Brunn policy) | Local sovereign mount; **not** cloud bulk migration | Archive audit; separate from CAS |
| **D. PostgreSQL projection** | Relational + PostGIS operational database | PostgreSQL 15 data directory | `pg_dump` / restore scripts |

**Rules:**

- Document/object storage **≠** Mimers canonical CAS.
- Mimers CAS **≠** master/source archive.
- PostgreSQL **≠** any filesystem authority — it is a **projection** fed by migrations, ingest, and CAS references.
- **`LEGACY_GCP` G10 (reworded):** GCS bucket `miljobeslut-documents-miljointelligens` was a **GCP pilot binding for document/object storage (authority A)**. It is not the canonical CAS (B), not the master archive (C), and not the database (D). Dedicated-server staging must declare explicit paths or services for A, B, and C independently.

---

## 5. Container and process contract

| Requirement | Contract |
|-------------|----------|
| Node runtime | 22-alpine (existing Dockerfiles) |
| PID 1 / signals | `tini` recommended (from legacy gcp track) |
| Entry | `node --import tsx server/index.ts` via `npm start` |
| Port | `PORT` env; **8080** in production profiles |
| User | non-root (`appuser`) |
| Chromium | Required if Puppeteer/ERD generation runs in prod |

### 5.1 Staging worker policy (owner amendment)

| Setting | Staging value | Rationale |
|---------|---------------|-----------|
| `START_WORKERS_IN_PROCESS` | **`false`** | Decouple worker crashes from API uptime |
| Worker deployment | **Separate processes/containers** from web | Matches production isolation model |
| LU signer private keys | **Never loaded in web process** | Enforced by `server/workers/registry.ts` — LU provisioning runs only via `npm run worker:all` |

Dedicated-server primary prod may use in-process workers (`START_WORKERS_IN_PROCESS=true` in `docker-compose.prod.yml`) as an operator choice; **staging for I2/I3 follows the strict separation above**.

---

## 6. PostgreSQL 15 + PostGIS + pgvector

| Requirement | Contract |
|-------------|----------|
| Version | PostgreSQL **15** |
| Extensions | PostGIS (full version verified at startup), pgvector |
| Required schemas | `core`, `env` |
| Expected schemas | `topo10`, `lm` |
| `spatial_ref_sys` | ≥ 100 rows — fail-fast if incomplete |
| Connection | Standard TCP `DATABASE_URL` (`host:port`) |
| `LEGACY_GCP` | Cloud SQL Unix socket: `?host=/cloudsql/PROJECT:REGION:INSTANCE` |

**Startup fail-fast** (`server/index.ts`): connection, PostGIS version, schema presence, spatial reference count. Server exits non-zero on failure.

**Bootstrap sequence (operator, before accepting traffic):**

```text
1. backup-before-migrate (see §10)
2. npx prisma migrate deploy
3. npx tsx scripts/db/spatial-bootstrap.ts
4. start web process (DB + optional Mimers CAS validation)
```

Postgres image reference: `docker/postgres-prod` or equivalent on dedicated hardware.

---

## 7. Mimers CAS (authority B)

| Variable | Role |
|----------|------|
| `MIMERS_ROOT` | Root path for CAS objects and ledger |
| `MIMERS_REQUIRED=1` | Fail-closed: `assertMimersCasReady()` at startup |
| `MIMERS_DURABILITY_MODE` | `best-effort` or `strict` |

NFS/shared-FS validation is documented in `docs/ops/mimers-brunn-v9-nfs-validation.md`. CAS requires hard links on a single filesystem for tmp/objects.

Master archive (authority C) mounts read-only (e.g. `/data/geo_master` in compose examples) and must not be written by the web process.

---

## 8. Secrets (owner amendment)

### 8.1 Provider-neutral secret injection

Acceptable mechanisms (in order of preference for production):

1. **Docker secrets** / mounted protected files with restrictive permissions
2. **External vault** (HashiCorp Vault, SOPS, cloud-agnostic secret store)
3. **`.env.production`** — bootstrap and simple single-host deployment **only**; not the long-term production standard

| Rule | Requirement |
|------|-------------|
| No secrets in image | Build args and layers must not contain credentials |
| No secrets in repository | Templates (`.env.production.gcp.example`) use placeholders only |
| No secrets in logs | Redact `DATABASE_URL` and tokens in structured logs |
| No secrets in proof artifacts | E2E screenshots, CI logs, and audit bundles must exclude credentials |

**`LEGACY_GCP`:** GCP Secret Manager is a **legacy deployment dependency** for the Cloud Run pilot — not the central secret management model for dedicated-server operation. Scripts such as `scripts/gcp/sync-secrets-from-env.ps1` remain `LEGACY_GCP`.

### 8.2 Required secrets (production startup)

**Always required** (`server/security/env.ts`):

- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `LANTMATERIET_BASE_URL` + auth credentials, **or** `LANTMATERIET_OPEN_MODE=true`

**Required when feature enabled:**

- `DATABASE_URL`
- `ADMIN_CONSOLE_USERNAME`, `ADMIN_CONSOLE_PASSWORD`
- `SEARCH_ENCRYPTION_KEY_BASE64`, `QUERY_HASH_SALT`
- `GEMINI_API_KEY`, `OPENAI_API_KEY`
- BankID certificate paths and passphrases
- LU execution signer material — **worker process only**

---

## 9. Workers

| Process | Start | Signer keys |
|---------|-------|-------------|
| Web (`target: web`) | HTTP server | **Must not** load LU issuer private keys |
| `worker-all` | `npm run worker:all` | LU provisioning + signing |
| GDPR / search / domstol | Dedicated targets or via registry when in-process | Per worker scope |

`server/workers/registry.ts` documents that LU provisioning workers are excluded from the web registry intentionally.

---

## 10. Health and readiness

| Endpoint | Type | L1 auth | Contract |
|----------|------|---------|----------|
| `GET /health` | Liveness | Public at edge | 200 if process alive |
| `GET /ready` | Readiness | Public at edge | 200 if DB and dependencies OK |
| `GET /api/health` | Application depth | Public | Three-level production readiness |

**Dedicated-server probe mapping:**

```text
Liveness  → GET /health
Readiness → GET /ready
```

`LEGACY_GCP`: Cloud Run startup probes and IAM-authenticated health checks in `deploy-gcp.yml`.

---

## 11. Ingress and TLS

| Requirement | Contract |
|-------------|----------|
| TLS | Terminated at reverse proxy (Caddy/nginx/Traefik) |
| Backend | Container listens HTTP on `PORT` (8080) |
| WebSocket | Proxied on same host |
| Staging | TLS mandatory; IP allowlist/VPN where practical |
| Auth | L0 never replaces L1 |

Reference: `deploy/local/Caddyfile.example`.

---

## 12. Backup, restore, migration, and rollback (owner amendment)

### 12.1 Backup authorities

| Authority | Method | Reference |
|-----------|--------|-----------|
| D — PostgreSQL | `scripts/ops/backup-prod-db.ps1` → `backups/prod/*.sql.gz` + SHA256 manifest | RPO ≤ 24h |
| B — Mimers CAS | Filesystem snapshot of `MIMERS_ROOT` | Independent of DB |
| C — Master archive | Archive audit; read-only source corpus | `local-prod-fas2.md` |
| A — Document/object | Operator-defined; must not assume GCS | Declared at I2 |

### 12.2 Migration policy

- **`backup-before-migrate` is mandatory** before `prisma migrate deploy` on staging or production.
- An **explicit migration compatibility strategy** must be documented per release: forward-only migrations, expand-contract patterns, or flagged destructive steps requiring owner approval.
- Migrations run **before** traffic switch to a new image version.

### 12.3 Rollback policy

| Action | Behavior |
|--------|----------|
| **Application rollback** | Deploy previous known-good image tag; restart web and worker containers |
| **Application rollback** | **Does not** automatically restore the database |
| **Database restore** | Destructive; requires **explicit operator/owner gate** (`-Confirm` or equivalent) |
| **Combined disaster recovery** | Restore DB from backup **then** deploy matching application version — planned procedure, not automatic rollback |

Reference restore script: `scripts/ops/restore-prod-db.ps1 -Confirm`.

---

## 13. Observability

| Capability | Contract |
|------------|----------|
| Structured logging | `server/logger` |
| Error tracking | Sentry (`captureException`) |
| Tracing | `@opentelemetry/api` spans; exporter optional |
| Metrics | Log-derived (search latency, reranker errors) — see `docs/ops/observability-otlp.md` |

**Provider-neutral target:** OTLP export to operator-chosen backend (Grafana, Jaeger, etc.).

**`LEGACY_GCP`:** Cloud Trace exporter, Cloud Monitoring dashboards, `OTEL_TRACES_EXPORTER=google_cloud_trace`.

---

## 14. Deployment and rollback (I2)

| Step | Contract |
|------|----------|
| Build | `docker build -f Dockerfile --target web -t miljobeslut:<sha> .` |
| Verify | Runtime import resolution in image (I2 gate) |
| Migrate | backup → `prisma migrate deploy` → `spatial-bootstrap` |
| Deploy | Single pipeline: compose or systemd — no split-brain |
| Rollback | Previous image tag; DB restore only with owner gate |

**`LEGACY_GCP`:** Cloud Run revisions, traffic split, `gcloud run deploy`, `deploy-gcp.yml`.

---

## 15. LEGACY_GCP register

| ID | Description | PNRC replacement |
|----|-------------|------------------|
| G1 | Cloud Run IAM + `--no-allow-unauthenticated` | L0 TLS + L1 application auth |
| G2 | WIF / GitHub OIDC → GCP id_token | CI deploy credentials (SSH/key) |
| G3 | `X-Serverless-Authorization` | Remove from E2E harness (I2/I3) |
| G4 | Cloud Run revisions / traffic routing | Image tag + compose/systemd rollback |
| G5 | Cloud SQL Unix socket DSN | TCP `DATABASE_URL` |
| G6 | GCP Secret Manager as central secret store | Docker secrets / vault / protected files |
| G7 | Serverless VPC Connector | Direct network / private VLAN |
| G8 | `Dockerfile.gcp` + `deploy-gcp.yml` | Canonical `Dockerfile` |
| G9 | `cloudbuild.yaml` multi-region GCP deploy | Single dedicated-server deploy path |
| G10 | GCS bucket used as undifferentiated "storage" | Split into authorities A–D (§4); GCS was pilot **document/object** binding only |
| G11 | Vertex metadata SA auth | Application API keys or optional ADC |
| G12 | `deploy/gcp/cloud-run-service.yaml` (port 3000, `/api/health`) | Port 8080, `/health` and `/ready` |

---

## 16. Known container defect (I0 → I2)

At product SHA `86d41d28`, both legacy Dockerfiles omitted `packages/` from the production stage. Symptom on Cloud Run revision `00022`:

```text
ERR_MODULE_NOT_FOUND: Cannot find module
  '/app/packages/spatial-provider-postgis/src/SpatialLayerRegistry'
  imported from /app/server/routes/gis.routes.ts
```

Additional dynamic import in `server/index.ts`:

```text
../packages/mps-runtime/src/repository/createKernelArtifactRepository.js
```

Resolution: I2 canonical `Dockerfile` production stage + build-time import verification. **No Cloud Run patch in I1.**

---

## 17. I2 gate checklist

Blocked until owner accepts PNRC-0.1:

- [ ] Owner accepts PNRC-0.1 (this document)
- [ ] `Dockerfile` updated: `COPY packages/`, `tini`, staging worker separation
- [ ] Runtime import verification passes against `86d41d28` image
- [ ] `docker-compose.prod.yml` → canonical `Dockerfile`, port alignment
- [ ] `Dockerfile.gcp` / `deploy-gcp.yml` marked deprecated
- [ ] Staging harness: remove IAM headers; CSRF + admin JWT for I3
- [ ] Storage authorities A–D declared on staging server
- [ ] Secrets via vault/files — not committed `.env` with real values
- [ ] `verify-prod.ps1` + `/ready` green on dedicated staging

---

## 18. Related documents

- [dual-track-a.md](dual-track-a.md) — historical dual-track decision (GCP pilot now exit)
- [local-prod-setup.md](local-prod-setup.md) — dedicated-server quickstart
- [local-prod-fas1.md](local-prod-fas1.md) — backup, verify, TLS
- [mimers-brunn-v9-nfs-validation.md](mimers-brunn-v9-nfs-validation.md) — CAS on shared FS
- [observability-otlp.md](observability-otlp.md) — tracing plan
- [deploy/gcp/README.md](../../deploy/gcp/README.md) — **`LEGACY_GCP`** pilot reference

---

## Document history

| Version | Date | Change |
|---------|------|--------|
| 0.1 | 2026-08-31 | Initial PNRC with owner amendments 1–7 (I1 design commit) |
