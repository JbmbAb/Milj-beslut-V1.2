# RiskGuard.ai Security Backend Baseline

Denna implementation introducerar en säker serverstruktur för B2B-hantering av fastighetsdata.

## Vad som är implementerat

- `server/secureApi.express.ts`
  - BankID RP API v6 auth init/collect/cancel (server-only, mTLS)
  - token refresh med rotation/reuse-detection
  - property lookup endpoint med obligatorisk auth + project scope
  - audit export endpoint
- `server/security/auth.ts`
  - signerade access/refresh-tokens (HMAC SHA-256)
  - middleware `requireAuth`
- `server/security/projectAccess.ts`
  - RBAC-permission checks
  - blockering av bulk/wildcard-sokning
- `server/repositories/projectAccessRepository.ts`
  - organisations- och projektmedlemskapskontroll via Prisma
- `server/security/rateLimit.ts`
  - rate limiting per user och organisation
- `server/security/auditTrail.ts`
  - append-only hash-kedja för audit
  - integritetsverifiering
- `server/services/lantmaterietService.ts`
  - backend-only anrop till Lantmäteriet
  - dataminimering och redigering av ägarinfo innan frontend-svar
- `server/services/sluService.ts`
  - backend-only anrop till SLU Artdatabanken med separata nycklar per produkt
  - stöd för Species Observations, Taxonomy, Artfakta och Metodkatalog
  - projektkoppling + auditning av sökningar
- `server/db/prisma.ts`
  - PrismaClient singleton
- `server/repositories/userRepository.ts`
  - användarmappning BankID -> intern användare/organisation
- `prisma/schema.prisma`
  - Users, Organisations, Projects, PropertyAccessLog, AuditTrail + relationer
- `server/compliance/retention.ts`
  - retentionberakning och kandidater för auto-radering

## Endpoint-design

- `POST /api/auth/bankid/init`
- `POST /api/auth/bankid/collect`
- `POST /api/auth/refresh`
- `POST /api/property/lookup`
- `GET /api/audit/export`

## Säkerhetsprinciper i implementationen

- Ingen klientexponering av Lantmäteriet API-nyckel.
- Alla property lookups kräver:
  - inloggad användare
  - `projectId`
  - `purpose`
  - projektmedlemskap i samma organisation
- Bulk-/massuttag blockeras.
- Access loggas och audit-kedja kan valideras.
- Rate limiting skyddar mot massuttag och missbruk.

## Kvar för produktion

- BankID mTLS-certifikat ska vara produktionscertifikat i separat secret manager.
- Flytta kompletterande hash-chain export till WORM/object-lock storage.
- Lägg till mTLS/IP allowlisting enligt Lantmäteriets avtal.
