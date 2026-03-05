# Underlag for ansokan till Lantmateriet (Direktatkomst/API)

Detta dokument sammanfattar vad som bor bifogas i er ansokan for fastighetsinformation till Miljobeslut.se 2.0.

## 1) Verksamhetsbeskrivning och andamal

- Tjansten ar en B2B-plattform for miljo- och tillstandsarbete.
- Anvandning sker endast i aktivt projektkontext, inte publik soktjanst.
- Ingen vidareforsaljning av fastighetsinformation.
- Ingen profilering av privatpersoner.

## 2) Produktval och juridisk provning

- Ange exakt vilka direktatkomstprodukter ni ansoker om (t.ex. Registerbeteckning Direkt, Fastighet och samfallighet Direkt, Rattighet Direkt).
- Motivera varje produkt mot ett konkret arbetsflode i tillstandsprocessen.
- Beskriv att ni accepterar juridisk provning enligt fastighetsregisterlagen och tillampliga licensvillkor.

## 3) Teknisk arkitektur (ska bifogas)

- Backend-only integration mot Lantmateriet (ingen klientexponering av API-nycklar).
- Tvingande BankID-inloggning.
- Roll- och behorighetsstyrning (RBAC) + projektscope for varje fastighetsanrop.
- Dataminimering innan svar till frontend.
- Spårbarhet: accesslogg + immutable audit trail.
- Rate limiting, anti-bulk-skydd och missbruksdetektion.

## 4) Informationssakerhet och dataskydd

- Beskrivning av skydd for personuppgifter (tekniska och organisatoriska atgarder).
- Retention-policy med gallring efter laglig bevaringstid.
- Incidenthantering och revision.
- Personuppgiftsansvar/bitradesroller och kontaktvag.

## 5) Drift och atkomststyrning

- Miljoseparation: verifieringsmiljo och produktion.
- Hantering av behorighetsnycklar och behorighetsgrupper i API-portalen.
- Nyckelrotation, hemlighetshantering, least privilege.

## 6) Praktiska bilagor ni bor skicka med

- Arkitekturskiss (systemoversikt + datafloden).
- Endpointlista med skyddskontroller.
- Datamodell (Users, Organisations, Projects, PropertyAccessLog, AuditTrail).
- Exempel pa loggrad och auditexport.
- DPIA/konsekvensbedomning (om tillampligt) och intern policy for atkomstkontroll.

## 7) Viktiga datum att ha koll pa

- 16 januari 2026: Lantmateriet publicerade uppdatering om bedomning av extern lagring av fastighetsregisterinformation.
- 31 mars 2026: Fastighetsavisering avvecklas enligt produktinformationen.
- 5 maj 2025: BankID stoppade stod for statisk QR i RP API v6 (rorlig QR ar krav).

## 8) Kort checklista innan inskick

- [ ] Endast backend-anrop mot Lantmateriet.
- [ ] BankID och organisationskoppling ar pa plats.
- [ ] Projektkoppling kravs for varje fastighetssokning.
- [ ] Bulk/wildcard-sokning ar blockerad.
- [ ] Audit trail ar manipulationsskyddad och verifierbar.
- [ ] Villkor/licens och anvandningskategori i ansokan ar korrekt angiven.
