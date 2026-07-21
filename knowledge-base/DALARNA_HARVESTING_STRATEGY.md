# Strategi för Inhämtning: Dalarna (Mimers Brunn)

Detta dokument definierar hur Mimer Bibliotekarie systematiskt dammsuger och prioriterar miljödata från samtliga 15 kommuner i Dalarna.

## Övergripande Strategi: Wide Survey, Selective Deep-Dive

För att maximera kontexten utan att överbelasta servrar eller lagring, tillämpas ett tvåfas-flöde:

### Fas 1: Metadata Wide Survey (ALLA miljöärenden)
Vi hämtar rubriker, diarienummer och datum för **allt** miljörelaterat innehåll.
- **Syfte:** Att bygga en "Master Index" över hela Dalarnas miljöärenden.
- **Källor:** Webbdiarier, kallelser och nämndsprotokoll.
- **Omfattning:** Miljöbalken, avfall, förorenad mark, vattenskydd, kemikalier, enskilda avlopp, etc.

### Fas 2: Selective Deep-Dive (Fysisk arkivering & PostGIS)
Vi laddar ner de faktiska dokumenten (PDF) och mappar data till PostGIS i prioriteringsordning.
- **Prioritering 1:** Enskilda avlopp (nuvarande fokus).
- **Prioritering 2:** Förorenad mark & Masshantering.
- **Prioritering 3:** Miljöfarlig verksamhet (C-anmälningar).

## Kommuner i Dalarna & Status

| Kommun | Myndighet | Åtkomststrategi | Status |
| :--- | :--- | :--- | :--- |
| **Mora** | Mora-Orsa Miljökontor | Protokollanalys (Survey) | Aktiv |
| **Orsa** | Mora-Orsa Miljökontor | Protokollanalys (Survey) | Aktiv |
| **Falun** | Miljö- och samhällsbyggnadsförvaltn. | Webbdiarium (Open Search) | Planerad |
| **Borlänge** | Miljönämnden | Webbdiarium | Planerad |
| **Leksand** | Myndighetsnämnden | Protokoll + Webbdiarium | Planerad |
| **Rättvik** | Miljö- och byggenheten | Protokollanalys | Planerad |
| **Ludvika** | Miljö- och byggnadsnämnden | Webbdiarium | Planerad |
| **Avesta** | Miljö- och byggnadsnämnden | Webbdiarium | Planerad |
| ... | ... | ... | ... |

## Tekniskt Harvest-kontrakt (Librarian)
- **Metadata-frekvens:** Veckovis check av nya protokoll/diarieposter.
- **Dokument-nedladdning:** Sker asynkront efter godkänd prioriteringslista.
- **SHA-256:** Obligatoriskt för alla arkiverade filer i `H:\...\GEO_Master_Archive`.

## Nästa Steg
1.  Generera "Wide Survey" för Mora-Orsa (alla miljöärenden 2024-2026).
2.  Identifiera alla "Avlopp"-relaterade ärenden ur survey-datan för Deep-Dive.
3.  Upprätta motsvarande survey för Falun och Borlänge.
