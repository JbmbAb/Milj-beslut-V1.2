# Strategi för Inhämtning: Enskilda Avlopp (Mimers Brunn)

Detta dokument definierar hur Mimer Bibliotekarie systematiskt dammsuger och prioriterar data rörande enskilda avlopp från olika kommuner.

## Övergripande Strategi: Survey-First
1.  **Metadata Survey:** Hämta listor på ärenden/beslut innan tunga filer laddas ner.
2.  **Prio-filtrering:** Fokusera på:
    *   Beviljade tillstånd (för att bygga "facit" för framtida ansökningar).
    *   Förelägganden om förbud (risk-indikatorer).
    *   Tillsynsrapporter (status på befintliga anläggningar).
3.  **Mimers Brunn Arkivering:** Lagring på H-disken med SHA-256 och versionering.

## Kommunlista & Vald Strategi

| Kommun | Myndighet | Åtkomststrategi | Status |
| :--- | :--- | :--- | :--- |
| **Mora** | Miljökontoret Mora-Orsa | **Protokollanalys + E-tjänst.** Saknar öppet diarium. Bevaka nämndsprotokoll för "Avlopp". | Planerad |
| **Orsa** | Miljökontoret Mora-Orsa | **Protokollanalys + E-tjänst.** Samma förvaltning som Mora. | Planerad |
| **Mariestad** | Miljö- och byggnadsnämnden | **Direkt Diarieskrapning.** Använder ett sökbart webbdiarium. | Analys pågår |
| **Lidköping** | Miljö- och byggnämnden | **Direkt Diarieskrapning.** Använder Evolution webbdiarium. | Planerad |
| **Skövde** | Miljönämnden | **Direkt Diarieskrapning.** | Planerad |
| **Vänersborg** | Miljö- och hälsoskyddsnämnden | **Protokollanalys.** | Planerad |

## Tekniskt Harvest-kontrakt (Librarian)
- **Batchstorlek:** Max 10 handlingar per anrop (e-tjänst) eller 20 rader per skrapningscykel.
- **Jitter:** 2-5 sekunder mellan anrop.
- **PostGIS-mapping:** Alla ärenden ska mappas mot `core.property_unit` via fastighetsbeteckning.
- **Semantisk Digest:** AI-sammanfattning av anläggningstyp (t.ex. "Infiltration", "Minireningsverk").

## Nästa Steg
1.  Aktivera bevakning av Mora-Orsas nämndsprotokoll.
2.  Identifiera mönster i Mariestads webbdiarium för automatiserad "Selective Scraping".
3.  Skapa en `Context Bridge` för avloppsdata så att Avlopps-AI:n kan lära sig av den importerade datan.
