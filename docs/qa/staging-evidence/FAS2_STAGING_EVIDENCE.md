# Fas 2 — C-anmälan schaktmassor: bevis

## Lokal verifiering

| Kommando                                                    | Resultat                                  |
| ----------------------------------------------------------- | ----------------------------------------- |
| `npx vitest run tests/unit/cNotificationMassRoutes.test.ts` | 5/5 passerade                             |
| `npx prisma migrate deploy`                                 | `20260520130000_c_notification_mass_case` |

## Staging

```bash
npm run e2e:staging:c-mass
```

Kräver `STAGING_URL` och aktiverade endpoints i staging.

## API

- `POST /api/c-notification/mass/property-search`
- `POST /api/c-notification/mass/validate-codes`
- `POST /api/c-notification/mass/operations`
- `POST /api/c-notification/mass/mass-flow`
- `POST /api/c-notification/mass/logistics`
- `POST /api/c-notification/mass/generate-documents`
- `GET /api/c-notification/mass/:caseId/export`
- `POST /api/c-notification/mass/submit`
- `GET /api/c-notification/mass/:caseId/audit-trail`
