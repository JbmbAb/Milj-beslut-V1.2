# Core Scope Lock - Miljobeslut.se

Datum: 2026-03-02  
Version: 1.0  
Status: Lasta och giltig tills ny godkand revision publiceras.

## Syfte

Detta dokument laser Core-omfanget sa att implementation, test och salj inte driftar utan explicit beslut.

## Inom Core (P0)

1. Ansokningsportal (permit-kodval, kravlista, utkast med manuell verifiering).
2. Projektledning (WBS-liknande struktur, tidslinje/Gantt, stage gates, audit trail).
3. Sakerhetsgrunder (auth/RBAC, revisionslogg, grundlaggande skyddskrav).

## Utanfor Core (hanteras i V2+)

1. Fullt logistikflode som kommersiell standardmodul.
2. Gronkoll/finansiell taxonomi som produktkrav for Core.
3. Externa avtalssparrade integrationer (BankID, Lantmateriet premiumupplagg).

## Release-regel for Core

1. Inga nya tjansteblock far markas "Core" utan dokumenterad beslutspunkt.
2. Core-release far endast innehalla funktioner under "Inom Core (P0)".
3. V2/V2.1-funktioner kan utvecklas bakom separat planering men far inte klassas som Core-karnkrav.

## Andringskontroll

1. Andring av scope kravs i:
   - `docs/qa/core-scope-lock.md` (ny version)
   - `docs/qa/product-readiness-checklist.md` (uppdaterad status/evidens)
2. Andring ska ha datum, ansvarig och motivering.

## Verifieringsrad

Ref: `Core_SCOPE_LOCK_V1_2026-03-02`
