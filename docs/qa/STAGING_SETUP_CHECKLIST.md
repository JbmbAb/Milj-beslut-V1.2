# Staging Setup & Execution Checklist

**Date**: 2026-05-21  
**Status**: Ready for staging deployment  
**Target**: Three modules (sewage, mass, localization)

---

## Pre-Staging Checklist

### Infrastructure Setup

- [ ] **PostGIS Database**

  ```bash
  createdb miljobeslut_staging
  psql miljobeslut_staging < prisma/schema.sql
  # Create spatial indexes
  npm run db:spatial-indexes
  ```

- [ ] **Environment Variables** (.env.staging)

  ```bash
  PLAYWRIGHT_BASE_URL=https://staging.example.com
  E2E_ADMIN_USERNAME=staging-admin
  E2E_ADMIN_PASSWORD=****
  DATABASE_URL=postgresql://staging.example.com:5432/miljobeslut_staging
  ```

- [ ] **External API Keys**
  - NVR API (Naturvårdsverket) — fetchProtectedAreas
  - RAA API (Riksantikvarieämbetet) — fetchAncientMonuments
  - VISS API (Vatteninfo) — queryVissPoint
  - SLU Species API (optional) — searchSluByCoordinates
  - Municipality REST API keys (MUNICIPALITY_API_KEY_*)

- [ ] **Frontend Deployment**
  - Build: `npm run build`
  - Deploy to: `https://staging.example.com`
  - Verify: `curl https://staging.example.com/health`

- [ ] **Backend API Deployment**
  - Deploy Node.js server
  - Verify health: `curl https://staging.example.com/api/health`

---

## Running Fas 4 E2E Tests

### Quick Start

```bash
# 1. Load staging config
source .env.staging  # or: set /p < .env.staging (Windows)

# 2. Start dev server (or verify staging is accessible)
npm run dev  # localhost:3000

# 3. Run staging tests
npm run e2e:staging:avlopp           # Sewage module
npm run e2e:staging:c-mass           # Mass module
npm run e2e:staging:localization     # Localization module

# Or all three:
npm run e2e:staging:all
```

### Expected Results

#### Sewage (enskilt avlopp) — 9 tests

```
✓ 1. API-flöde: skapa ansökan utan mock
✓ 2. Statusövergång: utkast → handläggning
✓ 2. Statusövergång: handläggning → beslut
✓ 3. Validering: saknade obligatoriska fält
✓ 3. Validering: ogiltiga koordinater
✓ 4. Export/underlag: hämta exportdokument
✓ 5. Rollbaserad åtkomst: anonymt anrop nekas
✓ 5. Rollbaserad åtkomst: CSRF-token krävs
✓ 5. Rollbaserad åtkomst: audit trail skapas

9 passed in ~45s
```

#### Mass (C-anmälan) — 8 tests

```
✓ Full flow: operations → documents → export → submit
✓ Gate evaluation: permit/notification/unknown
✓ Municipality endpoint routing
✓ ...

8 passed in ~30s
```

#### Localization (lokaliseringsutredning) — 7 tests

```
✓ Site alternative parsing and validation
✓ Coordinate bounds checking
✓ External API integration (NVR/RAA/VISS)
✓ Compliance report generation
✓ ...

7 passed in ~40s
```

---

## Verification Checklist (Per Module)

After each module passes E2E:

### Sewage Module

- [ ] Application created with unique reference number (AVLOPP-*)
- [ ] Audit trail has ≥3 entries (creation, validation, submission)
- [ ] Municipality received submission (or email fallback worked)
- [ ] Status tracking enables polling
- [ ] Documents (DOCX, SVG) generated correctly

### Mass Module

- [ ] Case created with operations evaluated
- [ ] Gates show correct priority order (PERMIT > NOTIFICATION > UNKNOWN > EXEMPT)
- [ ] Operational codes classified against MPF registry
- [ ] Export document generated with human-in-the-loop notes
- [ ] Municipality reference created

### Localization Module

- [ ] Multiple site alternatives parsed and compared
- [ ] Each site has compliance assessment (isCompliant: true/false)
- [ ] External data sources logged (NVR, RAA, VISS, SLU)
- [ ] Best alternative identified (highest permit probability)
- [ ] Report exportable with audit trail

---

## Troubleshooting

### Tests Timeout (5000ms)

**Solution**: Increase timeout in `playwright.config.ts`

```typescript
timeout: 30000; // instead of 5000
```

### 403 Unauthorized

**Check**:

1. Admin credentials in .env.staging
2. CSRF tokens are being passed
3. Auth middleware is configured

### NVR/RAA/VISS APIs Return Errors

**Expected**: Tests have fallback logic

- If NVR down → status: "unavailable", warnings logged
- If RAA down → status: "unavailable", compliance still possible
- If VISS down → water status not available, but process continues

### Database Connection Refused

```bash
# Verify PostGIS is running
psql -U postgres -d miljobeslut_staging -c "SELECT version();"

# Check connection string in .env.staging
DATABASE_URL=postgresql://user:pass@host:5432/miljobeslut_staging
```

---

## Post-E2E Checklist

When all three modules pass Fas 4:

- [ ] No orphaned records in database
- [ ] All reference numbers consistent (audit trail queries work)
- [ ] No data integrity violations
- [ ] Performance acceptable (response times < 2s)
- [ ] Logging complete (no ERROR level entries for normal flows)
- [ ] CORS configured correctly if frontend/backend on different hosts
- [ ] Rate limiting functioning (if enabled)
- [ ] Export documents downloadable and valid

---

## Production Readiness Gate

| Component              | Ready? | Notes                                 |
| ---------------------- | ------ | ------------------------------------- |
| Unit tests (Fas 1)     | ✅     | 3275 passing, 9 modules ≥85% coverage |
| Local E2E (Fas 2)      | ✅     | In-memory orchestrator flows verified |
| Infrastructure (Fas 3) | ✅     | Reference numbers consistent          |
| Staging E2E (Fas 4)    | 🔄     | Awaiting environment                  |

**When Fas 4 passes → Promote to production**

---

## Production Deployment

```bash
# 1. Merge branch
git checkout main
git merge recovery-sync-20260520

# 2. Tag release
git tag -a v1.0.0-prod-recovery -m "Fas 1-4 complete, staging verified"

# 3. Deploy
# (your deployment process)

# 4. Monitor
# - Audit trail entries
# - Reference number generation
# - Municipal submissions
# - Status polling
```

---

**Questions?** See `docs/qa/staging-evidence/FAS4_QUICK_REFERENCE.md`
