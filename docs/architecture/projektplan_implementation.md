# Implementeringsbeskrivning: Projektplanering och Stage-Gates

Projektplanen är hjärtat i Miljobeslut.se. Den fungerar som en orkestreringsmotor som styr projektets progress genom intelligenta mallar, regulatoriska profiler och automatiserade kontrollstationer (Stage-Gates).

## 1. Dynamiska Projektmallar (`projectStructure.ts`)

Systemet använder fördefinierade mallar (`ProjectTemplatePacks`) för att snabbt sätta upp rätt struktur baserat på projekttyp:

- **Miljötillstånd (Core)**
- **VA-projekt**
- **Infrastruktur/Anläggning**
- **Marksanering**
- **Energi/Industri**

Varje mall definierar vilka **Stage-Gates** som krävs, vilka **kartlager** som ska vara aktiva som standard och vilka **basdokument** som behöver upprättas.

## 2. Regulatorisk Profilering & MPF-logik

En unik funktion är kopplingen mellan verksamhetskoder (SNI/EWC) och den juridiska prövningsnivån.

- **MPF-regler**: Systemet innehåller en inbyggd regelmotor med data från Miljöprövningsförordningen (t.ex. 29 kap. 31 §).
- **Automatisk anpassning**: När användaren väljer en kod (t.ex. `90.30` för sortering av avfall), beräknar systemet automatiskt:
  - **Regulatory Track**: Är det en anmälan (C) eller tillstånd (B)?
  - **RiskTier**: Låg, Medium eller Hög risk.
  - **Timeline Buffer**: Hur mycket extra tid krävs i tidsplanen för denna specifika prövning?
  - **Required Map Layers**: Kravställer automatiskt lager som t.ex. "Natura 2000" eller "Grundvatten" baserat på lagkraven för koden.

## 3. Stage-Gate Kontrollsystem

Systemet använder "Stage-Gates" för att säkerställa kvalitet och regelefterlevnad genom hela projektet.

- **Gate-typer**: `PERMIT_REQUIRED`, `RISK_REVIEW`, `DOCUMENT_CONTROL`, och `CARBON_CHECK`.
- **Evaluering**: Gates utvärderas automatiskt (`evaluateStageGate`). En gate kan vara `PENDING`, `APPROVED` eller `NOT_REQUIRED`.
- **Beroenden**: Vissa faser i projektet är "låsta" (`isLocked: true`) tills relevanta gates har passerats, vilket förhindrar att kritiska steg hoppas över.

## 4. Arkitektur för Persistence (`projectPlanService.ts`)

För att stödja samarbete och versionshantering används en robust lagringsstrategi:

- **Snapshot-modellen**: Varje gång planen ändras sparas en komplett snapshot. Detta möjliggör versionsjämförelser och fullständig historik.
- **Hybrid Persistence**: Systemet använder en kombination av en snabb in-memory cache för aktiv redigering och PostgreSQL (via Prisma) för permanent lagring.
- **Idempotent Utvärdering**: Gate-utvärderingar använder hash-jämförelser för att undvika onödiga uppdateringar och säkerställa att statusen är konsistent.

## 5. Audit Trail & Transparens

All aktivitet relaterad till projektplanen loggas i en **Audit Trail**. Detta inkluderar:

- Vem som aktiverade en gate.
- Vilken regel som orsakade en statusändring.
- Signatur-id:n för legala moment.

---

Denna implementering gör projektplanen till mer än bara en checklist; det är en aktiv juridisk rådgivare som säkerställer att varje miljöprojekt följer rätt lagar och att inget steg i processen glöms bort.
