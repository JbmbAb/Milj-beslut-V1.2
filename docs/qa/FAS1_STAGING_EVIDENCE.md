# Fas 1 — Enskilt avlopp: staging-bevis (mall)

## Lokal verifiering (utveckling)

| Kommando                                                     | Resultat                                            | Datum      |
| ------------------------------------------------------------ | --------------------------------------------------- | ---------- |
| `npx vitest run tests/unit/sewageApplicationsRoutes.test.ts` | 9/9 passerade                                       | 2026-05-20 |
| `npx vitest run tests/unit/adminSewageRoutes.test.ts`        | 11/11 passerade                                     | 2026-05-20 |
| `npx prisma migrate deploy`                                  | `20260520120000_sewage_application_case` applicerad | 2026-05-20 |

## Staging (fyll i vid PR)

```bash
npm run e2e:staging:avlopp
npm run staging:verify
```

| Kommando                     | Resultat lokalt      | Notering                                                               |
| ---------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `npm run staging:verify`     | 6 OK, 8 WARN, 0 FAIL | Delvis redo — se script-output                                         |
| `npm run e2e:staging:avlopp` | 9 skipped            | Kräver `STAGING_URL` / external E2E — kör i GitHub Actions mot staging |

**STAGING_URL:** _(repository variable)_

**Artifact-länkar:** _(GitHub Actions → Staging E2E Proof)_

## API som ska verifieras

- `POST /api/sewage/applications`
- `GET /api/sewage/applications/:id`
- `PATCH /api/sewage/applications/:id`
- `POST .../validate`, `.../generate-documents`, `.../submit`
- `PATCH .../status`, `GET .../export`, `.../audit-trail`

Legacy-alias (`/api/sewage/application/*`) finns för bakåtkompatibilitet men ska inte användas i nya integrationer.
