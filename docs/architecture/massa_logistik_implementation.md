# Implementeringsbeskrivning: Massa-logistik och Transportstyrning

Miljöbeslut.se innehåller en djupt integrerad motor för att hantera logistik av schaktmassor och farligt avfall. Systemet automatiserar flödet från prissättning till digitala körjournaler och analys av föroreningsnivåer.

## 1. Transportstyrning & Fraktbörs-integration (`transportDispatchService.ts`)

Plattformen fungerar som en brygga mellan miljökraven i besluten och den faktiska logistiken på marken.

*   **Multiverantörs-stöd (Dispatch Providers)**: Systemet har inbyggt stöd för att kommunicera med ledande fraktbörser som **TimoCom** och **Trans.eu**. Om externa API-nycklar saknas faller systemet automatiskt tillbaka på en mock-provider (`MOCK_FRAKTBORS`) för att bibehålla driftstabilitet.
*   **Prissättning & Offert (Dispatch Quotes)**: En algoritm beräknar realtids-offerter baserat på:
    *   **Tonnage och distans**: Linjär skalning med basrate per ton-km.
    *   **Miljöavgift (Hazardous Surcharge)**: Automatiskt påslag om avfallskoden (EWC) är markerad som farlig (stjärnmärkt, t.ex. `17 05 03*`).
    *   **CO2-estimering**: Beräknar utsläppskonsekvenser (`0.12 kg CO2e/ton-km`) för att stödja hållbarhetsrapportering (CSRD).
*   **Bokningssystem**: Omvandlar godkända offerter till bindande transportbokningar med estimerad ankomsttid (ETA).

## 2. Digitala Körjournaler & Spårbarhet

För att uppfylla kraven på spårbarhet (traceability) i miljöbalken används digitala journaler.

*   **Identitet & Signering**: Körjournaler signeras kryptografiskt av både förare och granskare. En journal kan inte markeras som `VERIFIED` utan att båda parter signerat, vilket skapar en obruten beviskedja.
*   **GPS-validering**: Genom `stableTrackHash` skapas ett unikt fingeravtryck för varje körning baserat på fordon, rutt och mätarställning, vilket förhindrar manipulation av logistikdata.

## 3. LIMS-integration (Laboratorieanalys av massor)

En kritisk del i massa-logistik är att veta *vad* man transporterar. Systemet integrerar med LIMS (Laboratory Information Management System).

*   **Automatiskt Gränsvärdeskontroll**: Rapporter från laboratorier (t.ex. Eurofins eller ALS) importeras digitalt. Systemet mäter analytiska värden mot lagstadgade gränsvärden (`maxAllowed`).
*   **Trigger-baserad Logistik**: Om en transportbokning rör farligt avfall, kräver systemet automatiskt en godkänd LIMS-rapport innan transporten tillåts starta.
*   **Beslutsstöd**: Systemet flaggar automatiskt (`exceeded: true`) om ett prov överskrider tillåtna halter av t.ex. tungmetaller eller PAH:er.

## 4. Projektplanering & Audit Trail (`projectPlanService.ts`)

Hela logistikflödet är inbäddat i projektets huvud-plan:

*   **Snapshot-teknik**: Varje förändring i logistikkedjan (en ny offert, en signerad journal) sparas som en snapshot med fullständig audit trail.
*   **Stage-Gate kontroll**: Logistikmodulerna är kopplade till projektets grindar (Gates). Exempelvis kan projektet inte gå vidare till "Avslut" förrän alla körjournaler är verifierade och matchade mot inlämnade LIMS-rapporter.

---

Genom denna implementering transformerar Miljöbeslut.se logistik från en administrativ börda till en automatiserad och juridiskt trygg process som säkerställer att rätt massor hamnar på rätt plats med minimal miljöpåverkan.
