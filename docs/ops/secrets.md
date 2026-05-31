# Secrets-hantering – Miljöbeslut

Datum: 2026-03-16  
Status: Aktivt underlag för driftgodkännande.

---

## Principer

1. **Inga secrets i källkod eller commits.** Använd `.gitignore` (`.env`, `.env.local`, `.env.*.local`).
2. **Rotation** ska vara möjlig utan kodändring – alla secrets hämtas från miljövariabler vid runtime.
3. **Minst behörighet** – varje service-konto eller API-nyckel beviljas bara de rättigheter det behöver.
4. **Audit trail** – alla accesser till secrets-lagret ska loggas av plattformen.

---

## Lagringsstrategi

| Miljö      | Plattform                           | Mekanism                       |
| ---------- | ----------------------------------- | ------------------------------ |
| Lokal dev  | `.env` (ej committat)               | `dotenv` via `loadEnv.ts`      |
| CI         | GitHub Actions encrypted secrets    | `secrets.*` i workflow-YAML    |
| Staging    | GitHub Actions environment secrets  | Environment `staging`          |
| Produktion | Hostingplattformens secrets-manager | Inject som env-vars vid deploy |

---

## Katalog – Applikations-secrets

Alla variabler nedan ska sättas som **encrypted secrets** i respektive miljö.
Se `.env.example` för icke-hemliga standardvärden.

### Autentisering & JWT

| Secret                           | Beskrivning                                       | Rotationsperiod |
| -------------------------------- | ------------------------------------------------- | --------------- |
| `JWT_ACCESS_SECRET`              | Signerar access-tokens (HMAC-SHA256, ≥ 32 bytes)  | 90 dagar        |
| `JWT_REFRESH_SECRET`             | Signerar refresh-tokens (HMAC-SHA256, ≥ 32 bytes) | 90 dagar        |
| `ADMIN_CONSOLE_PASSWORD`         | Lösenord för admin-konsolen                       | 90 dagar        |
| `STAGING_ADMIN_CONSOLE_PASSWORD` | Staging-lösenord för admin-konsolen               | 90 dagar        |

### Databas

| Secret                 | Beskrivning                                 | Rotationsperiod |
| ---------------------- | ------------------------------------------- | --------------- |
| `DATABASE_URL`         | PostgreSQL connection string inkl. lösenord | Vid behov       |
| `STAGING_DATABASE_URL` | Staging-DB connection string                | Vid behov       |

### BankID

| Secret                  | Beskrivning                                   | Rotationsperiod              |
| ----------------------- | --------------------------------------------- | ---------------------------- |
| `BANKID_PFX_PATH`       | Sökväg till RP-certifikat (.pfx)              | Certifikatets giltighetstid  |
| `BANKID_PFX_PASSPHRASE` | Lösenord till PFX-filen                       | Vid rotation av certifikatet |
| `BANKID_CERT_PATH`      | Alternativt PEM-certifikat (istället för PFX) | —                            |
| `BANKID_KEY_PATH`       | Privat nyckel till PEM-certifikatet           | —                            |
| `BANKID_CA_PATH`        | Valfri trust chain / CA för BankID-miljön     | Vid byte av CA / truststore  |

**Notering:** BankID-secrets ska normalt **inte** sättas i kundnära miljö förrän avtal och rätt test-/produktionscertifikat finns. Före det används admin-/organisationsinloggning eller explicit “unconfigured”-läge.

### AI-API:er

| Secret              | Beskrivning                              | Rotationsperiod |
| ------------------- | ---------------------------------------- | --------------- |
| `GEMINI_API_KEY`    | Google Gemini API-nyckel                 | 365 dagar       |
| `GEMINI_DB_API_KEY` | Separat nyckel för Gemini DB-assistenten | 365 dagar       |
| `OPENAI_API_KEY`    | OpenAI API-nyckel                        | 365 dagar       |

### Lantmäteriet

| Secret                         | Beskrivning                                     | Rotationsperiod |
| ------------------------------ | ----------------------------------------------- | --------------- |
| `LANTMATERIET_API_KEY`         | Lantmäteriets API Manager-nyckel                | Vid behov       |
| `LANTMATERIET_CONSUMER_KEY`    | OAuth2 consumer key                             | Vid behov       |
| `LANTMATERIET_CONSUMER_SECRET` | OAuth2 consumer secret                          | Vid behov       |
| `LANTMATERIET_ACCESS_TOKEN`    | Kortlivad bearer-token (valfritt, för dev/test) | Timmar          |

### SLU Artdatabanken

| Secret                     | Beskrivning          | Rotationsperiod |
| -------------------------- | -------------------- | --------------- |
| `SLU_API_KEY`              | Generell SLU-nyckel  | 365 dagar       |
| `SLU_SPECIES_OBS_API_KEY`  | Artobservationer API | 365 dagar       |
| `SLU_TAXONOMY_API_KEY`     | Taxonomi API         | 365 dagar       |
| `SLU_ARTFAKTA_API_KEY`     | Artfakta API         | 365 dagar       |
| `SLU_METODKATALOG_API_KEY` | Metodkatalog API     | 365 dagar       |

**Placering:**

- **Lokal utveckling:** `.env` eller `.env.local`, aldrig incheckat.
- **Staging:** GitHub/Vercel environment secrets, minst `STAGING_SLU_API_KEY`.
- **Produktion i GCP:** Google Secret Manager som runtime-secret till `SLU_API_KEY` eller produktspecifika `SLU_*_API_KEY`.

### Sök & kryptering

| Secret                         | Beskrivning                                 | Rotationsperiod |
| ------------------------------ | ------------------------------------------- | --------------- |
| `SEARCH_ENCRYPTION_KEY_BASE64` | AES-nyckel för krypterade sökindex (Base64) | 365 dagar       |

### Externa transport-API:er (valfritt)

| Secret                 | Beskrivning                            | Rotationsperiod |
| ---------------------- | -------------------------------------- | --------------- |
| `TIMOCOM_API_KEY`      | Timocom fraktbörsen                    | 365 dagar       |
| `TRANS_EU_API_KEY`     | Trans.eu fraktbörsen                   | 365 dagar       |
| `TRAFIKVERKET_API_KEY` | Trafikverket Trafikinformation         | 365 dagar       |
| `LASTKAJEN_USERNAME`   | Lastkajen 2 inloggning (Trafikverket)  | 365 dagar       |
| `LASTKAJEN_PASSWORD`   | Lastkajen 2 lösenord                   | 365 dagar       |
| `VISS_API_KEY`         | VISS vattenförekomster (Länsstyrelsen) | 365 dagar       |

---

## GitHub Actions – namnkonvention för staging-secrets

Prefixet `STAGING_` används för att separera staging-secrets från produktionssecrets.

| GitHub Secret Name              | Mappar till env-var            |
| ------------------------------- | ------------------------------ |
| `STAGING_DATABASE_URL`          | `DATABASE_URL`                 |
| `STAGING_JWT_ACCESS_SECRET`     | `JWT_ACCESS_SECRET`            |
| `STAGING_JWT_REFRESH_SECRET`    | `JWT_REFRESH_SECRET`           |
| `STAGING_GEMINI_API_KEY`        | `GEMINI_API_KEY`               |
| `STAGING_OPENAI_API_KEY`        | `OPENAI_API_KEY`               |
| `STAGING_BANKID_PFX_PATH`       | `BANKID_PFX_PATH`              |
| `STAGING_BANKID_PFX_PASSPHRASE` | `BANKID_PFX_PASSPHRASE`        |
| `STAGING_BANKID_CA_PATH`        | `BANKID_CA_PATH`               |
| `STAGING_LANTMATERIET_API_KEY`  | `LANTMATERIET_API_KEY`         |
| `STAGING_SLU_API_KEY`           | `SLU_API_KEY`                  |
| `STAGING_SLU_SPECIES_OBS_API_KEY` | `SLU_SPECIES_OBS_API_KEY`    |
| `STAGING_SLU_TAXONOMY_API_KEY`  | `SLU_TAXONOMY_API_KEY`         |
| `STAGING_SLU_ARTFAKTA_API_KEY`  | `SLU_ARTFAKTA_API_KEY`         |
| `STAGING_SLU_METODKATALOG_API_KEY` | `SLU_METODKATALOG_API_KEY`  |
| `STAGING_SEARCH_ENCRYPTION_KEY` | `SEARCH_ENCRYPTION_KEY_BASE64` |

### GitHub Actions Variables (icke-hemliga)

| Variable Name                    | Beskrivning                                              |
| -------------------------------- | -------------------------------------------------------- |
| `STAGING_URL`                    | Publik bas-URL för staging-miljön                        |
| `STAGING_API_BASE_URL`           | API-bas-URL inbakad i frontend-bygget                    |
| `STAGING_ADMIN_CONSOLE_USERNAME` | Användarnamn för staging-adminlogin, normalt `admin`     |
| `STAGING_DEPLOY_COMMAND`         | Plattformsspecifikt deploykommando som körs i workflowet |

---

## Rotationsprocess

1. Generera nytt värde (minst 32 bytes för nycklar, slumpmässigt).
2. Sätt det nya värdet i secrets-lagret.
3. Trigger ett nytt deploy via `workflow_dispatch` på `deploy-staging.yml`.
4. Verifiera att `/health` returnerar `200 ok`.
5. Ta bort det gamla värdet ur secrets-lagret om det inte sker automatiskt.
6. Dokumentera rotationen i incidentloggen.

---

## Krypteringsstandard för genererade nycklar

```bash
# JWT secrets (≥ 32 bytes)
openssl rand -hex 32

# AES search encryption key (32 bytes → Base64)
openssl rand -base64 32
```

---

## Verifiering

- Ref: `OPS_SECRETS_MANAGEMENT_V1`
