# Produktionsscope **utan BankID** (P3)

Detta dokument avgränsar vad som räknas som **levererbar produktion** när **slutanvändarinloggning via BankID** medvetet ligger utanför scope (t.ex. avtal, certifikat eller pilot där endast admin-/ organisationstillgång krävs).

## Inom scope (BankID-fri prod)

| Område | Beskrivning |
|--------|-------------|
| **Admin- och org-tillgång** | Inloggning via admin-konsolen (`/api/admin/auth/login`) med användarnamn/lösenord eller motsvarande som er organisation satt (lösenord i Secret Manager / env). |
| **Projekt och roller** | Projekt upplägg, medlemskap, roller inom organisation (enligt befintlig RBAC). |
| **Fastighet / karta / GIS** | Fastighetsuppslag och kartlager enligt konfigurerade källor (`LANTMATERIET_*`, öppna data m.m.) — **inte** BankID-krav. |
| **Dokument, RAG, tillståndsutkast** | Uppladdning, indexering, semantisk sökning, AI-utkast — drivs av inloggad användare med projektmedlemskap, inte BankID. |
| **Revision / export** | Domänlogg, audit-export (`AUDIT_EXPORT` för admin/auditor) enligt roller. |
| **Drift** | `/health`, `/ready`, Cloud Run, databas — oberoende av BankID. |

## Utanför scope (så länge BankID saknas)

| Område | Konsekvens |
|--------|------------|
| **BankID för slutanvändare** | Flöden som uttryckligen kräver BankID (t.ex. viss signering enligt affärsplan) är ** ej** en del av “BankID-fri prod” — de förblir avstängda eller mock tills avtal finns. |
| **eIDAS QTSP / kvalificerad signatur** | Separat checklista (Del I i production-readiness); kan vara delvis oberoende av BankID men kräver egen leverantör. |

## Miljö och policy

- Sätt tydligt **`BANKID_MOCK_MODE`** / produktionsläge enligt er säkerhetspolicy; “prod utan BankID” innebär **inte** att BankID-mock ska vara på i skarp kundmiljö om policy säger nej — då ska BankID-relaterade endpoints vara avstängda eller returnera konfigurerat fel.
- **Human-in-the-loop** gäller fortsatt för AI-stöd; BankID är inte en förutsättning för den principen.

## Koppling till tester

- Staging-E2E som kör **utan** BankID (admin-session) beskrivs i [README-staging-e2e.md](README-staging-e2e.md) (`tests/e2e/staging-core-flows.spec.ts`).
