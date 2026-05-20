# Säkerhets- och GDPR-dokumentation

Denna fil beskriver hur Miljöbeslut-plattformen hanterar säkerhet, autentisering och GDPR-efterlevnad.

---

## Autentisering och auktorisering

### JWT-baserad autentisering (custom implementation)

- **Access token** — kortlivad (15 min), signerad med HMAC-SHA256, används i `Authorization: Bearer`-headern.
- **Refresh token** — långlivad (7 dagar), roteras vid varje användning (refresh-token-rotation).
- **Token reuse-detection** — använda refresh tokens markeras som revokerade i databasen. En andra användning av samma token triggar ett säkerhetsfel.
- Implementationsfiler: `server/security/auth.ts`, `server/repositories/tokenRepository.ts`

### BankID-integration

- Alla användare autentiseras via BankID (`bankidId` lagras krypterat).
- JWT-payload inkluderar `bankidId` för spårbarhet.

### Rollbaserad behörighetskontroll (RBAC)

| Roll       | PROPERTY_LOOKUP | AUDIT_EXPORT |
| ---------- | :-------------: | :----------: |
| ADMIN      |       ✅        |      ✅      |
| CONSULTANT |       ✅        |      ❌      |
| AUDITOR    |       ✅        |      ✅      |
| BANK       |       ❌        |      ❌      |

Implementationsfil: `server/security/projectAccess.ts`

### Projektbaserad åtkomstkontroll

- Utöver roll-kontroll måste varje användare vara **explicit projektmedlem** för att komma åt projektdata.
- ADMINs har **inte** automatisk tillgång — de måste också vara projektmedlemmar.
- Kontrolleras via `assertProjectAccess()` i `server/security/projectAccess.ts`.

---

## Rate Limiting

Två nivåer skyddar mot missbruk:

| Typ              | Funktion            | Adminbypass |
| ---------------- | ------------------- | :---------: |
| Per användare    | `rateLimitByUser()` |     ✅      |
| Per organisation | `rateLimitByOrg()`  |     ✅      |

- Svarsheadrar: `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- HTTP 429 returneras vid överskridning
- **Minnessäkerhet**: utgångna buckets rensas automatiskt var 5:e minut (`pruneExpiredBuckets`)
- Implementationsfil: `server/security/rateLimit.ts`

---

## Audit Trail (manipuleringssäkert)

Alla känsliga operationer loggas i en kryptografiskt länkad kedja:

- Varje post innehåller `payloadHash` (SHA-256 av innehållet) och `chainHash` (kedjelänk).
- `verifyAuditTrail()` verifierar hela kedjan och rapporterar om något post modifierats.
- Audit-poster **anonymiseras** vid kontoradering (userId sätts till null) men **raderas aldrig** (juridiskt krav).
- PII rensas ur audit-payloads via `sanitizeAuditPayload()` — känsliga fält som `password`, `bankidId`, `personnummer` ersätts med `[REDACTED_N_CHARS]`.
- Implementationsfiler: `server/security/auditTrail.ts`, `server/security/auditSanitization.ts`

---

## Felhantering (information disclosure prevention)

- `SecureError` används för att separera internt felmeddelande från klientsynligt meddelande.
- `toSafeErrorResponse()` mappar kända feltyper till generiska, säkra svar.
- Stack traces och interna feldetaljer exponeras **aldrig** till klienter.
- Middleware `secureErrorHandler` fångar alla oupptäckta fel i Express-routes.
- Implementationsfil: `server/security/secureErrors.ts`

---

## GDPR-efterlevnad

### Rättslig grund

Plattformen behandlar personuppgifter för miljötillståndsärenden — rättslig grund är allmänt intresse / myndighetsutövning (GDPR art. 6.1.e).

### Datarättigheter

| Rättighet                    | Endpoint                               | Anteckning                   |
| ---------------------------- | -------------------------------------- | ---------------------------- |
| Rätt till tillgång (art. 15) | `GET /api/gdpr/me/export`              | Returnerar all data i JSON   |
| Rätt till radering (art. 17) | `DELETE /api/admin/gdpr/users/:userId` | Kräver admin-roll            |
| Dataportabilitet (art. 20)   | `GET /api/gdpr/me/export`              | Maskinläsbart JSON-format    |
| Dataminimering (art. 5.1.c)  | —                                      | PII rensas från audit-loggar |

### Datalagringsregler

- Projekt kan förses med `retentionUntil` (antal dagar) via `PUT /api/projects/:projectId/retention`.
- Avslutade projekt (`CLOSED`) som passerat retentionsperioden arkiveras automatiskt (`ARCHIVED`).
- **Permanent radering** av användare tar bort: projektmedlemskap, åtkomstloggar, sökloggar, tokens.
- **Anonymisering** (ej radering) av: audit trail (juridiskt krav att bevara kedjan).
- Implementationsfil: `server/services/gdprComplianceService.ts`

### Periodiskt underhåll (GDPR Maintenance Job)

`POST /api/admin/gdpr/maintenance` triggar:

1. Rensning av utgångna token-revokeringar från databasen
2. Arkivering av projekt vars retentionsperiod löpt ut

---

## Databasmodell — relevant för GDPR

| Tabell              | PII-innehåll     | Bevarandestrategi            |
| ------------------- | ---------------- | ---------------------------- |
| `User`              | e-post, bankidId | Raderas vid kontoradering    |
| `AuditTrail`        | userId (FK)      | Anonymiseras (userId → null) |
| `PropertyAccessLog` | userId           | Raderas vid kontoradering    |
| `SearchQueryLog`    | userId, sökfråga | Raderas vid kontoradering    |
| `TokenRevocation`   | userId, jti      | Raderas vid kontoradering    |

---

## Miljövariabler (säkerhetskritiska)

| Variabel                  | Syfte                           | Obligatorisk |
| ------------------------- | ------------------------------- | :----------: |
| `JWT_ACCESS_SECRET`       | Signeringsnyckel access tokens  |      ✅      |
| `JWT_REFRESH_SECRET`      | Signeringsnyckel refresh tokens |      ✅      |
| `DATABASE_URL`            | PostgreSQL-anslutning           |      ✅      |
| `BANKID_CLIENT_CERT_PATH` | BankID TLS-certifikat           |    I prod    |
| `BANKID_CA_CERT_PATH`     | BankID CA                       |    I prod    |

Se `.env.example` för fullständig lista.

---

## Testtäckning (säkerhetsmoduler)

| Modul                      | Testfil                                    | Tester |
| -------------------------- | ------------------------------------------ | -----: |
| `auth.ts`                  | `tests/unit/auth.test.ts`                  |      5 |
| `rateLimit.ts`             | `tests/unit/rateLimit.test.ts`             |      4 |
| `secureErrors.ts`          | `tests/unit/secureErrors.test.ts`          |     11 |
| `auditSanitization.ts`     | `tests/unit/auditSanitization.test.ts`     |     10 |
| `gdprComplianceService.ts` | `tests/unit/gdprComplianceService.test.ts` |      6 |
| `projectAccess.ts`         | `tests/unit/projectAccess.test.ts`         |      2 |
| **Totalt**                 |                                            | **38** |

---

## Vad som kvarstår (kräver lokal miljö / externa tjänster)

- [ ] BankID-integration med riktigt PFX-certifikat (kräver Produkt-BankID-avtal)
- [ ] E2E-säkerhetstester mot körande server (`localhost:5173`)
- [ ] Penetrationstestning och OWASP ZAP-scanning
- [ ] Staging/produktion: HTTPS-tvång, HSTS-headers, CSP-policy
- [ ] Dataskyddsombud (DPO) ska granska behandlingsregistret

---

_Dokumentet uppdaterat 2026-03-21._
