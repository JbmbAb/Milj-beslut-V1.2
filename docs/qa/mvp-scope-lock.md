# MVP Scope Lock - Miljobeslut.se

Datum: 2026-03-02  
Version: 1.0  
Status: Lasta och giltig tills ny godkand revision publiceras.

## Syfte
Detta dokument laser MVP-omfanget sa att implementation, test och salj inte driftar utan explicit beslut.

## Inom MVP (P0)
1. Ansokningsportal (permit-kodval, kravlista, utkast med manuell verifiering).
2. Projektledning (WBS-liknande struktur, tidslinje/Gantt, stage gates, audit trail).
3. Sakerhetsgrunder (auth/RBAC, revisionslogg, grundlaggande skyddskrav).

## Utanfor MVP (hanteras i V2+)
1. Fullt logistikflode som kommersiell standardmodul.
2. Gronkoll/finansiell taxonomi som produktkrav for MVP.
3. Externa avtalssparrade integrationer (BankID, Lantmateriet premiumupplagg).

## Release-regel for MVP
1. Inga nya tjansteblock far markas "MVP" utan dokumenterad beslutspunkt.
2. MVP-release far endast innehalla funktioner under "Inom MVP (P0)".
3. V2/V2.1-funktioner kan utvecklas bakom separat planering men far inte klassas som MVP-karnkrav.

## Andringskontroll
1. Andring av scope kravs i:
   - `docs/qa/mvp-scope-lock.md` (ny version)
   - `docs/qa/product-readiness-checklist.md` (uppdaterad status/evidens)
2. Andring ska ha datum, ansvarig och motivering.

## Verifieringsrad
Ref: `MVP_SCOPE_LOCK_V1_2026-03-02`
