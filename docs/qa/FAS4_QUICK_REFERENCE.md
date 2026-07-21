# Fas 4 E2E Execution — Quick Reference

## Status: Ready (awaiting staging deployment)

### When Staging is Deployed

```bash
# 1. Set environment variables
export PLAYWRIGHT_BASE_URL="https://your-staging.example.com"
export E2E_ADMIN_USERNAME="staging-admin"
export E2E_ADMIN_PASSWORD="****"

# 2. Run sewage module E2E (first module to test)
npm run e2e:staging:avlopp

# Expected output (on success):
#   ✓ 1. API-flöde: skapa ansökan utan mock
#   ✓ 2. Statusövergång: utkast → handläggning  
#   ✓ 2. Statusövergång: handläggning → beslut
#   ✓ 3. Validering: saknade obligatoriska fält
#   ✓ 3. Validering: ogiltiga koordinater
#   ✓ 4. Export/underlag: hämta exportdokument
#   ✓ 5. Rollbaserad åtkomst: anonymt anrop nekas
#   ✓ 5. Rollbaserad åtkomst: CSRF-token krävs
#   ✓ 5. Rollbaserad åtkomst: audit trail skapas
#
#   9 passed in ~45s
```

### All Three Modules

```bash
# Sequential execution (recommended order)
npm run e2e:staging:avlopp           # Sewage — most critical
npm run e2e:staging:c-mass           # Mass — municipality integration
npm run e2e:staging:localization     # Localization — external GIS

# Or all at once (runs serially per module)
npm run e2e:staging:all
```

### Verification Checklist

After each module passes:

- [ ] Sewage: Submission created, reference number logged, municipality notified
- [ ] Mass: Gates evaluated, operational codes classified, export generated
- [ ] Localization: Site alternatives compared, compliance checked, report produced
- [ ] All: Audit trails complete, no orphaned records, reference numbers consistent

### Local Testing (Pre-staging)

```bash
# Run unit tests that validate orchestrator logic locally
npm test -- tests/unit/sewageOrchestrator.e2e.test.ts
npm test -- tests/unit/massOrchestrator.e2e.test.ts
npm test -- tests/unit/localizationOrchestrator.e2e.test.ts

# Expected: all pass (3200+ tests passing currently)
```

### Troubleshooting

**Tests skipped**: No `PLAYWRIGHT_BASE_URL` set
```bash
# Check if set:
echo $PLAYWRIGHT_BASE_URL

# If empty, set it:
export PLAYWRIGHT_BASE_URL="https://staging.example.com"
```

**Tests timeout**: Staging server unreachable or slow
```bash
# Increase timeout in playwright.config.ts:
#   timeout: 30000  (default)
#   timeout: 60000  (for slower networks)
```

**Authentication fails**: Check credentials
```bash
# Verify admin can login:
curl -X POST "$PLAYWRIGHT_BASE_URL/api/auth/login" \
  -d "username=$E2E_ADMIN_USERNAME&password=$E2E_ADMIN_PASSWORD"
```

### Critical Dependencies for Staging

| Service | Used By | Fallback | Status |
|---------|---------|----------|--------|
| NVR API | Sewage water protection | Mock data | ✓ Mocked in unit tests |
| RAA API | Sewage monuments | Mock data | ✓ Mocked in unit tests |
| VISS API | Sewage water status | Mock response | ✓ Mocked in unit tests |
| SLU Species | Sewage biodiversity | Disabled if no key | ✓ Optional |
| Municipality REST API | Sewage submission | Email fallback | ✓ Both paths tested |
| MPF Registry | Mass operation codes | Cached data | ✓ Local in staging |
| PostGIS | All spatial queries | Docker volume | ✓ Requires staging DB |

---

**📋 Next Step**: Deploy staging, set environment variables, run `npm run e2e:staging:avlopp`
